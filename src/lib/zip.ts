import { unzip, zip, type Unzipped } from "fflate";

export function isZip(file: File) {
  return (
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    file.name.toLowerCase().endsWith(".zip")
  );
}

const MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  ts: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  zip: "application/zip",
};

function mimeFor(name: string) {
  return MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Expand a .zip archive into real File objects (skips folders and junk entries). */
export async function extractZip(archive: File): Promise<File[]> {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const out: File[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (!data.length) continue;
    const base = path.split("/").pop() ?? path;
    if (!base || base.startsWith(".") || path.startsWith("__MACOSX/")) continue;
    const buffer = new Uint8Array(data).slice().buffer as ArrayBuffer;
    out.push(new File([buffer], base, { type: mimeFor(base) }));
  }
  return out;
}

/** Bundle files into a single .zip blob. */
export async function zipFiles(entries: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const input: Record<string, Uint8Array> = {};
  for (const e of entries) input[e.name] = e.data;
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(input, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/zip" });
}
