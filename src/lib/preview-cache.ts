/**
 * Local, persistent cache for file previews and AI summaries.
 *
 * Blobs and AI results survive reloads (IndexedDB), so re-opening a file
 * never re-downloads it from storage nor re-runs the model.
 *
 * Bounded by a configurable budget and evicted least-recently-used first,
 * so the cache never grows indefinitely.
 */

const DB_NAME = "vault-preview-cache";
const DB_VERSION = 2;
const BLOBS = "blobs";
const META = "blob_meta";
const SUMMARIES = "summaries";

/** Entries older than this are treated as stale and refetched. */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
/** Don't persist very large files — they'd eat the whole budget on their own. */
const MAX_BLOB_BYTES = 25_000_000;
/** Default budget for cached preview bytes. */
export const DEFAULT_MAX_CACHE_BYTES = 200_000_000;
/** Default budget for cached AI summaries (by count — they're tiny). */
export const DEFAULT_MAX_SUMMARIES = 500;

const SIZE_KEY = "vault-preview-cache:max-bytes";
const COUNT_KEY = "vault-preview-cache:max-summaries";

function readSetting(key: string, fallback: number) {
  if (typeof localStorage === "undefined") return fallback;
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Current preview-byte budget. */
export function getMaxCacheBytes() {
  return readSetting(SIZE_KEY, DEFAULT_MAX_CACHE_BYTES);
}

/** Change the preview-byte budget; evicts immediately if already over. */
export async function setMaxCacheBytes(bytes: number) {
  if (typeof localStorage !== "undefined") localStorage.setItem(SIZE_KEY, String(bytes));
  await evictBlobs();
}

/** Current maximum number of cached AI summaries. */
export function getMaxSummaries() {
  return readSetting(COUNT_KEY, DEFAULT_MAX_SUMMARIES);
}

/** Change the summary budget; evicts immediately if already over. */
export async function setMaxSummaries(count: number) {
  if (typeof localStorage !== "undefined") localStorage.setItem(COUNT_KEY, String(count));
  await evictSummaries();
}

export type CachedSummary = {
  summary: string;
  keyPoints: string[];
  tags: string[];
};

type BlobRecord = { key: string; blob: Blob };
type MetaRecord = { key: string; size: number; savedAt: number; lastUsed: number };
type SummaryRecord = CachedSummary & { key: string; savedAt: number; lastUsed: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: "key" });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
        if (!db.objectStoreNames.contains(SUMMARIES))
          db.createObjectStore(SUMMARIES, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function read<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await request<T>(db.transaction(store, "readonly").objectStore(store).get(key));
  } catch {
    return null;
  }
}

async function readAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const all = await request<T[]>(db.transaction(store, "readonly").objectStore(store).getAll());
    return all ?? [];
  } catch {
    return [];
  }
}

async function mutate(stores: string[], run: (tx: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(stores, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      run(tx);
    } catch {
      resolve();
    }
  });
}

function fresh(savedAt: number) {
  return Date.now() - savedAt < MAX_AGE_MS;
}

/** Drop least-recently-used previews until the cache fits the budget. */
async function evictBlobs() {
  const budget = getMaxCacheBytes();
  const metas = await readAll<MetaRecord>(META);
  const now = Date.now();
  const expired = metas.filter((m) => now - m.savedAt >= MAX_AGE_MS);
  const live = metas
    .filter((m) => now - m.savedAt < MAX_AGE_MS)
    .sort((a, b) => b.lastUsed - a.lastUsed);

  const doomed = [...expired];
  let total = 0;
  for (const m of live) {
    total += m.size;
    if (total > budget) doomed.push(m);
  }
  if (!doomed.length) return;

  await mutate([BLOBS, META], (tx) => {
    const blobs = tx.objectStore(BLOBS);
    const meta = tx.objectStore(META);
    for (const m of doomed) {
      blobs.delete(m.key);
      meta.delete(m.key);
    }
  });
}

/** Drop least-recently-used summaries beyond the configured count. */
async function evictSummaries() {
  const budget = getMaxSummaries();
  const all = await readAll<SummaryRecord>(SUMMARIES);
  const now = Date.now();
  const doomed = all
    .filter((s) => now - s.savedAt >= MAX_AGE_MS)
    .concat(
      all
        .filter((s) => now - s.savedAt < MAX_AGE_MS)
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(budget),
    );
  if (!doomed.length) return;
  await mutate([SUMMARIES], (tx) => {
    const store = tx.objectStore(SUMMARIES);
    for (const s of doomed) store.delete(s.key);
  });
}

function touchBlob(key: string, meta: MetaRecord) {
  void mutate([META], (tx) => {
    tx.objectStore(META).put({ ...meta, key, lastUsed: Date.now() } satisfies MetaRecord);
  });
}

export async function getCachedBlob(path: string): Promise<Blob | null> {
  const meta = await read<MetaRecord>(META, path);
  if (!meta || !fresh(meta.savedAt)) {
    if (meta) void evictBlobs();
    return null;
  }
  const rec = await read<BlobRecord>(BLOBS, path);
  if (!rec) return null;
  touchBlob(path, meta);
  return rec.blob;
}

export async function putCachedBlob(path: string, blob: Blob): Promise<void> {
  if (blob.size > MAX_BLOB_BYTES || blob.size > getMaxCacheBytes()) return;
  const now = Date.now();
  await mutate([BLOBS, META], (tx) => {
    tx.objectStore(BLOBS).put({ key: path, blob } satisfies BlobRecord);
    tx.objectStore(META).put({
      key: path,
      size: blob.size,
      savedAt: now,
      lastUsed: now,
    } satisfies MetaRecord);
  });
  await evictBlobs();
}

export async function getCachedSummary(fileId: string): Promise<CachedSummary | null> {
  const rec = await read<SummaryRecord>(SUMMARIES, fileId);
  if (!rec) return null;
  if (!fresh(rec.savedAt)) {
    void evictSummaries();
    return null;
  }
  void mutate([SUMMARIES], (tx) => {
    tx.objectStore(SUMMARIES).put({ ...rec, lastUsed: Date.now() });
  });
  return { summary: rec.summary, keyPoints: rec.keyPoints ?? [], tags: rec.tags ?? [] };
}

export async function putCachedSummary(fileId: string, value: CachedSummary): Promise<void> {
  const now = Date.now();
  await mutate([SUMMARIES], (tx) => {
    tx.objectStore(SUMMARIES).put({
      key: fileId,
      ...value,
      savedAt: now,
      lastUsed: now,
    } satisfies SummaryRecord);
  });
  await evictSummaries();
}

export async function dropCachedFile(fileId: string, path: string): Promise<void> {
  await mutate([BLOBS, META, SUMMARIES], (tx) => {
    tx.objectStore(BLOBS).delete(path);
    tx.objectStore(META).delete(path);
    tx.objectStore(SUMMARIES).delete(fileId);
  });
}

/** Wipe everything the cache is holding. */
export async function clearPreviewCache(): Promise<void> {
  await mutate([BLOBS, META, SUMMARIES], (tx) => {
    tx.objectStore(BLOBS).clear();
    tx.objectStore(META).clear();
    tx.objectStore(SUMMARIES).clear();
  });
}

/** Current cache usage, for settings/diagnostics UI. */
export async function getCacheStats() {
  const metas = await readAll<MetaRecord>(META);
  const summaries = await readAll<SummaryRecord>(SUMMARIES);
  return {
    bytes: metas.reduce((n, m) => n + m.size, 0),
    files: metas.length,
    summaries: summaries.length,
    maxBytes: getMaxCacheBytes(),
    maxSummaries: getMaxSummaries(),
  };
}
