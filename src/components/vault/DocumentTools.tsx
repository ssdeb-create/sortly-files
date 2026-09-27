import { useEffect, useState } from "react";
import { FileKey2, ImagePlus, LockKeyhole, QrCode, ScanText, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPdfFromFiles, encryptFileForQr } from "@/lib/document-tools";

export type SourceFile = { file: File; label: string };

export function DocumentTools({ initialFile, onCreated }: { initialFile?: SourceFile; onCreated?: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceFile[]>(initialFile ? [initialFile] : []);
  const [qrSource, setQrSource] = useState<SourceFile | null>(initialFile ?? null);
  const [password, setPassword] = useState("");
  const [qrPassword, setQrPassword] = useState("");
  const [name, setName] = useState("scanned-document");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (initialFile) {
      setSources([initialFile]);
      setQrSource(initialFile);
    }
  }, [initialFile]);

  function reset() {
    setMessage(null);
    setQrUrl(null);
    setPassword("");
    setQrPassword("");
  }

  async function makePdf() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await createPdfFromFiles(sources.map((source) => source.file), { password, fileName: name });
      const pdf = new File([result.blob], result.fileName, { type: "application/pdf" });
      onCreated?.(pdf);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(password ? "Locked PDF created and downloaded." : "PDF created and downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function makeQr() {
    setBusy(true);
    setMessage(null);
    try {
       const source = qrSource?.file;
      if (!source) throw new Error("Choose a file first.");
       const payload = await encryptFileForQr(source, qrPassword);
      setQrUrl(await QRCode.toDataURL(payload, { errorCorrectionLevel: "L", margin: 2, width: 360 }));
      setMessage("Encrypted QR created. Save the QR image and keep the password safe.");
    } catch (error) {
      setQrUrl(null);
      setMessage(error instanceof Error ? error.message : "Could not create the QR code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-label="Create or protect a PDF">
        {initialFile?.file.type === "application/pdf" ? <LockKeyhole className="h-4 w-4 sm:mr-2" /> : <ScanText className="h-4 w-4 sm:mr-2" />}
        <span className="hidden sm:inline">{initialFile?.file.type === "application/pdf" ? "Protect PDF" : "Create PDF"}</span>
      </Button>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scan and protect documents</DialogTitle>
          <DialogDescription>Turn text or images into a PDF, lock it with a password, or make a small encrypted file QR.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><ImagePlus className="h-4 w-4 text-primary" /> Text and image scanner</div>
             <Input type="file" multiple accept="image/*,text/plain,text/markdown,text/csv,application/json,application/xml" onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              setSources(chosen.map((file) => ({ file, label: file.name })));
              setQrUrl(null);
            }} />
            <p className="mt-2 text-xs text-muted-foreground">{sources.length ? sources.map((source) => source.label).join(" · ") : "Choose text files or images to scan."}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="pdf-name">PDF name</Label><Input id="pdf-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pdf-password">Optional PDF password</Label><Input id="pdf-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Lock this PDF" /></div>
            </div>
            <Button className="mt-3 w-full" onClick={makePdf} disabled={busy || !sources.length}>{busy ? "Working…" : <><LockKeyhole className="mr-2 h-4 w-4" /> Create PDF{password ? " and lock it" : ""}</>}</Button>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><FileKey2 className="h-4 w-4 text-primary" /> Encrypted QR for any file</div>
             <p className="mb-3 text-xs text-muted-foreground">Choose any small file. It is encrypted in your browser with AES-GCM; a single QR fits files up to about 1.6 KB.</p>
             <Input type="file" accept="*/*" aria-label="File to encrypt into a QR code" onChange={(event) => {
               const file = event.target.files?.[0];
               setQrSource(file ? { file, label: file.name } : null);
               setQrUrl(null);
             }} />
             <p className="mt-2 truncate text-xs text-muted-foreground">{qrSource?.label ?? "Choose a file for the encrypted QR."}</p>
             <div className="mt-3 space-y-1.5"><Label htmlFor="qr-password">QR password</Label><Input id="qr-password" type="password" value={qrPassword} onChange={(event) => setQrPassword(event.target.value)} placeholder="Required to encrypt" /></div>
             <Button variant="outline" className="mt-3 w-full" onClick={makeQr} disabled={busy || !qrSource || !qrPassword.trim()}><QrCode className="mr-2 h-4 w-4" /> Create encrypted QR</Button>
             {qrUrl && <div className="mt-4 flex flex-col items-center gap-3"><img src={qrUrl} alt="Encrypted file QR code" className="h-64 w-64 rounded-md bg-background p-2" /><a href={qrUrl} download={`${qrSource?.file.name ?? "file"}.qr.png`} className="text-sm text-primary underline-offset-2 hover:underline">Save QR image</a></div>}
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span>Passwords never leave this browser. Anyone scanning the QR still needs the password to decrypt the file.</span></div>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}