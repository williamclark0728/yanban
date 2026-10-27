import clsx from "clsx";
import { Download, FileSpreadsheet, FileText, Loader2, Presentation, X } from "lucide-react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describeFile, download, fileName, FORMATS } from "../lib/outputs";
import type { FileFormat, MadeFile } from "../types";
import { IconButton, Tabs } from "./ui";

function FormatIcon({ format, size = 16 }: { format: FileFormat; size?: number }) {
  if (format === "xlsx") return <FileSpreadsheet size={size} />;
  if (format === "pptx") return <Presentation size={size} />;
  return <FileText size={size} />;
}

function useDownload(file: MadeFile) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = () => {
    setBusy(true);
    setError("");
    download(file)
      .catch((e: Error) => setError(e.message || "生成失败"))
      .finally(() => setBusy(false));
  };
  return { busy, error, save };
}

/** Files an agent made: open a preview, or download the real file. */
export function MadeFiles({ files }: { files: MadeFile[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <FileTile key={f.id} file={f} />
      ))}
    </div>
  );
}

function FileTile({ file }: { file: MadeFile }) {
  const [open, setOpen] = useState(false);
  const { busy, error, save } = useDownload(file);
  return (
    <>
      <div className="flex w-[280px] max-w-full items-center gap-2.5 rounded-2xl border border-line bg-raise py-2 pl-2 pr-1.5">
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
            <FormatIcon format={file.format} size={18} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{fileName(file)}</span>
            <span className={clsx("block truncate text-xs", error ? "text-bad" : "text-fg-3")}>
              {error || `${FORMATS[file.format]} · ${describeFile(file)}`}
            </span>
          </span>
        </button>
        <IconButton aria-label="下载" title="下载" onClick={save} disabled={busy}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
        </IconButton>
      </div>
      {open && <Preview file={file} onClose={() => setOpen(false)} />}
    </>
  );
}

function Preview({ file, onClose }: { file: MadeFile; onClose: () => void }) {
  const { busy, save } = useDownload(file);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-full w-full flex-col overflow-hidden bg-panel md:h-[min(820px,100%)] md:max-w-[900px] md:rounded-3xl md:border md:border-line md:shadow-[var(--shadow)]"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-text">
            <FormatIcon format={file.format} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{fileName(file)}</span>
            <span className="block text-xs text-fg-3">
              {FORMATS[file.format]} · {describeFile(file)}
            </span>
          </span>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} 下载
          </button>
          <IconButton aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        <div className="scroll min-h-0 flex-1">
          {file.format === "xlsx" ? <SheetsView file={file} /> : file.format === "pptx" ? <SlidesView file={file} /> : <DocView file={file} />}
        </div>
      </div>
    </div>
  );
}

function DocView({ file }: { file: MadeFile }) {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-6">
      <div className="prose-chat">
        <Markdown remarkPlugins={[remarkGfm]}>{file.markdown ?? ""}</Markdown>
      </div>
    </div>
  );
}

function SheetsView({ file }: { file: MadeFile }) {
  const sheets = file.sheets ?? [];
  const [name, setName] = useState(sheets[0]?.name ?? "");
  const sheet = sheets.find((s) => s.name === name) ?? sheets[0];
  if (!sheet) return null;
  const [head, ...body] = sheet.rows;
  return (
    <div className="px-5 py-4">
      {sheets.length > 1 && (
        <div className="mb-3">
          <Tabs value={sheet.name} tabs={sheets.map((s) => ({ value: s.name, label: s.name }))} onChange={setName} />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-raise-2">
              {head?.map((c, i) => (
                <th key={i} className="border-b border-line px-3 py-2 text-left font-semibold whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {r.map((c, j) => (
                  <td key={j} className={clsx("px-3 py-1.5", typeof c === "number" || /^-?\d+(\.\d+)?%?$/.test(String(c)) ? "text-right tabular-nums" : "")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlidesView({ file }: { file: MadeFile }) {
  const frame = "relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-white text-[#1F2937] shadow-sm";
  return (
    <div className="mx-auto max-w-[760px] space-y-5 px-5 py-5">
      <div>
        <div className={frame}>
          <span className="absolute inset-y-0 left-0 w-[1.9%] bg-[#2F6FEB]" />
          <div className="absolute left-[7.5%] right-[7.5%] top-[25%] h-[25%] flex flex-col justify-end">
            <div className="line-clamp-2 text-[clamp(16px,3.6vw,30px)] font-bold leading-tight">{file.title}</div>
          </div>
          <span className="absolute left-[7.5%] top-[52.5%] h-[3px] w-[12%] bg-[#2F6FEB]" />
          {file.subtitle && <div className="absolute left-[7.5%] right-[7.5%] top-[56%] text-[clamp(11px,1.8vw,15px)] text-[#6B7280]">{file.subtitle}</div>}
        </div>
        <div className="mt-1.5 px-1 text-xs text-fg-3">第 1 页 · 封面</div>
      </div>
      {(file.slides ?? []).map((s, i) => (
        <div key={i}>
          <div className={frame}>
            {s.bullets.length ? (
              <>
                <span className="absolute inset-x-0 top-0 h-[1.6%] bg-[#2F6FEB]" />
                <div className="absolute left-[5.3%] right-[5.3%] top-[6%] text-[clamp(14px,2.6vw,22px)] font-bold leading-tight">{s.title}</div>
                <span className="absolute left-[5.3%] right-[5.3%] top-[19%] h-px bg-[#E5E7EB]" />
                <ul className="absolute left-[6.8%] right-[6.8%] top-[23%] bottom-[8%] list-disc space-y-[1.2%] overflow-hidden pl-[3%] text-[clamp(10px,1.65vw,15px)] leading-snug">
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <span className="absolute inset-y-0 left-0 w-[1.9%] bg-[#2F6FEB]" />
                <div className="absolute left-[7.5%] right-[7.5%] top-1/2 -translate-y-1/2 text-[clamp(15px,3vw,26px)] font-bold">{s.title}</div>
              </>
            )}
            <span className="absolute bottom-[3%] right-[3%] text-[10px] text-[#6B7280]">{i + 2}</span>
          </div>
          <div className="mt-1.5 px-1 text-xs text-fg-3">第 {i + 2} 页</div>
          {s.notes && <div className="mt-1 rounded-lg bg-raise px-3 py-2 text-[13px] leading-relaxed text-fg-2">讲稿：{s.notes}</div>}
        </div>
      ))}
    </div>
  );
}
