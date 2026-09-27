import { supabase } from "@/integrations/supabase/client";
import { classifyFile } from "./sort.functions";
import { extractContent } from "./extract";

export type FolderRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_by_ai: boolean;
  created_at: string;
};

export type FileRow = {
  id: string;
  folder_id: string | null;
  name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  summary: string | null;
  tags: string[];
  starred: boolean;
  trashed: boolean;
  trashed_at: string | null;
  content_hash: string | null;
  duplicate_of: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export const DUPLICATES_FOLDER = "Duplicates";
export const TRASH_RETENTION_DAYS = 30;

/** Days left before a trashed file is purged automatically. */
export function daysLeftInTrash(file: FileRow) {
  const from = file.trashed_at ?? file.updated_at;
  const elapsed = (Date.now() - new Date(from).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsed));
}

/** SHA-256 of the file bytes — identical content always produces the same value. */
export async function hashFile(file: Blob) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type SortEventRow = {
  id: string;
  file_id: string | null;
  file_name: string;
  folder_id: string | null;
  folder_name: string;
  previous_folder_id: string | null;
  reason: string | null;
  confidence: number | null;
  created_folder: boolean;
  undone: boolean;
  created_at: string;
};

export async function listFolders() {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FolderRow[];
}

export async function listFiles() {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FileRow[];
}

export async function listActivity() {
  const { data, error } = await supabase
    .from("sort_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as SortEventRow[];
}

const PALETTE = ["amber", "cyan", "violet", "rose", "emerald", "sky", "orange"];

export async function createFolder(
  userId: string,
  name: string,
  description = "",
  byAi = false,
) {
  const clean = name.trim() || "Unsorted";
  const { data, error } = await supabase
    .from("folders")
    .insert({
      user_id: userId,
      name: clean,
      description,
      created_by_ai: byAi,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
    })
    .select()
    .single();
  if (error) {
    // Another upload just created the same folder — reuse it instead of failing.
    const { data: existing } = await supabase
      .from("folders")
      .select("*")
      .ilike("name", clean)
      .limit(1)
      .maybeSingle();
    if (existing) return existing as FolderRow;
    throw error;
  }
  return data as FolderRow;
}

export async function renameFolder(id: string, name: string) {
  const { error } = await supabase.from("folders").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function deleteFolder(id: string) {
  const { error } = await supabase.from("folders").delete().eq("id", id);
  if (error) throw error;
}

export async function renameFile(id: string, name: string) {
  const { error } = await supabase.from("files").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function moveFile(id: string, folderId: string | null) {
  const { error } = await supabase.from("files").update({ folder_id: folderId }).eq("id", id);
  if (error) throw error;
}

export async function setStarred(id: string, starred: boolean) {
  const { error } = await supabase.from("files").update({ starred }).eq("id", id);
  if (error) throw error;
}

export async function setTrashed(id: string, trashed: boolean) {
  const { error } = await supabase
    .from("files")
    .update({ trashed, trashed_at: trashed ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteFileForever(file: FileRow) {
  await supabase.storage.from("vault").remove([file.storage_path]);
  const { error } = await supabase.from("files").delete().eq("id", file.id);
  if (error) throw error;
}

/** Permanently remove everything sitting in trash. */
export async function emptyTrash(rows: FileRow[]) {
  const trashed = rows.filter((f) => f.trashed);
  if (!trashed.length) return 0;
  await supabase.storage.from("vault").remove(trashed.map((f) => f.storage_path));
  const { error } = await supabase
    .from("files")
    .delete()
    .in("id", trashed.map((f) => f.id));
  if (error) throw error;
  return trashed.length;
}

/** Delete trashed files older than the retention window (runs on load). */
export async function purgeExpiredTrash(rows: FileRow[]) {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
  const expired = rows.filter(
    (f) => f.trashed && new Date(f.trashed_at ?? f.updated_at).getTime() < cutoff,
  );
  if (!expired.length) return 0;
  await supabase.storage.from("vault").remove(expired.map((f) => f.storage_path));
  await supabase
    .from("files")
    .delete()
    .in("id", expired.map((f) => f.id));
  return expired.length;
}

const urlCache = new Map<string, { url: string; expiresAt: number }>();

/** Signed URL, cached in memory so re-opening a file never re-signs or re-downloads. */
export async function fileUrl(path: string) {
  const hit = urlCache.get(path);
  if (hit && hit.expiresAt > Date.now() + 30_000) return hit.url;
  const { data, error } = await supabase.storage.from("vault").createSignedUrl(path, 60 * 10);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 60 * 10 * 1000 });
  return data.signedUrl;
}

export async function setSummary(id: string, summary: string, tags: string[]) {
  const { error } = await supabase.from("files").update({ summary, tags }).eq("id", id);
  if (error) throw error;
}


function slug(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
}

export type IngestResult = {
  file: FileRow;
  folderName: string;
  reason: string;
  createdFolder: boolean;
  duplicate?: boolean;
};

/** Find or create a folder by exact name (case-insensitive). */
export async function ensureFolder(
  userId: string,
  folders: FolderRow[],
  name: string,
  description = "",
) {
  const existing = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (existing) return { folder: existing, created: false };
  return { folder: await createFolder(userId, name, description, true), created: true };
}

/** Upload a file, let the AI read its content, and file it into the right folder. */
export async function ingestFile(
  userId: string,
  file: File,
  source: "upload" | "share" | "device",
  folders: FolderRow[],
): Promise<IngestResult> {
  const contentHash = await hashFile(file);

  // Identical content already stored? Park the copy in Duplicates and skip the AI.
  const { data: twin } = await supabase
    .from("files")
    .select("*")
    .eq("content_hash", contentHash)
    .eq("trashed", false)
    .is("duplicate_of", null)
    .limit(1)
    .maybeSingle();

  if (twin) {
    const original = twin as FileRow;
    const { folder, created } = await ensureFolder(
      userId,
      folders,
      DUPLICATES_FOLDER,
      "Exact copies of files already in your vault. Safe to delete or restore.",
    );
    const dupPath = `${userId}/${crypto.randomUUID()}-${slug(file.name)}`;
    const { error: dupUploadError } = await supabase.storage
      .from("vault")
      .upload(dupPath, file, { contentType: file.type || "application/octet-stream" });
    if (dupUploadError) throw dupUploadError;

    const { data: dupRow, error: dupError } = await supabase
      .from("files")
      .insert({
        user_id: userId,
        folder_id: folder.id,
        name: file.name,
        mime_type: file.type || "application/octet-stream",
        size: file.size,
        storage_path: dupPath,
        summary: original.summary,
        tags: original.tags,
        source,
        content_hash: contentHash,
        duplicate_of: original.id,
      })
      .select()
      .single();
    if (dupError) throw dupError;

    const reason = `Identical to "${original.name}" already in your vault.`;
    await supabase.from("sort_events").insert({
      user_id: userId,
      file_id: dupRow.id,
      file_name: file.name,
      folder_id: folder.id,
      folder_name: folder.name,
      reason,
      created_folder: created,
    });

    return {
      file: dupRow as FileRow,
      folderName: folder.name,
      reason,
      createdFolder: created,
      duplicate: true,
    };
  }

  const { excerpt, imageDataUrl } = await extractContent(file);

  const decision = await classifyFile({
    data: {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      excerpt,
      imageDataUrl,
      folders: folders.map((f) => ({ name: f.name, description: f.description })),
    },
  });

  let folder = folders.find(
    (f) => f.name.toLowerCase() === decision.folder.toLowerCase(),
  );
  let createdFolder = false;
  if (!folder) {
    folder = await createFolder(userId, decision.folder, decision.folderDescription, true);
    createdFolder = true;
  }

  const path = `${userId}/${crypto.randomUUID()}-${slug(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from("vault")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) throw uploadError;

  const { data: inserted, error } = await supabase
    .from("files")
    .insert({
      user_id: userId,
      folder_id: folder.id,
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size: file.size,
      storage_path: path,
      summary: decision.summary,
      tags: decision.tags,
      source,
      content_hash: contentHash,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase.from("sort_events").insert({
    user_id: userId,
    file_id: inserted.id,
    file_name: file.name,
    folder_id: folder.id,
    folder_name: folder.name,
    reason: decision.reason,
    confidence: decision.confidence,
    created_folder: createdFolder,
  });

  return {
    file: inserted as FileRow,
    folderName: folder.name,
    reason: decision.reason,
    createdFolder,
  };
}

/** Re-run the AI on an already stored file (used by "Re-sort"). */
export async function resortFile(userId: string, row: FileRow, folders: FolderRow[]) {
  const { data, error } = await supabase.storage.from("vault").download(row.storage_path);
  if (error) throw error;
  const asFile = new File([data], row.name, { type: row.mime_type });
  const { excerpt, imageDataUrl } = await extractContent(asFile);

  const decision = await classifyFile({
    data: {
      fileName: row.name,
      mimeType: row.mime_type,
      size: row.size,
      excerpt,
      imageDataUrl,
      folders: folders.map((f) => ({ name: f.name, description: f.description })),
    },
  });

  let folder = folders.find((f) => f.name.toLowerCase() === decision.folder.toLowerCase());
  let createdFolder = false;
  if (!folder) {
    folder = await createFolder(userId, decision.folder, decision.folderDescription, true);
    createdFolder = true;
  }

  await supabase
    .from("files")
    .update({ folder_id: folder.id, summary: decision.summary, tags: decision.tags })
    .eq("id", row.id);

  await supabase.from("sort_events").insert({
    user_id: userId,
    file_id: row.id,
    file_name: row.name,
    folder_id: folder.id,
    folder_name: folder.name,
    previous_folder_id: row.folder_id,
    reason: decision.reason,
    confidence: decision.confidence,
    created_folder: createdFolder,
  });

  return { folderName: folder.name, reason: decision.reason };
}

export async function undoSort(event: SortEventRow) {
  if (event.file_id) {
    await supabase
      .from("files")
      .update({ folder_id: event.previous_folder_id })
      .eq("id", event.file_id);
  }
  await supabase.from("sort_events").update({ undone: true }).eq("id", event.id);
}
export type DuplicateScanResult = { checked: number; moved: number; folderName: string };

/**
 * Fingerprint every stored file (downloading only those missing a hash) and move
 * every later copy of the same content into the Duplicates folder.
 */
export async function scanDuplicates(
  userId: string,
  rows: FileRow[],
  folders: FolderRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<DuplicateScanResult> {
  const live = rows
    .filter((f) => !f.trashed)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const missing = live.filter((f) => !f.content_hash);
  let done = 0;
  for (const row of missing) {
    try {
      const { data } = await supabase.storage.from("vault").download(row.storage_path);
      if (data) {
        const hash = await hashFile(data);
        row.content_hash = hash;
        await supabase.from("files").update({ content_hash: hash }).eq("id", row.id);
      }
    } catch {
      /* unreadable file — skip */
    }
    onProgress?.(++done, missing.length);
  }

  const seen = new Map<string, FileRow>();
  const dupes: { row: FileRow; original: FileRow }[] = [];
  for (const row of live) {
    if (!row.content_hash) continue;
    const first = seen.get(row.content_hash);
    if (!first) {
      seen.set(row.content_hash, row);
      continue;
    }
    if (row.duplicate_of) continue;
    dupes.push({ row, original: first });
  }

  if (!dupes.length) return { checked: live.length, moved: 0, folderName: DUPLICATES_FOLDER };

  const { folder } = await ensureFolder(
    userId,
    folders,
    DUPLICATES_FOLDER,
    "Exact copies of files already in your vault. Safe to delete or restore.",
  );

  for (const { row, original } of dupes) {
    await supabase
      .from("files")
      .update({ folder_id: folder.id, duplicate_of: original.id })
      .eq("id", row.id);
    await supabase.from("sort_events").insert({
      user_id: userId,
      file_id: row.id,
      file_name: row.name,
      folder_id: folder.id,
      folder_name: folder.name,
      previous_folder_id: row.folder_id,
      reason: `Identical to "${original.name}".`,
    });
  }

  return { checked: live.length, moved: dupes.length, folderName: folder.name };
}

/** Restore a duplicate back to the folder it was copied from. */
export async function restoreDuplicate(row: FileRow, rows: FileRow[]) {
  const original = rows.find((f) => f.id === row.duplicate_of);
  const { error } = await supabase
    .from("files")
    .update({ folder_id: original?.folder_id ?? null, duplicate_of: null })
    .eq("id", row.id);
  if (error) throw error;
}

/** Download the given files and bundle them into a single .zip. */
export async function downloadAsZip(rows: FileRow[], zipName: string) {
  const { zipFiles } = await import("./zip");
  const entries: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    const { data, error } = await supabase.storage.from("vault").download(row.storage_path);
    if (error || !data) continue;
    let name = row.name;
    let n = 2;
    while (used.has(name)) {
      const dot = row.name.lastIndexOf(".");
      name =
        dot > 0
          ? `${row.name.slice(0, dot)} (${n})${row.name.slice(dot)}`
          : `${row.name} (${n})`;
      n++;
    }
    used.add(name);
    entries.push({ name, data: new Uint8Array(await data.arrayBuffer()) });
  }
  if (!entries.length) throw new Error("Nothing to zip");
  const blob = await zipFiles(entries);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return entries.length;
}
