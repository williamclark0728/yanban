// Builds downloadable files from what an agent wrote. Loaded on demand, so the libraries stay out of the first page load.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { List, ListItem, PhrasingContent, RootContent, Table as MdTable } from "mdast";
import PptxGenJS from "pptxgenjs";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import * as XLSX from "xlsx";
import type { MadeFile, Sheet, Slide } from "../types";

export async function buildFile(f: MadeFile): Promise<Blob> {
  switch (f.format) {
    case "md":
      return new Blob([f.markdown ?? ""], { type: "text/markdown;charset=utf-8" });
    case "docx":
      return Packer.toBlob(markdownToDocx(f.markdown ?? "", f.name));
    case "xlsx":
      return workbook(f.sheets ?? []);
    case "pptx":
      return deck(f.title ?? f.name, f.subtitle, f.slides ?? []);
  }
}

// ---------- Word ----------

interface Marks {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
}

const CJK = "\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef";
// A soft line break joins Chinese text directly and other text with a space.
const unwrap = (s: string) => s.replace(new RegExp(`(?<=[${CJK}])\\n(?=[${CJK}])`, "g"), "").replace(/\n/g, " ");

const shade = (fill: string) => ({ type: ShadingType.CLEAR, fill, color: "auto" });

const run = (text: string, m: Marks) =>
  new TextRun({
    text,
    bold: m.bold,
    italics: m.italics,
    strike: m.strike,
    style: m.link ? "Hyperlink" : undefined,
    font: m.code ? "Consolas" : undefined,
    shading: m.code ? shade("F2F2F2") : undefined,
  });

function inline(nodes: PhrasingContent[], m: Marks = {}): ParagraphChild[] {
  return nodes.flatMap((n): ParagraphChild[] => {
    switch (n.type) {
      case "text":
        return [run(unwrap(n.value), m)];
      case "strong":
        return inline(n.children, { ...m, bold: true });
      case "emphasis":
        return inline(n.children, { ...m, italics: true });
      case "delete":
        return inline(n.children, { ...m, strike: true });
      case "inlineCode":
        return [run(n.value, { ...m, code: true })];
      case "break":
        return [new TextRun({ break: 1 })];
      case "link":
        return [new ExternalHyperlink({ link: n.url, children: inline(n.children, { ...m, link: true }) })];
      case "image":
        return [run(n.alt ? `[图片：${n.alt}]` : "[图片]", m)];
      case "html":
        return [run(n.value, m)];
      default:
        return "children" in n ? inline(n.children as PhrasingContent[], m) : "value" in n ? [run(String(n.value), m)] : [];
    }
  });
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

interface Ctx {
  quote?: boolean;
  /** Ordered lists each restart their numbering. */
  lists: { next: number };
}

function blocks(nodes: RootContent[], ctx: Ctx, level = 0): (Paragraph | Table)[] {
  const indent = ctx.quote ? { left: 567 } : undefined;
  return nodes.flatMap((n): (Paragraph | Table)[] => {
    switch (n.type) {
      case "heading":
        return [new Paragraph({ heading: HEADINGS[n.depth - 1], children: inline(n.children) })];
      case "paragraph":
        return [new Paragraph({ children: inline(n.children, { italics: ctx.quote }), indent })];
      case "list":
        return list(n, ctx, level);
      case "blockquote":
        return blocks(n.children, { ...ctx, quote: true }, level);
      case "code":
        return n.value.split("\n").map((line) => new Paragraph({ children: [run(line || " ", { code: true })], shading: shade("F5F5F5"), spacing: { after: 0 } }));
      case "table":
        return [table(n)];
      case "thematicBreak":
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 1 } } })];
      case "html":
        return [new Paragraph({ children: [run(n.value, {})] })];
      default:
        return [];
    }
  });
}

function list(n: List, ctx: Ctx, level: number): (Paragraph | Table)[] {
  const instance = n.ordered ? ctx.lists.next++ : 0;
  return n.children.flatMap((item: ListItem) => {
    const box = item.checked == null ? "" : item.checked ? "☑ " : "☐ ";
    return item.children.flatMap((child, i): (Paragraph | Table)[] => {
      if (child.type === "list") return list(child, ctx, level + 1);
      if (i === 0 && child.type === "paragraph") {
        const mark = n.ordered ? { numbering: { reference: "ol", level, instance } } : { bullet: { level } };
        return [new Paragraph({ ...mark, children: [...(box ? [run(box, {})] : []), ...inline(child.children)] })];
      }
      // Later paragraphs of an item line up with its text.
      if (child.type === "paragraph") return [new Paragraph({ children: inline(child.children), indent: { left: 720 * (level + 1) } })];
      return blocks([child], ctx, level);
    });
  });
}

function table(n: MdTable) {
  const width = Math.max(...n.children.map((r) => r.children.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: n.children.map(
      (row, r) =>
        new TableRow({
          tableHeader: r === 0,
          children: Array.from({ length: width }, (_, c) => {
            const cell = row.children[c];
            return new TableCell({
              shading: r === 0 ? shade("F2F2F2") : undefined,
              children: [new Paragraph({ children: cell ? inline(cell.children, { bold: r === 0 }) : [] })],
            });
          }),
        }),
    ),
  });
}

function markdownToDocx(markdown: string, title: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return new Document({
    title,
    creator: "研伴",
    styles: { default: { document: { run: { size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } } } },
    numbering: {
      config: [
        {
          reference: "ol",
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocks(tree.children, { lists: { next: 1 } }) }],
  });
}

// ---------- Excel ----------

// Plain numbers become numbers; codes with leading zeros and very long digit strings stay text.
const cell = (v: string | number) => (typeof v === "string" && /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

const displayWidth = (v: unknown) => [...String(v ?? "")].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);

function workbook(sheets: Sheet[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const rows = s.rows.map((r) => r.map(cell));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const cols = Math.max(...rows.map((r) => r.length));
    ws["!cols"] = Array.from({ length: cols }, (_, c) => ({ wch: Math.min(50, Math.max(6, ...rows.map((r) => displayWidth(r[c]) + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------- PowerPoint ----------

const FONT = "Microsoft YaHei";
const ACCENT = "2F6FEB";
const INK = "1F2937";
const MUTED = "6B7280";

/** One built-in layout: a cover, then title-and-bullets pages; a page without bullets becomes a section divider. */
async function deck(title: string, subtitle: string | undefined, slides: Slide[]) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.title = title;

  const cover = pptx.addSlide();
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT } });
  cover.addText(title, { x: 1, y: 1.9, w: 11.3, h: 1.8, fontFace: FONT, fontSize: 40, bold: true, color: INK, valign: "bottom", fit: "shrink" });
  cover.addShape(pptx.ShapeType.line, { x: 1, y: 3.95, w: 1.6, h: 0, line: { color: ACCENT, width: 3 } });
  if (subtitle) cover.addText(subtitle, { x: 1, y: 4.15, w: 11.3, h: 0.9, fontFace: FONT, fontSize: 20, color: MUTED, valign: "top", fit: "shrink" });

  slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    if (s.notes) slide.addNotes(s.notes);
    slide.addText(String(i + 2), { x: 12.1, y: 6.9, w: 0.8, h: 0.4, fontFace: FONT, fontSize: 11, color: MUTED, align: "right" });
    if (!s.bullets.length) {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT } });
      slide.addText(s.title, { x: 1, y: 2.8, w: 11.3, h: 1.6, fontFace: FONT, fontSize: 34, bold: true, color: INK, valign: "middle", fit: "shrink" });
      return;
    }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: ACCENT }, line: { color: ACCENT } });
    slide.addText(s.title, { x: 0.7, y: 0.4, w: 11.9, h: 0.95, fontFace: FONT, fontSize: 28, bold: true, color: INK, valign: "middle", fit: "shrink" });
    slide.addShape(pptx.ShapeType.line, { x: 0.7, y: 1.42, w: 11.9, h: 0, line: { color: "E5E7EB", width: 1 } });
    const size = s.bullets.length > 6 ? 16 : s.bullets.length > 4 ? 18 : 20;
    slide.addText(
      s.bullets.map((b) => ({ text: b, options: { bullet: { indent: 20 }, paraSpaceAfter: 10, breakLine: true } })),
      { x: 0.9, y: 1.7, w: 11.5, h: 5.0, fontFace: FONT, fontSize: size, color: INK, valign: "top", fit: "shrink", lineSpacingMultiple: 1.15 },
    );
  });
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
