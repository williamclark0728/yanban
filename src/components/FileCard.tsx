import { FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, FileType2, Presentation, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatSize } from "../lib/files";
import type { Attachment } from "../types";
import { IconButton } from "./ui";

export function FileIcon({ kind }: { kind?: Attachment["kind"] }) {
  if (kind === "pdf") return <FileType2 size={16} />;
  if (kind === "docx") return <FileText size={16} />;
  if (kind === "image") return <FileImage size={16} />;
  if (kind === "text") return <FileCode2 size={16} />;
  if (kind === "sheet") return <FileSpreadsheet size={16} />;
  if (kind === "slides") return <Presentation size={16} />;
  if (kind === "zip") return <FileArchive size={16} />;
  return <FileText size={16} />;
}

const label = (f: Attachment) =>
  [formatSize(f.size), f.pages && `${f.pages} 页`, f.truncated && "只读取前一部分"].filter(Boolean).join(" · ");

/** File tile inside a message; opens a preview of what the agents actually read. */
export function FileCard({ file }: { file: Attachment }) {
  const [open, setOpen] = useState(false);
  const previewable = !!file.text || !!file.image;

  if (file.kind === "image" && file.image) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="mb-1.5 block overflow-hidden rounded-2xl">
          <img src={`data:${file.mime};base64,${file.image}`} alt={file.name} className="max-h-60 max-w-[min(320px,100%)] object-cover" />
        </button>
        {open && <Preview file={file} onClose={() => setOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={!previewable}
        onClick={() => setOpen(true)}
        className="mb-1.5 flex max-w-[280px] items-center gap-2.5 rounded-2xl bg-bubble px-3 py-2 text-left enabled:hover:bg-raise-2"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
          <FileIcon kind={file.kind} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{file.name}</span>
          <span className="block truncate text-xs text-fg-3">{label(file)}</span>
        </span>
      </button>
      {open && <Preview file={file} onClose={() => setOpen(false)} />}
    </>
  );
}

function Preview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-full w-full flex-col overflow-hidden bg-panel md:h-[min(760px,100%)] md:max-w-[820px] md:rounded-3xl md:border md:border-line md:shadow-[var(--shadow)]"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-text">
            <FileIcon kind={file.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{file.name}</span>
            <span className="block text-xs text-fg-3">{label(file)}</span>
          </span>
          <IconButton aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        <div className="scroll min-h-0 flex-1">
          {file.image ? (
            <img src={`data:${file.mime};base64,${file.image}`} alt={file.name} className="mx-auto max-w-full p-4" />
          ) : (
            <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[13px] leading-relaxed text-fg-2">{file.text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
