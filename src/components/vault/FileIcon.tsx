import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  File as FileIconBase,
} from "lucide-react";

export function FileTypeIcon({ mime, name, className }: { mime: string; name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const Icon = mime.startsWith("image/")
    ? FileImage
    : mime.startsWith("video/")
      ? FileVideo
      : mime.startsWith("audio/")
        ? FileAudio
        : ["zip", "rar", "7z", "tar", "gz"].includes(ext)
          ? FileArchive
          : ["csv", "xlsx", "xls"].includes(ext)
            ? FileSpreadsheet
            : ["js", "ts", "tsx", "jsx", "py", "json", "html", "css", "sh", "sql"].includes(ext)
              ? FileCode
              : mime.startsWith("text/") || ext === "pdf" || ext === "md" || ext === "docx"
                ? FileText
                : FileIconBase;
  return <Icon className={className} />;
}