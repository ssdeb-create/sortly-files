import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FolderTree,
  Upload,
  Search,
  Star,
  Trash2,
  Clock,
  Files,
  Plus,
  Sparkles,
  LayoutGrid,
  List,
  MoreVertical,
  Download,
  Pencil,
  FolderInput,
  RotateCcw,
  Undo2,
  Loader2,
  Monitor,
  LogOut,
  Folder,
  Eye,
  Copy,
  FileArchive,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FileTypeIcon } from "@/components/vault/FileIcon";
import { FilePreview } from "@/components/vault/FilePreview";
import { DocumentTools } from "@/components/vault/DocumentTools";
import { CacheSettings } from "@/components/vault/CacheSettings";
import { AdSlot } from "@/components/ads/AdSlot";
import { openCookiePreferences } from "@/lib/consent";
import { formatBytes } from "@/lib/extract";
import { extractZip, isZip } from "@/lib/zip";

import {
  listFiles,
  listFolders,
  listActivity,
  ingestFile,
  createFolder,
  deleteFolder,
  renameFolder,
  renameFile,
  moveFile,
  setStarred,
  setTrashed,
  deleteFileForever,
  fileUrl,
  resortFile,
  undoSort,
  scanDuplicates,
  restoreDuplicate,
  downloadAsZip,
  purgeExpiredTrash,
  emptyTrash,
  daysLeftInTrash,
  TRASH_RETENTION_DAYS,
  type FileRow,
  type FolderRow,
} from "@/lib/vault";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sortly — AI file manager that sorts by content" },
      {
        name: "description",
        content:
          "Sortly reads every file you upload or share and files it into the right folder automatically, creating new folders when a topic is new.",
      },
      { property: "og:title", content: "Sortly — AI file manager" },
      {
        property: "og:description",
        content: "Upload, share or drop files. The AI reads the content and files them for you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type View = {
  kind: "all" | "starred" | "recent" | "trash" | "duplicates" | "folder";
  folderId?: string;
};

function Home() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [preview, setPreview] = useState<FileRow | null>(null);
  const [scanning, setScanning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const purged = useRef(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const folders = useQuery({ queryKey: ["folders"], queryFn: listFolders, enabled: !!user });
  const files = useQuery({ queryKey: ["files"], queryFn: listFiles, enabled: !!user });
  const activity = useQuery({ queryKey: ["activity"], queryFn: listActivity, enabled: !!user });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  // Clear out anything that has been in trash longer than the retention window.
  useEffect(() => {
    const rows = files.data;
    if (!rows || purged.current) return;
    purged.current = true;
    void purgeExpiredTrash(rows).then((n) => {
      if (n) {
        toast.info(`${n} file${n === 1 ? "" : "s"} removed from trash after ${TRASH_RETENTION_DAYS} days`);
        refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.data]);

  async function findDuplicates() {
    if (!user || scanning) return;
    setScanning(true);
    const id = toast.loading("Checking your files for duplicates…");
    try {
      const res = await scanDuplicates(
        user.id,
        files.data ?? [],
        folders.data ?? [],
        (done, total) => {
          if (total) toast.loading(`Fingerprinting files… ${done}/${total}`, { id });
        },
      );
      if (res.moved) {
        toast.success(`Moved ${res.moved} duplicate${res.moved === 1 ? "" : "s"} to "${res.folderName}"`, {
          id,
          description: "Delete them, or restore any you want to keep.",
        });
      } else {
        toast.success("No duplicates found", { id, description: `Checked ${res.checked} files.` });
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Duplicate scan failed", { id });
    } finally {
      setScanning(false);
    }
  }

  async function zipVisible(rows: FileRow[], name: string) {
    if (!rows.length || zipping) return;
    setZipping(true);
    const id = toast.loading(`Zipping ${rows.length} file${rows.length === 1 ? "" : "s"}…`);
    try {
      const n = await downloadAsZip(rows, name);
      toast.success(`${name}.zip ready — ${n} file${n === 1 ? "" : "s"}`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the zip", { id });
    } finally {
      setZipping(false);
    }
  }

  const ingest = useMutation({
    mutationFn: async ({ file, source }: { file: File; source: "upload" | "share" }) => {
      if (!user) throw new Error("Not signed in");
      // Always read the live folder list so files sorted moments ago are reused.
      const current = await listFolders();
      return ingestFile(user.id, file, source, current);
    },
    onSuccess: (res) => {
      toast.success(`${res.file.name} → ${res.folderName}`, {
        description: res.createdFolder ? `New folder created · ${res.reason}` : res.reason,
      });
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not sort that file"),
  });

  async function handleFiles(list: FileList | File[], source: "upload" | "share" = "upload") {
    let arr = Array.from(list);
    if (!arr.length) return;

    // Expand any .zip archives so their contents get sorted individually.
    const expanded: File[] = [];
    for (const file of arr) {
      if (!isZip(file)) {
        expanded.push(file);
        continue;
      }
      const id = toast.loading(`Extracting ${file.name}…`);
      try {
        const inner = await extractZip(file);
        if (!inner.length) {
          toast.error(`${file.name} is empty`, { id });
          continue;
        }
        toast.success(`Extracted ${inner.length} file${inner.length > 1 ? "s" : ""} from ${file.name}`, {
          id,
          description: "Sorting each one into a folder…",
        });
        expanded.push(...inner);
      } catch {
        toast.error(`Could not extract ${file.name}`, { id });
      }
    }
    arr = expanded;
    if (!arr.length) return;

    // Batch limits: up to 100 images at once; PDFs/docs capped at 50 MB total.
    const isImg = (f: File) => /^image\/(jpeg|jpg|png)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);
    const isDoc = (f: File) =>
      !isImg(f) &&
      (f.type === "application/pdf" ||
        /word|officedocument|msword|text\//i.test(f.type) ||
        /\.(pdf|docx?|txt|md|rtf|odt)$/i.test(f.name));

    const images = arr.filter(isImg);
    if (images.length > 100) {
      toast.error("Too many images at once", {
        description: `You selected ${images.length} images. Upload up to 100 JPG/PNG images per batch — the extra ${images.length - 100} were skipped.`,
        duration: 8000,
      });
      const allowed = new Set(images.slice(0, 100));
      arr = arr.filter((f) => !isImg(f) || allowed.has(f));
    }

    const docs = arr.filter(isDoc);
    const docBytes = docs.reduce((sum, f) => sum + f.size, 0);
    const DOC_LIMIT = 50 * 1024 * 1024;
    if (docBytes > DOC_LIMIT) {
      toast.error("Documents exceed the 50 MB limit", {
        description: `Your PDFs/docs total ${(docBytes / 1024 / 1024).toFixed(1)} MB. Please upload documents in batches of 50 MB or less — they were skipped this time.`,
        duration: 8000,
      });
      arr = arr.filter((f) => !isDoc(f));
    }
    if (!arr.length) return;

    setQueue((q) => [...q, ...arr.map((f) => f.name)]);
    const placed = new Map<string, number>();
    for (const file of arr) {
      const res = await ingest.mutateAsync({ file, source }).catch(() => undefined);
      if (res) placed.set(res.folderName, (placed.get(res.folderName) ?? 0) + 1);
      setQueue((q) => q.filter((n) => n !== file.name));
    }
    setQueue([]);
    if (placed.size && arr.length > 1) {
      toast.success(`Sorted ${arr.length} files into ${placed.size} folder${placed.size > 1 ? "s" : ""}`, {
        description: [...placed.entries()].map(([name, n]) => `${name} (${n})`).join(" · "),
      });
    }
  }


  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files ?? []);
      if (items.length) void handleFiles(items, "share");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, folders.data]);

  const visible = useMemo(() => {
    let rows = files.data ?? [];
    rows = view.kind === "trash" ? rows.filter((f) => f.trashed) : rows.filter((f) => !f.trashed);
    if (view.kind === "starred") rows = rows.filter((f) => f.starred);
    if (view.kind === "folder") rows = rows.filter((f) => f.folder_id === view.folderId);
    if (view.kind === "recent") rows = rows.slice(0, 24);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.summary ?? "").toLowerCase().includes(q) ||
          f.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [files.data, view, query]);

  const title =
    view.kind === "folder"
      ? (folders.data?.find((f) => f.id === view.folderId)?.name ?? "Folder")
      : view.kind === "all"
        ? "All files"
        : view.kind === "starred"
          ? "Starred"
          : view.kind === "recent"
            ? "Recent"
            : "Trash";

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files, "share");
      }}
    >
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="mb-6 flex items-center gap-2">
          <FolderTree className="h-6 w-6 text-primary" />
          <span className="font-display text-lg font-semibold">Sortly</span>
        </div>

        <Button className="mb-4 w-full" onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Add files
        </Button>

        <nav className="space-y-1">
          <NavItem icon={Files} label="All files" active={view.kind === "all"} onClick={() => setView({ kind: "all" })} />
          <NavItem icon={Clock} label="Recent" active={view.kind === "recent"} onClick={() => setView({ kind: "recent" })} />
          <NavItem icon={Star} label="Starred" active={view.kind === "starred"} onClick={() => setView({ kind: "starred" })} />
          <NavItem icon={Trash2} label="Trash" active={view.kind === "trash"} onClick={() => setView({ kind: "trash" })} />
        </nav>

        <div className="mt-6 flex items-center justify-between px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Folders
          <button
            className="rounded p-1 hover:bg-sidebar-accent"
            onClick={async () => {
              const name = window.prompt("Folder name");
              if (!name) return;
              await createFolder(user.id, name);
              refresh();
            }}
            aria-label="New folder"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <ScrollArea className="mt-2 flex-1">
          <div className="space-y-1 pr-2">
            {(folders.data ?? []).map((f) => (
              <FolderItem
                key={f.id}
                folder={f}
                count={(files.data ?? []).filter((x) => x.folder_id === f.id && !x.trashed).length}
                active={view.folderId === f.id}
                onOpen={() => setView({ kind: "folder", folderId: f.id })}
                onRenamed={refresh}
                onDeleted={refresh}
              />
            ))}
            {!(folders.data ?? []).length && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No folders yet — add a file and the AI will create one.
              </p>
            )}
          </div>
        </ScrollArea>

        <AdSlot slotKey="sidebar" className="mt-4" minHeight={200} />

        <div className="mt-4 space-y-1 border-t border-sidebar-border pt-4">
          <Link
            to="/device"
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Monitor className="h-4 w-4" /> Sort a device folder
          </Link>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-6">
        <header className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold md:text-2xl">{title}</h1>
              <p className="truncate text-xs text-muted-foreground md:text-sm">
                {visible.length} item{visible.length === 1 ? "" : "s"} · drop, paste or upload — sorting is automatic
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="icon" onClick={() => setLayout(layout === "grid" ? "list" : "grid")} aria-label="Toggle layout">
                {layout === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              </Button>

              <CacheSettings />

              <DocumentTools />

              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="secondary" aria-label="Activity">
                    <Sparkles className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Activity</span>
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:max-w-md">
                  <SheetHeader>
                    <SheetTitle>AI sorting activity</SheetTitle>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-6rem)] pr-4">
                    <div className="space-y-3 py-4">
                      {(activity.data ?? []).map((e) => (
                        <div key={e.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{e.file_name}</p>
                              <p className="text-xs text-muted-foreground">
                                → {e.folder_name}
                                {e.created_folder ? " (new folder)" : ""}
                              </p>
                            </div>
                            {!e.undone && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  await undoSort(e);
                                  refresh();
                                }}
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          {e.reason && <p className="mt-2 text-xs text-muted-foreground">{e.reason}</p>}
                        </div>
                      ))}
                      {!(activity.data ?? []).length && (
                        <p className="text-sm text-muted-foreground">Nothing sorted yet.</p>
                      )}
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>

              <Button onClick={() => inputRef.current?.click()} size="icon" className="md:hidden" aria-label="Add files">
                <Upload className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, summary, tags"
              className="pl-9"
            />
          </div>
        </header>


        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {queue.length > 0 && (
          <div className="panel mb-3 flex items-center gap-3 p-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm">
              Reading and filing {queue.length} file{queue.length === 1 ? "" : "s"}…
            </span>
          </div>
        )}

        {!visible.length ? (
          <button
            onClick={() => inputRef.current?.click()}
            className="panel flex min-h-44 w-full flex-col items-center justify-center gap-2 border-dashed p-6 text-center"
          >
            <Upload className="h-7 w-7 text-primary" />
            <p className="font-display text-base">Drop files here</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Downloads, screenshots, PDFs, notes — the assistant reads the content and files each
              one, creating a folder when the topic is new.
            </p>
          </button>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {visible.map((f, i) => (
              <Fragment key={f.id}>
                {i > 0 && i % 8 === 0 && (
                  <AdSlot slotKey="ingrid" minHeight={160} />
                )}
                <FileCard
                  file={f}
                  folders={folders.data ?? []}
                  userId={user.id}
                  onChange={refresh}
                  onPreview={setPreview}
                />
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="panel divide-y divide-border overflow-hidden">
            {visible.map((f, i) => (
              <Fragment key={f.id}>
                {i > 0 && i % 8 === 0 && (
                  <AdSlot slotKey="ingrid" className="m-3" minHeight={120} />
                )}
                <FileLine
                  file={f}
                  folders={folders.data ?? []}
                  userId={user.id}
                  onChange={refresh}
                  onPreview={setPreview}
                />
              </Fragment>
            ))}
          </div>
        )}

        <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>Sortly is free, supported by ads.</span>
          <button onClick={openCookiePreferences} className="underline-offset-2 hover:underline">
            Cookie settings
          </button>
        </footer>
      </main>

      <FilePreview
        file={preview}
        folders={folders.data ?? []}
        onClose={() => setPreview(null)}
        onChange={refresh}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="panel px-8 py-6 text-center">
            <Sparkles className="mx-auto mb-2 h-6 w-6 text-primary" />
            <p className="font-display text-lg">Drop to sort with AI</p>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function FolderItem({
  folder,
  count,
  active,
  onOpen,
  onRenamed,
  onDeleted,
}: {
  folder: FolderRow;
  count: number;
  active: boolean;
  onOpen: () => void;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  return (
    <div
      className={`group flex items-center rounded-md ${active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"}`}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm">
        <Folder className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate">{folder.name}</span>
        {folder.created_by_ai && <Sparkles className="h-3 w-3 shrink-0 text-accent" />}
        <span className="ml-auto text-xs text-muted-foreground">{count}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="px-1 opacity-0 group-hover:opacity-100" aria-label="Folder options">
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={async () => {
              const name = window.prompt("Rename folder", folder.name);
              if (name) {
                await renameFolder(folder.id, name);
                onRenamed();
              }
            }}
          >
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={async () => {
              if (window.confirm(`Delete folder "${folder.name}"? Files inside move to All files.`)) {
                await deleteFolder(folder.id);
                onDeleted();
              }
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function useFileActions(file: FileRow, folders: FolderRow[], userId: string, onChange: () => void) {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    open: async () => {
      const url = await fileUrl(file.storage_path);
      window.open(url, "_blank", "noopener");
    },
    star: async () => {
      await setStarred(file.id, !file.starred);
      onChange();
    },
    rename: async () => {
      const name = window.prompt("Rename file", file.name);
      if (name) {
        await renameFile(file.id, name);
        onChange();
      }
    },
    move: async (folderId: string | null) => {
      await moveFile(file.id, folderId);
      onChange();
    },
    trash: async () => {
      await setTrashed(file.id, !file.trashed);
      onChange();
    },
    destroy: async () => {
      if (!window.confirm(`Permanently delete "${file.name}"?`)) return;
      await deleteFileForever(file);
      onChange();
    },
    resort: async () => {
      setBusy(true);
      try {
        const res = await resortFile(userId, file, folders);
        toast.success(`${file.name} → ${res.folderName}`, { description: res.reason });
        onChange();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Re-sort failed");
      } finally {
        setBusy(false);
      }
    },
  };
}

function FileMenu({
  file,
  folders,
  userId,
  onChange,
  onPreview,
}: {
  file: FileRow;
  folders: FolderRow[];
  userId: string;
  onChange: () => void;
  onPreview: (file: FileRow) => void;
}) {
  const a = useFileActions(file, folders, userId, onChange);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Options for ${file.name}`}>
          {a.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onPreview(file)}>
          <Eye className="mr-2 h-4 w-4" /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={a.open}>
          <Download className="mr-2 h-4 w-4" /> Open / download
        </DropdownMenuItem>
        <DropdownMenuItem onClick={a.star}>
          <Star className="mr-2 h-4 w-4" /> {file.starred ? "Unstar" : "Star"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={a.rename}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInput className="mr-2 h-4 w-4" /> Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
            <DropdownMenuItem onClick={() => a.move(null)}>No folder</DropdownMenuItem>
            {folders.map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => a.move(f.id)}>
                {f.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={a.resort}>
          <Sparkles className="mr-2 h-4 w-4" /> Re-sort with AI
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {file.trashed ? (
          <>
            <DropdownMenuItem onClick={a.trash}>
              <RotateCcw className="mr-2 h-4 w-4" /> Restore
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={a.destroy}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete forever
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem className="text-destructive" onClick={a.trash}>
            <Trash2 className="mr-2 h-4 w-4" /> Move to trash
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type RowProps = {
  file: FileRow;
  folders: FolderRow[];
  userId: string;
  onChange: () => void;
  onPreview: (file: FileRow) => void;
};

function FileCard({ onPreview, ...props }: RowProps) {
  const { file, folders } = props;
  const folder = folders.find((f) => f.id === file.folder_id);
  return (
    <article className="panel flex flex-col gap-2 p-3">
      <div className="flex items-start gap-3">
        <button
          onClick={() => onPreview(file)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-label={`Preview ${file.name}`}
        >
          <div className="rounded-lg bg-secondary p-2.5">
            <FileTypeIcon mime={file.mime_type} name={file.name} className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium">{file.name}</h3>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {folder?.name ?? "Unfiled"}
            </p>
          </div>
        </button>
        {file.starred && <Star className="h-4 w-4 fill-primary text-primary" />}
        <FileMenu {...props} onPreview={onPreview} />
      </div>
      {file.summary && <p className="line-clamp-2 text-xs text-muted-foreground">{file.summary}</p>}
      {file.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {file.tags.slice(0, 4).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </article>
  );
}

function FileLine({ onPreview, ...props }: RowProps) {
  const { file, folders } = props;
  const folder = folders.find((f) => f.id === file.folder_id);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        onClick={() => onPreview(file)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Preview ${file.name}`}
      >
        <FileTypeIcon mime={file.mime_type} name={file.name} className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
      </button>
      <span className="hidden w-40 truncate text-xs text-muted-foreground sm:block">
        {folder?.name ?? "Unfiled"}
      </span>
      <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">
        {formatBytes(file.size)}
      </span>
      <FileMenu {...props} onPreview={onPreview} />
    </div>
  );
}