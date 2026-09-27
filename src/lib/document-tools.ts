import { jsPDF } from "jspdf";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function imageFormat(file: File) {
  if (file.type === "image/png" || file.name.toLowerCase().endsWith(".png")) return "PNG";
  if (file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp")) return "WEBP";
  return "JPEG";
}

function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

function readImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Could not scan this image."));
    image.src = dataUrl;
  });
}

function addTextPages(doc: jsPDF, text: string, name: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(name, MARGIN, MARGIN);
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(text || "(empty file)", CONTENT_WIDTH);
  const lineHeight = 13;
  let y = MARGIN + 28;
  for (const line of lines) {
    if (y > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(line, MARGIN, y);
    y += lineHeight;
  }
}

async function addImagePage(doc: jsPDF, file: File, first: boolean) {
  if (!first) doc.addPage();
  const dataUrl = await readDataUrl(file);
  const size = await readImageSize(dataUrl);
  const availableWidth = CONTENT_WIDTH;
  const availableHeight = PAGE_HEIGHT - MARGIN * 2 - 22;
  const scale = Math.min(availableWidth / size.width, availableHeight / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  const x = (PAGE_WIDTH - width) / 2;
  const y = MARGIN + 22 + (availableHeight - height) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(file.name, MARGIN, MARGIN);
  doc.addImage(dataUrl, imageFormat(file), x, y, width, height, undefined, "FAST");
}

export async function createPdfFromFiles(
  files: File[],
  options: { password?: string; fileName?: string } = {},
) {
  const usable = files.filter(
    (file) => file.type.startsWith("image/") || file.type.startsWith("text/") || /\.(txt|md|csv|json|xml|html?)$/i.test(file.name),
  );
  if (!usable.length) throw new Error("Choose at least one text or image file.");

  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
    compress: true,
    ...(options.password
      ? {
          encryption: {
            userPassword: options.password,
            ownerPassword: `${options.password}-owner`,
            userPermissions: ["print"],
          },
        }
      : {}),
  });

  let first = true;
  for (const file of usable) {
    if (file.type.startsWith("image/")) {
      await addImagePage(doc, file, first);
    } else {
      if (!first) doc.addPage();
      addTextPages(doc, await file.text(), file.name);
    }
    first = false;
  }

  return {
    blob: doc.output("blob"),
    fileName: options.fileName?.endsWith(".pdf") ? options.fileName : `${options.fileName ?? "scanned-document"}.pdf`,
  };
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function encryptFileForQr(file: Blob, password: string) {
  if (!password.trim()) throw new Error("Enter a password first.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 1_600) {
    throw new Error("This file is too large for a single QR code. Use a smaller file or create a password-protected PDF instead.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return JSON.stringify({ v: 1, name: file instanceof File ? file.name : "file", type: file.type, salt: base64Url(salt), iv: base64Url(iv), data: base64Url(encrypted) });
}