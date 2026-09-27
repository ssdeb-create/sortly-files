import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FolderOpen, Loader2, Sparkles, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { classifyFile } from "@/lib/sort.functions";
import { extractContent, formatBytes } from "@/lib/extract";

export const Route = createFileRoute("/device")({
  head: () => ({
    meta: [
      { title: "Sort a device folder — Sortly" },
      {
        name: "description",
        content:
          "Point Sortly at a real folder on your computer, such as Downloads, and it moves each file into a content-based subfolder.",
      },
      { property: "og:title", content: "Sort a device folder — Sortly" },
      {
        property: "og:description",
        content: "AI tidies your Downloads folder in place, on your own machine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DevicePage,
});

type Entry = { name: string; size: number; status: "pending" | "done" | "error"; folder?: string; reason?: string };

// Minimal typing for the File System Access API (not in the DOM lib yet).
type DirHandle = {
  name: string;
  values: () => AsyncIterableIterator<any>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<any>;
  removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
};

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Unsorted";
}

function DevicePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [supported, setSupported] = useState(true);
  const [dir, setDir] = useState<DirHandle | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "showDirectoryPicker" in window);
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  async function pick() {
    try {
      const handle = (await (window as any).showDirectoryPicker({ mode: "readwrite" })) as DirHandle;
      setDir(handle);
      const found: Entry[] = [];
      for await (const entry of handle.values()) {
        if (entry.kind === "file") {
          const f = await entry.getFile();
          found.push({ name: entry.name, size: f.size, status: "pending" });
        }
      }
      setEntries(found);
    } catch {
      // user cancelled
    }
  }

  async function sortAll() {
    if (!dir) return;
    setRunning(true);
    try {
      const subfolders: string[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === "directory") subfolders.push(entry.name);
      }

      for (const item of entries.filter((e) => e.status === "pending")) {
        try {
          const handle = await dir.getFileHandle(item.name);
          const file: File = await handle.getFile();
          const { excerpt, imageDataUrl } = await extractContent(file);
          const decision = await classifyFile({
            data: {
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              size: file.size,
              excerpt,
              imageDataUrl,
              folders: subfolders.map((name) => ({ name, description: null })),
            },
          });

          const target = safeName(decision.folder);
          const targetDir = await dir.getDirectoryHandle(target, { create: true });
          if (!subfolders.includes(target)) subfolders.push(target);

          const dest = await targetDir.getFileHandle(file.name, { create: true });
          const writable = await dest.createWritable();
          await writable.write(await file.arrayBuffer());
          await writable.close();
          await dir.removeEntry(file.name);

          setEntries((prev) =>
            prev.map((e) =>
              e.name === item.name
                ? { ...e, status: "done", folder: target, reason: decision.reason }
                : e,
            ),
          );
        } catch (error) {
          setEntries((prev) =>
            prev.map((e) =>
              e.name === item.name
                ? { ...e, status: "error", reason: error instanceof Error ? error.message : "Failed" }
                : e,
            ),
          );
        }
      }
      toast.success("Folder sorted");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to vault
      </Link>

      <h1 className="text-3xl font-semibold">Sort a folder on this device</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Pick a real folder — your Downloads folder, for example. Sortly reads each file's content,
        creates topic subfolders where needed and physically moves the files. Nothing is uploaded.
      </p>

      {!supported ? (
        <div className="panel mt-8 p-6">
          <HardDrive className="mb-3 h-6 w-6 text-primary" />
          <p className="text-sm">
            This browser can't open device folders. Use the desktop app or Chrome / Edge on a
            computer. The cloud vault works everywhere.
          </p>
        </div>
      ) : (
        <div className="panel mt-8 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={pick} variant="secondary">
              <FolderOpen className="mr-2 h-4 w-4" /> {dir ? "Choose another folder" : "Choose folder"}
            </Button>
            {dir && (
              <Button onClick={sortAll} disabled={running || !entries.some((e) => e.status === "pending")}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Sort {entries.filter((e) => e.status === "pending").length} files
              </Button>
            )}
          </div>

          {dir && (
            <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
              /{dir.name}
            </p>
          )}

          <ul className="mt-4 divide-y divide-border">
            {entries.map((e) => (
              <li key={e.name} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(e.size)}</span>
                {e.status === "done" && <Badge variant="secondary">{e.folder}</Badge>}
                {e.status === "error" && <Badge variant="destructive">failed</Badge>}
              </li>
            ))}
          </ul>

          {dir && !entries.length && (
            <p className="mt-4 text-sm text-muted-foreground">This folder has no loose files.</p>
          )}
        </div>
      )}
    </main>
  );
}