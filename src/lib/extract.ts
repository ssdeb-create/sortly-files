const TEXTUAL = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/sql",
];

const TEXT_EXTENSIONS = [
  "txt","md","csv","tsv","json","xml","yml","yaml","html","htm","css","js","jsx","ts","tsx",
  "py","rb","go","rs","java","c","h","cpp","sh","sql","log","ini","toml","env","srt","vtt",
];

export function isTextual(file: { type: string; name: string }) {
  if (TEXTUAL.some((t) => file.type.startsWith(t))) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.includes(ext);
}

export function isImage(file: { type: string }) {
  return file.type.startsWith("image/");
}

async function readAsDataUrl(file: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Very light PDF text scrape: pulls readable strings out of the raw bytes. */
async function scrapePdf(file: Blob) {
  const buf = new Uint8Array(await file.slice(0, 400_000).arrayBuffer());
  let raw = "";
  for (let i = 0; i < buf.length; i++) raw += String.fromCharCode(buf[i]!);
  const chunks = raw.match(/\((?:\\.|[^\\()]){3,}\)/g) ?? [];
  const text = chunks
    .map((c) => c.slice(1, -1).replace(/\\[nrt]/g, " ").replace(/\\(.)/g, "$1"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 40 ? text.slice(0, 6000) : "";
}

export type Extraction = { excerpt: string; imageDataUrl: string | null };

export async function extractContent(file: File): Promise<Extraction> {
  try {
    if (isImage(file) && file.size < 6_000_000) {
      return { excerpt: "", imageDataUrl: await readAsDataUrl(file) };
    }
    if (isTextual(file)) {
      const text = await file.slice(0, 200_000).text();
      return { excerpt: text.slice(0, 8000), imageDataUrl: null };
    }
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      return { excerpt: await scrapePdf(file), imageDataUrl: null };
    }
  } catch {
    // fall through to name-only classification
  }
  return { excerpt: "", imageDataUrl: null };
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}