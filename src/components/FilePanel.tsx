import clsx from "clsx";
import { ExternalLink, FolderOpen, Loader2, RotateCw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { call } from "../lib/desktop";
import { formatSize, readAttachment } from "../lib/files";
import { useData, useUi, type Pane } from "../store";
import { FileIcon, kindOf } from "./FileCard";
import { RichText } from "./MessageItem";
import { IconButton } from "./ui";

type Shown =
  | { kind: "html"; html: string }
  | { kind: "sheets"; sheets: { name: string; rows: string[][] }[] }
  | { kind: "pages"; pages: { title: string; text: string }[] }
  | { kind: "markdown"; text: string }
  | { kind: "text"; text: string }
  | { kind: "url"; url: string; as: "image" | "pdf" };

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const IMAGE = /^(png|jpe?g|gif|webp|bmp|svg)$/;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", pdf: "application/pdf" };

/** Attachment text is numbered ("12| …") for the model; the preview shows it without the numbers. */
const unnumber = (text: string) => text.replace(/^\d+\| ?/gm, "");

/** Splits 【第 n 页】 / 【工作表 x】 markers into separate cards. */
function pages(text: string) {
  const out: { title: string; text: string }[] = [];
  for (const part of text.split(/^(?=【[^】]+】$)/m)) {
    const m = /^【([^】]+)】\n?/.exec(part);
    out.push({ title: m?.[1] ?? "", text: (m ? part.slice(m[0].length) : part).trim() });
  }
  return out.filter((p) => p.text || p.title);
}

async function show(name: string, bytes: ArrayBuffer): Promise<Shown> {
  const e = ext(name);
  if (IMAGE.test(e) || e === "pdf") return { kind: "url", url: URL.createObjectURL(new Blob([bytes], { type: MIME[e] })), as: e === "pdf" ? "pdf" : "image" };
  if (e === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes });
    return { kind: "html", html: value };
  }
  if (/^(xlsx|xls|csv)$/.test(e)) {
    const XLSX = await import("xlsx");
    const book = XLSX.read(bytes);
    return {
      kind: "sheets",
      sheets: book.SheetNames.map((n) => ({
        name: n,
        rows: (XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[n], { header: 1, blankrows: false }) as unknown[][]).slice(0, 500).map((r) => r.map((c) => String(c ?? ""))),
      })),
    };
  }
  if (e === "pptx") {
    const a = await readAttachment(new File([bytes], name), 2_000_000);
    return { kind: "pages", pages: pages(a.text ?? "") };
  }
  const text = new TextDecoder().decode(bytes);
  if (/^(md|markdown)$/.test(e)) return { kind: "markdown", text };
  return { kind: "text", text: text.length > 400_000 ? `${text.slice(0, 400_000)}\n…` : text };
}

const abs = (root: string, path: string) => `${root.replace(/[\\/]+$/, "")}\\${path.replace(/\//g, "\\")}`;

/** The right-hand panel showing one file: a workspace file (desktop) or an attachment. */
export function FilePanel({ pane }: { pane: Extract<Pane, { kind: "file" | "attachment" }> }) {
  const closePane = useUi((s) => s.closePane);
  const agents = useData((s) => s.agents);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState("");
  const [size, setSize] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [sheet, setSheet] = useState(0);
  const name = pane.kind === "file" ? pane.path : pane.file.name;

  useEffect(() => {
    let alive = true;
    let url = "";
    setShown(null);
    setError("");
    (async () => {
      if (pane.kind === "file") {
        const bytes = await call<ArrayBuffer>("ws_read_bytes", { root: pane.root, path: pane.path });
        setSize(bytes.byteLength);
        return show(pane.path, bytes);
      }
      const f = pane.file;
      setSize(typeof f.size === "number" ? f.size : null);
      if (f.image) return { kind: "url" as const, url: `data:${f.mime};base64,${f.image}`, as: "image" as const };
      const text = f.kind === "docx" || f.kind === "text" ? unnumber(f.text ?? "") : (f.text ?? "");
      if (/【[^】]+】/.test(text)) return { kind: "pages" as const, pages: pages(text) };
      return /^(md|markdown)$/.test(ext(f.name)) ? { kind: "markdown" as const, text } : { kind: "text" as const, text };
    })().then(
      (s) => {
        if (s.kind === "url" && s.url.startsWith("blob:")) url = s.url;
        if (alive) setShown(s);
      },
      (e: Error) => alive && setError(e.message || "打不开这个文件"),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pane, round]);

  const buttons: ReactNode = pane.kind === "file" && (
    <>
      <IconButton aria-label="刷新" title="重新读取" onClick={() => setRound((r) => r + 1)}>
        <RotateCw size={16} />
      </IconButton>
      <IconButton aria-label="用默认程序打开" title="用默认程序打开" onClick={() => void call("open_file", { path: abs(pane.root, pane.path) }).catch((e: Error) => setError(e.message))}>
        <ExternalLink size={16} />
      </IconButton>
      <IconButton aria-label="在文件夹中显示" title="在文件夹中显示" onClick={() => void call("reveal", { path: abs(pane.root, pane.path) })}>
        <FolderOpen size={16} />
      </IconButton>
    </>
  );

  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
          <FileIcon kind={pane.kind === "attachment" ? pane.file.kind : kindOf(pane.path)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold" title={name}>
            {name.split(/[\\/]/).pop()}
          </span>
          <span className="block truncate text-[12px] text-fg-3">
            {[pane.kind === "file" ? name : "附件", size !== null && formatSize(size)].filter(Boolean).join(" · ")}
          </span>
        </span>
        {buttons}
        <IconButton aria-label="关闭" onClick={closePane}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="scroll min-h-0 flex-1">
        {error ? (
          <div className="m-4 rounded-2xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div>
        ) : !shown ? (
          <div className="flex items-center justify-center gap-2 py-16 text-fg-2">
            <Loader2 size={16} className="animate-spin" /> 正在读取…
          </div>
        ) : shown.kind === "url" ? (
          shown.as === "image" ? (
            <img src={shown.url} alt={name} className="mx-auto max-w-full p-4" />
          ) : (
            <iframe src={shown.url} title={name} className="h-full w-full border-0" />
          )
        ) : shown.kind === "html" ? (
          <div className="prose-chat doc-preview px-5 py-4" dangerouslySetInnerHTML={{ __html: shown.html }} />
        ) : shown.kind === "markdown" ? (
          <div className="px-5 py-4">
            <RichText text={shown.text} agents={agents} />
          </div>
        ) : shown.kind === "pages" ? (
          <div className="space-y-3 p-4">
            {shown.pages.map((p, i) => (
              <div key={i} className="rounded-2xl border border-line bg-raise px-4 py-3">
                {p.title && <div className="mb-1.5 text-[12px] font-medium text-fg-3">{p.title}</div>}
                <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.text}</div>
              </div>
            ))}
          </div>
        ) : shown.kind === "sheets" ? (
          <div className="p-3">
            {shown.sheets.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {shown.sheets.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setSheet(i)}
                    className={clsx("rounded-full px-3 py-1 text-[13px]", i === sheet ? "bg-active font-medium" : "text-fg-2 hover:bg-hover")}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {(shown.sheets[sheet] ?? shown.sheets[0])?.rows.map((r, i) => (
                    <tr key={i} className={clsx(i === 0 && "bg-raise-2 font-medium")}>
                      {r.map((c, j) => (
                        <td key={j} className="whitespace-nowrap border-b border-r border-line px-2.5 py-1.5">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[13px] leading-relaxed text-fg-2">{shown.text}</pre>
        )}
      </div>
    </aside>
  );
}
