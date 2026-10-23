import type { Attachment } from "../types";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CHARS = 60_000; // per file, roughly 20–40k tokens
const MAX_IMAGE_SIDE = 2048;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|log|tex|bib|html|htm|css|js|jsx|ts|tsx|py|ipynb|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bat|ps1|sql|r|m|swift|kt|vue|svelte)$/i;

export const ACCEPT = ".txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.tex,.bib,.html,.py,.js,.ts,.tsx,.java,.c,.cpp,.go,.rs,.sql,.m,.pdf,.docx,image/*";

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
  if (file.size > MAX_FILE_BYTES) throw new FileReadError(`超过 ${formatSize(MAX_FILE_BYTES)}`);
  const base = { id: crypto.randomUUID(), name: file.name || "粘贴的图片", size: file.size, mime: file.type };
  const name = file.name.toLowerCase();

  if (file.type.startsWith("image/")) return { ...base, kind: "image", ...(await readImage(file)) };
  if (name.endsWith(".pdf") || file.type === "application/pdf") return { ...base, kind: "pdf", ...(await readPdf(file)) };
  if (name.endsWith(".docx")) return { ...base, kind: "docx", ...(await readDocx(file)) };
  if (name.endsWith(".doc")) throw new FileReadError("旧版 .doc 请另存为 .docx 再上传");
  if (TEXT_EXT.test(name) || file.type.startsWith("text/")) {
    const raw = await file.text();
    if (raw.includes("\u0000")) throw new FileReadError("不是文本文件");
    return { ...base, kind: "text", ...cap(numberLines(raw)) };
  }
  throw new FileReadError("暂不支持这种文件，可以上传文本、PDF、Word 或图片");
}

/** Text blocks appended to the user's message so any model can read the files. */
export function attachmentText(files: Attachment[] = []) {
  return files
    .filter((f) => f.text)
    .map((f) => {
      const note = f.truncated ? "（内容较长，只附上前一部分）" : "";
      return `<附件 文件名="${f.name}"${f.pages ? ` 页数="${f.pages}"` : ""}>${note}\n${f.text}\n</附件>`;
    })
    .join("\n\n");
}

export const hasImages = (files: Attachment[] = []) => files.some((f) => f.kind === "image" && f.image);
