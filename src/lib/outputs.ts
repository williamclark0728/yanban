import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { FileFormat, MadeFile } from "../types";
import type { Report } from "./tools";

export const FORMATS: Record<FileFormat, string> = { md: "Markdown", docx: "Word 文档", xlsx: "Excel 表格", pptx: "PPT" };

export const FILE_RULES = [
  "用户要你生成文件（Word 文档、Excel 表格、PPT、Markdown 文件）时，调用 make_file，文件会附在你的回复里，用户可以预览和下载：",
  "- docx / md：markdown 写完整正文，可以用标题、列表、表格、加粗。",
  "- xlsx：sheets 写每个工作表，rows 的第一行是表头；单元格都写成字符串，纯数字会自动存成数字。",
  "- pptx：title、subtitle 是封面；slides 每页写 title、bullets（3–6 条，每条一句话）和 notes（这一页的讲稿）。版式由程序套用，不用写格式。",
  "调用后在回复里用一两句话说明文件内容，不要把全文再贴一遍。用户没要文件时不要调用。",
].join("\n");

export const fileName = (f: MadeFile) => `${f.name}.${f.format}`;

export function describeFile(f: MadeFile) {
  if (f.format === "xlsx") return `${f.sheets?.length ?? 0} 个工作表，${f.sheets?.reduce((n, s) => n + s.rows.length, 0) ?? 0} 行`;
  if (f.format === "pptx") return `${(f.slides?.length ?? 0) + 1} 页`;
  return `${(f.markdown ?? "").replace(/\s/g, "").length.toLocaleString()} 字`;
}

/** The file as plain text, so other members can read and review it in the group transcript. */
export function fileText(f: MadeFile) {
  if (f.format === "xlsx") return (f.sheets ?? []).map((s) => [`工作表「${s.name}」`, ...s.rows.map((r) => r.join(" | "))].join("\n")).join("\n\n");
  if (f.format === "pptx") {
    const cover = `封面：${[f.title, f.subtitle].filter(Boolean).join(" — ")}`;
    const pages = (f.slides ?? []).map((s, i) =>
      [`第 ${i + 2} 页：${s.title}`, ...s.bullets.map((b) => `- ${b}`), s.notes && `讲稿：${s.notes}`].filter(Boolean).join("\n"),
    );
    return [cover, ...pages].join("\n\n");
  }
  return f.markdown ?? "";
}

export const filesText = (files?: MadeFile[]) => (files ?? []).map((f) => `<生成的文件 文件名="${fileName(f)}">\n${fileText(f)}\n</生成的文件>`).join("\n\n");

interface Input {
  format?: string;
  name?: string;
  markdown?: string;
  sheets?: { name?: string; rows?: unknown[][] }[];
  title?: string;
  subtitle?: string;
  slides?: { title?: string; bullets?: unknown[]; notes?: string }[];
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : []);

/** Checks what the model sent and fills in defaults; a string is the reason it can't be used. */
export function toFile(input: Input): MadeFile | string {
  const format = (["md", "docx", "xlsx", "pptx"] as const).find((x) => x === str(input.format).toLowerCase().replace(/^\./, ""));
  if (!format) return "format 只能是 md、docx、xlsx、pptx";
  const name = str(input.name).replace(/\.(md|docx|xlsx|pptx)$/i, "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "未命名";
  const f: MadeFile = { id: crypto.randomUUID(), format, name };
  if (format === "md" || format === "docx") {
    f.markdown = str(input.markdown);
    if (!f.markdown) return "缺少 markdown 正文";
  } else if (format === "xlsx") {
    const used = new Set<string>();
    f.sheets = list<NonNullable<Input["sheets"]>[number]>(input.sheets)
      .map((s, i) => {
        // Excel limits sheet names to 31 characters, without []:*?/\ and unique within the workbook.
        let sheet = str(s?.name).replace(/[[\]:*?/\\]/g, "_").slice(0, 28) || `Sheet${i + 1}`;
        while (used.has(sheet)) sheet += "_";
        used.add(sheet);
        return { name: sheet, rows: list<unknown[]>(s?.rows).filter(Array.isArray).map((r) => r.map((c) => (typeof c === "number" ? c : str(c)))) };
      })
      .filter((s) => s.rows.length);
    if (!f.sheets.length) return "缺少 sheets 数据";
  } else {
    f.slides = list<NonNullable<Input["slides"]>[number]>(input.slides)
      .map((s) => ({ title: str(s?.title), bullets: list(s?.bullets).map(str).filter(Boolean), notes: str(s?.notes) || undefined }))
      .filter((s) => s.title || s.bullets.length);
    if (!f.slides.length) return "缺少 slides";
    f.title = str(input.title) || name;
    f.subtitle = str(input.subtitle) || undefined;
  }
  return f;
}

/** make_file: the agent writes the content, the browser builds the file when the user downloads it. */
export function fileTools(messageId: string, report: Report): ToolSet {
  return {
    make_file: tool({
      description: "生成一个文件（Word、Excel、PPT 或 Markdown），附在你的回复里供用户预览和下载。",
      inputSchema: jsonSchema<Input>({
        type: "object",
        properties: {
          format: { type: "string", enum: ["docx", "xlsx", "pptx", "md"], description: "文件格式" },
          name: { type: "string", description: "文件名，不带扩展名" },
          markdown: { type: "string", description: "docx、md 的正文（Markdown）" },
          sheets: {
            type: "array",
            description: "xlsx 的工作表",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                rows: { type: "array", description: "每行是一个字符串数组，第一行是表头", items: { type: "array", items: { type: "string" } } },
              },
              required: ["name", "rows"],
            },
          },
          title: { type: "string", description: "pptx 封面标题" },
          subtitle: { type: "string", description: "pptx 封面副标题" },
          slides: {
            type: "array",
            description: "pptx 封面之后的每一页",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                notes: { type: "string", description: "这一页的讲稿" },
              },
              required: ["title", "bullets"],
            },
          },
        },
        required: ["format", "name"],
      }),
      execute: async (input, { toolCallId }) => {
        const f = toFile(input);
        const base = { id: toolCallId, name: "make_file" as const, label: typeof f === "string" ? str(input.name) || "文件" : fileName(f) };
        if (typeof f === "string") {
          report({ ...base, status: "error", detail: f });
          return `没有生成：${f}。补全后再调用一次。`;
        }
        const { messages, patchMessage } = useData.getState();
        const msg = messages.find((m) => m.id === messageId);
        const files = msg?.kind === "text" ? (msg.files ?? []) : [];
        patchMessage(messageId, { files: [...files.filter((x) => fileName(x) !== fileName(f)), f] }, true);
        report({ ...base, status: "done", detail: describeFile(f) });
        return `已生成 ${fileName(f)}（${describeFile(f)}），附在你的回复里。`;
      },
    }),
  };
}

/** Builds the file (the libraries load only now) and saves it. */
export async function download(f: MadeFile) {
  const { buildFile } = await import("./filegen");
  const url = URL.createObjectURL(await buildFile(f));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(f);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A reply saved as a Word document, named after its first line. */
export function replyAsDocx(text: string, fallback: string): MadeFile {
  const first = text.split("\n").map((l) => l.replace(/[#*>`_|-]/g, "").trim()).find(Boolean) ?? "";
  const name = first.replace(/[\\/:*?"<>|]/g, "_").slice(0, 24) || fallback;
  return { id: crypto.randomUUID(), format: "docx", name, markdown: text };
}
