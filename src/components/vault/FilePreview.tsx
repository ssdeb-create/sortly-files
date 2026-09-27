import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, FolderInput, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes } from "@/lib/extract";
import { fileUrl, moveFile, setSummary, type FileRow, type FolderRow } from "@/lib/vault";
import { summarizeFile, type FileSummary } from "@/lib/summarize.functions";
import { DocumentTools } from "@/components/vault/DocumentTools";
import {
  getCachedBlob,
  putCachedBlob,
  getCachedSummary,
  putCachedSummary,
} from "@/lib/preview-cache";

type Kind = "image" | "pdf" | "text" | "audio" | "video" | "other";

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|ya?ml|toml|log|ini|env|xml|html?|css|jsx?|tsx?|py|rb|go|rs|java|c|h|cpp|sh|sql)$/i;

export function previewKind(file: Pick<FileRow, "mime_type" | "name">): Kind {
  const mime = (file.mime_type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    TEXT_EXTENSIONS.test(file.name)
  )
    return "text";
  return "other";
}

/** One download per file per session: blob + derived object URL are cached in memory. */
type Cached = { blob: Blob; objectUrl: string; text?: string; dataUrl?: string };
const contentCache = new Map<string, Cached>();

async function loadContent(file: FileRow): Promise<Cached> {
  const hit = contentCache.get(file.storage_path);
  if (hit) return hit;

  // Persistent local cache: survives reloads, so no re-download.
  const stored = await getCachedBlob(file.storage_path);
  if (stored) {
    const entry: Cached = { blob: stored, objectUrl: URL.createObjectURL(stored) };
    contentCache.set(file.storage_path, entry);
    return entry;
  }

  const signed = await fileUrl(file.storage_path);
  const res = await fetch(signed);
  if (!res.ok) throw new Error("Could not load this file");
  const blob = await res.blob();
  const entry: Cached = { blob, objectUrl: URL.createObjectURL(blob) };
  contentCache.set(file.storage_path, entry);
  void putCachedBlob(file.storage_path, blob);
  return entry;
}


async function toDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Light PDF text scrape from bytes we already have in memory. */
function scrapePdf(bytes: Uint8Array) {
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]!);
  const chunks = raw.match(/\((?:\\.|[^\\()]){3,}\)/g) ?? [];
  return chunks
    .map((c) => c.slice(1, -1).replace(/\\[nrt]/g, " ").replace(/\\(.)/g, "$1"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

export function FilePreview({
  file,
  folders,
  onClose,
  onChange,
}: {
  file: FileRow | null;
  folders: FolderRow[];
  onClose: () => void;
  onChange: () => void;
}) {
  const [content, setContent] = useState<Cached | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [ai, setAi] = useState<FileSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  const kind = file ? previewKind(file) : "other";
  const folder = folders.find((f) => f.id === file?.folder_id);

  const runSummary = useCallback(
    async (row: FileRow, cached: Cached, body: string | null, force = false) => {
      setAiLoading(true);
      setAiError(null);
      try {
        if (!force) {
          const stored = await getCachedSummary(row.id);
          if (stored) {
            setAi(stored);
            return;
          }
        }
        let excerpt = body ?? "";
        if (!excerpt && previewKind(row) === "pdf") {
          excerpt = scrapePdf(new Uint8Array(await cached.blob.slice(0, 400_000).arrayBuffer()));
        }
        let imageDataUrl: string | null = null;
        if (previewKind(row) === "image" && cached.blob.size < 6_000_000) {
          cached.dataUrl ??= await toDataUrl(cached.blob);
          imageDataUrl = cached.dataUrl;
        }
        const result = await summarizeFile({
          data: {
            fileName: row.name,
            mimeType: row.mime_type,
            excerpt: excerpt.slice(0, 12000),
            imageDataUrl,
          },
        });
        setAi(result);
        if (result.summary) {
          void putCachedSummary(row.id, result);
          await setSummary(row.id, result.summary, result.tags.length ? result.tags : row.tags);
          onChange();
        }
      } catch (e) {
        setAiError(e instanceof Error ? e.message : "The assistant could not read this file.");
      } finally {
        setAiLoading(false);
      }
    },
    [onChange],
  );

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setText(null);
    setError(null);
    setAi(null);
    setAiError(null);
    setAiLoading(false);
    if (!file) {
      requested.current = null;
      return;
    }

    setLoading(true);
    (async () => {
      try {
        // Show a previously cached summary instantly, before the bytes arrive.
        const storedSummary = await getCachedSummary(file.id);
        if (!cancelled && storedSummary) {
          setAi(storedSummary);
          requested.current = file.id;
        }
        const cached = await loadContent(file);
        if (cancelled) return;
        setContent(cached);
        let body: string | null = null;
        if (previewKind(file) === "text") {
          cached.text ??= (await cached.blob.text()).slice(0, 200_000);
          body = cached.text;
          if (!cancelled) setText(cached.text);
        }
        if (cancelled) return;
        setLoading(false);
        // One click: preview and AI summary land together, from the same download.
        if (requested.current !== file.id) {
          requested.current = file.id;
          await runSummary(file, cached, body);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load this file");
          setLoading(false);
        }
      }
    })();


    return () => {
      cancelled = true;
    };
  }, [file, runSummary]);

  const url = content?.objectUrl ?? null;
  const shownSummary = ai?.summary || file?.summary || "";
  const shownTags = ai?.tags.length ? ai.tags : (file?.tags ?? []);
  const toolFile = useMemo(
    () => (file && content ? new File([content.blob], file.name, { type: file.mime_type }) : undefined),
    [content, file],
  );

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {file && (
          <>
            <DialogHeader className="border-b border-border px-5 py-4 text-left">
              <DialogTitle className="truncate pr-8 text-base">{file.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {formatBytes(file.size)} · {folder?.name ?? "Unfiled"}
                {file.mime_type ? ` · ${file.mime_type}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[52vh] min-h-[220px] overflow-auto bg-secondary/30">
              {loading && (
                <div className="flex h-[220px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loading && error && <p className="p-6 text-sm text-destructive">{error}</p>}

              {!loading && !error && url && kind === "image" && (
                <img
                  src={url}
                  alt={`Preview of ${file.name}`}
                  className="mx-auto max-h-[52vh] w-auto object-contain"
                />
              )}

              {!loading && !error && url && kind === "pdf" && (
                <iframe
                  src={`${url}#toolbar=0&view=FitH`}
                  title={`Preview of ${file.name}`}
                  className="h-[52vh] w-full border-0 bg-background"
                />
              )}

              {!loading && !error && kind === "text" && text !== null && (
                <pre className="whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-foreground">
                  {text || "This file is empty."}
                </pre>
              )}

              {!loading && !error && url && kind === "audio" && (
                <div className="p-6">
                  <audio src={url} controls className="w-full" />
                </div>
              )}

              {!loading && !error && url && kind === "video" && (
                <video src={url} controls className="max-h-[52vh] w-full bg-black" />
              )}

              {!loading && !error && kind === "other" && (
                <div className="flex h-[220px] flex-col items-center justify-center gap-2 px-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No inline preview for this file type — read the AI summary below.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-border px-5 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">AI summary</span>
                {aiLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                {!aiLoading && content && (
                  <button
                    type="button"
                    className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => runSummary(file, content, text, true)}
                  >
                    Regenerate
                  </button>
                )}
              </div>

              {aiError && <p className="text-xs text-destructive">{aiError}</p>}
              {!aiError && (
                <p className="text-xs text-muted-foreground">
                  {shownSummary || (aiLoading ? "Reading this file…" : "No summary yet.")}
                </p>
              )}

              {ai?.keyPoints?.length ? (
                <ul className="mt-2 space-y-1">
                  {ai.keyPoints.map((p) => (
                    <li key={p} className="text-xs text-muted-foreground">
                      • {p}
                    </li>
                  ))}
                </ul>
              ) : null}

              {shownTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {shownTags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {toolFile && <DocumentTools initialFile={{ file: toolFile, label: file.name }} />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    <FolderInput className="mr-2 h-4 w-4" /> Move to
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-64 w-52 overflow-y-auto">
                  <DropdownMenuItem
                    onClick={async () => {
                      await moveFile(file.id, null);
                      onChange();
                      onClose();
                    }}
                  >
                    No folder
                  </DropdownMenuItem>
                  {folders.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      onClick={async () => {
                        await moveFile(file.id, f.id);
                        onChange();
                        onClose();
                      }}
                    >
                      {f.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {url && (
                <Button size="sm" asChild>
                  {/* Saves the copy already in memory — no second download. */}
                  <a href={url} download={file.name}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
