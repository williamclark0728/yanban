import type { Attachment } from "../types";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_BYTES = 60 * 1024 * 1024;
const MAX_CHARS = 60_000; // per file, roughly 20–40k tokens
const MAX_ZIP_CHARS = 120_000; // all files in an archive together
const MAX_IMAGE_SIDE = 2048;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|log|tex|bib|html|htm|css|js|jsx|ts|tsx|py|ipynb|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bat|ps1|sql|r|m|swift|kt|vue|svelte)$/i;

const SHEET_EXT = /\.(xlsx|xlsm|xls|ods)$/i;
const ARCHIVE_EXT = /\.zip$/i;

export function formatSize(size: number | string) {
  if (typeof size === "string") return size;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export class FileReadError extends Error {}

/** Numbers each line so agents can cite "第 12 行". */
const numberLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, i) => `${i + 1}| ${line}`)
    .join("\n");

function cap(text: string) {
  return text.length > MAX_CHARS ? { text: text.slice(0, MAX_CHARS), truncated: true } : { text, truncated: false };
}

async function readPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // Chinese PDFs (LaTeX, Word exports) use CID fonts; without the character maps their text comes out empty.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
  const pages: string[] = [];
  let total = 0;
  for (let n = 1; n <= doc.numPages && total < MAX_CHARS; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let page = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      page += item.str + (item.hasEOL ? "\n" : "");
    }
    page = page.replace(/[ \t]+\n/g, "\n").trim();
    pages.push(`【第 ${n} 页】\n${page}`);
    total += page.length;
  }
  const joined = pages.join("\n\n");
  if (!joined.replace(/【第 \d+ 页】/g, "").trim()) throw new FileReadError("这个 PDF 没有可提取的文字（可能是扫描件）");
  const { text, truncated } = cap(joined);
  return { text, truncated: truncated || pages.length < doc.numPages, pages: doc.numPages };
}

async function readDocx(file: File) {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const paragraphs = value.split(/\n+/).map((p) => p.trim()).filter(Boolean).join("\n");
  if (!paragraphs) throw new FileReadError("这个 Word 文件里没有文字");
  return cap(numberLines(paragraphs));
}

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10)) : ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e.toLowerCase()]!,
  );

/** The text of each paragraph in a piece of DrawingML (slides and notes). */
const paragraphs = (xml: string) =>
  xml
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1])).join("").trim())
    .filter(Boolean);

async function readSheet(file: File) {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer());
  const sheets = book.SheetNames.map((n) => ({ n, csv: XLSX.utils.sheet_to_csv(book.Sheets[n], { blankrows: false }).trim() })).filter((s) => s.csv);
  if (!sheets.length) throw new FileReadError("这个表格是空的");
  return cap(sheets.map((s) => `【工作表 ${s.n}】\n${s.csv}`).join("\n\n"));
}

async function readSlides(file: File) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const parts = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(f.name),
  });
  const page = (name: string) => Number(/(\d+)\.xml$/.exec(name)![1]);
  const slides = Object.keys(parts).filter((n) => n.startsWith("ppt/slides/")).sort((a, b) => page(a) - page(b));
  if (!slides.length) throw new FileReadError("PPT 打不开");
  const text = slides
    .map((name) => {
      const n = page(name);
      const notes = parts[`ppt/notesSlides/notesSlide${n}.xml`];
      // Notes pages also hold the slide number; drop lines that are only digits.
      const said = notes ? paragraphs(strFromU8(notes)).filter((l) => !/^\d+$/.test(l)) : [];
      return [`【第 ${n} 页】`, ...paragraphs(strFromU8(parts[name])), said.length ? `讲稿：${said.join(" ")}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n");
  return { ...cap(text), pages: slides.length };
}

/** Zip entry names without the UTF-8 flag are usually GBK on Chinese Windows; fflate reads them as Latin-1. */
function entryName(name: string) {
  if (!/[\x80-\xff]/.test(name) || /[^\x00-\xff]/.test(name)) return name;
  const bytes = Uint8Array.from(name, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gbk").decode(bytes);
  }
}

/** A file list plus the readable files' contents, up to a total budget. */
async function readZip(file: File) {
  const { unzipSync } = await import("fflate");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new FileReadError("压缩包打不开（只支持 .zip，可能已损坏或加密）");
  }
  const names = Object.keys(entries).filter((p) => !p.endsWith("/") && !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(p));
  if (!names.length) throw new FileReadError("压缩包是空的");
  const listing = names.slice(0, 300).map((p) => `- ${entryName(p)}（${formatSize(entries[p].length)}）`);
  if (names.length > 300) listing.push(`- ……还有 ${names.length - 300} 个文件`);
  const contents: string[] = [];
  let total = 0;
  let skipped = 0;
  for (const p of names) {
    const path = entryName(p);
    const base = path.split("/").pop()!;
    const readable = TEXT_EXT.test(base) || /\.(pdf|docx|pptx)$/i.test(base) || SHEET_EXT.test(base);
    if (!readable) continue;
    if (total >= MAX_ZIP_CHARS) {
      skipped++;
      continue;
    }
    try {
      const a = await readAttachment(new File([entries[p] as BlobPart], base));
      if (!a.text) continue;
      const text = a.text.slice(0, MAX_ZIP_CHARS - total);
      contents.push(`<文件 路径="${path}"${text.length < a.text.length || a.truncated ? " 只附上前一部分" : ""}>\n${text}\n</文件>`);
      total += text.length;
    } catch {
      /* unreadable entries stay in the list only */
    }
  }
  const head = `压缩包里有 ${names.length} 个文件：\n${listing.join("\n")}`;
  const tail = skipped ? `\n\n（还有 ${skipped} 个文件内容太多没有附上，需要时请用户单独上传）` : "";
  return { text: [head, ...contents].join("\n\n") + tail, truncated: skipped > 0 };
}

/** Loads an image, shrinking very large ones so requests stay small. */
async function readImage(file: File): Promise<{ image: string; mime: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 4 * 1024 * 1024 && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { image: btoa(bin), mime: file.type };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { image: canvas.toDataURL("image/jpeg", 0.88).split(",")[1], mime: "image/jpeg" };
  } catch {
    throw new FileReadError("图片打不开");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name.toLowerCase();
  const limit = ARCHIVE_EXT.test(name) ? MAX_ZIP_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) throw new FileReadError(`超过 ${formatSize(limit)}`);
  const base = { id: crypto.randomUUID(), name: file.name || "粘贴的图片", size: file.size, mime: file.type };

  if (file.type.startsWith("image/")) return { ...base, kind: "image", ...(await readImage(file)) };
  if (name.endsWith(".pdf") || file.type === "application/pdf") return { ...base, kind: "pdf", ...(await readPdf(file)) };
  if (name.endsWith(".docx")) return { ...base, kind: "docx", ...(await readDocx(file)) };
  if (name.endsWith(".pptx")) return { ...base, kind: "slides", ...(await readSlides(file)) };
  if (SHEET_EXT.test(name)) return { ...base, kind: "sheet", ...(await readSheet(file)) };
  if (ARCHIVE_EXT.test(name)) return { ...base, kind: "zip", ...(await readZip(file)) };
  if (name.endsWith(".doc")) throw new FileReadError("旧版 .doc 请另存为 .docx 再上传");
  if (name.endsWith(".ppt")) throw new FileReadError("旧版 .ppt 请另存为 .pptx 再上传");
  if (/\.(rar|7z|tar|gz|tgz)$/.test(name)) throw new FileReadError("只能读 .zip 压缩包，请重新压缩成 zip");
  // Anything else is tried as text: config files, code in less common languages, logs without an extension.
  const raw = await file.text();
  if (raw.includes("\u0000") || (raw.match(/�/g)?.length ?? 0) > raw.length / 50) {
    throw new FileReadError("暂不支持这种文件，可以上传文本、代码、PDF、Word、Excel、PPT、zip 压缩包或图片");
  }
  return { ...base, kind: "text", ...cap(numberLines(raw)) };
}

/** Text blocks appended to the user's message so any model can read the files. */
export function attachmentText(files: Attachment[] = []) {
  return files
    .filter((f) => f.text)
    .map((f) => {
      if (f.skill) return `<技能 名称="${f.name}">用户指定用这个技能完成这次请求，按下面的说明做：\n${f.text}\n</技能>`;
      const note = f.truncated ? "（内容较长，只附上前一部分）" : "";
      return `<附件 文件名="${f.name}"${f.pages ? ` 页数="${f.pages}"` : ""}>${note}\n${f.text}\n</附件>`;
    })
    .join("\n\n");
}

export const hasImages = (files: Attachment[] = []) => files.some((f) => f.kind === "image" && f.image);
