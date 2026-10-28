// Knowledge base: papers and notes split into passages, searched with BM25, cited by file and page.
// Keyword search needs no embedding model, so it works the same on the website and the desktop app.
import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { Chunk, Library, LibraryDoc } from "../types";
import { db } from "./db";
import { readAttachment } from "./files";
import type { Report } from "./tools";

/** Whole papers, not the 60k characters an attachment keeps. */
const MAX_DOC_CHARS = 2_000_000;
const CHUNK = 900;

// ---------- splitting ----------

/** A paragraph longer than a passage, cut at sentence ends (a Word paragraph can run for pages). */
function pieces(line: string): string[] {
  if (line.length <= CHUNK) return [line];
  const out: string[] = [];
  let buf = "";
  for (const s of line.match(/[^。！？；.!?;]+[。！？；.!?;]*/g) ?? [line]) {
    if (buf && buf.length + s.length > CHUNK) {
      out.push(buf);
      buf = "";
    }
    buf += s;
    while (buf.length > CHUNK * 1.5) {
      out.push(buf.slice(0, CHUNK));
      buf = buf.slice(CHUNK);
    }
  }
  if (buf) out.push(buf);
  return out;
}

interface Part {
  label: string;
  lines: string[];
}

/** Pages (PDF, PPT), sheets, or numbered lines (text, Word) → passages of about CHUNK characters, each with where it is. */
export function splitText(text: string): { loc: string; text: string }[] {
  const out: { loc: string; text: string }[] = [];
  const marker = /^【(第 \d+ 页|工作表 [^】]+)】$/;
  if (text.split("\n").some((l) => marker.test(l))) {
    const parts: Part[] = [];
    for (const line of text.split("\n")) {
      const m = marker.exec(line);
      if (m) parts.push({ label: m[1], lines: [] });
      else if (line.trim()) (parts.at(-1) ?? parts[parts.push({ label: "", lines: [] }) - 1]).lines.push(...pieces(line.trim()));
    }
    for (const p of parts) {
      let buf = "";
      for (const line of p.lines) {
        if (buf && buf.length + line.length > CHUNK) {
          out.push({ loc: p.label, text: buf });
          buf = "";
        }
        buf = buf ? `${buf}\n${line}` : line;
      }
      if (buf) out.push({ loc: p.label, text: buf });
    }
    return out;
  }
  // Numbered lines ("12| …"): keep the range, drop the numbers to save tokens.
  let buf = "";
  let first = 0;
  let last = 0;
  const flush = () => {
    if (buf.trim()) out.push({ loc: first === last ? `第 ${first} 行` : `第 ${first}–${last} 行`, text: buf.trim() });
    buf = "";
  };
  text.split("\n").forEach((raw, i) => {
    const m = /^(\d+)\| ?(.*)$/.exec(raw);
    const n = m ? Number(m[1]) : i + 1;
    const whole = (m ? m[2] : raw).trim();
    for (const line of whole ? pieces(whole) : []) {
      if (buf && buf.length + line.length > CHUNK) flush();
      if (!buf) first = n;
      last = n;
      buf = buf ? `${buf}\n${line}` : line;
    }
  });
  flush();
  return out;
}

// ---------- BM25 ----------

/** Latin words and numbers whole; Chinese as overlapping pairs of characters, which works without a word list. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  const low = text.toLowerCase();
  for (const m of low.matchAll(/[a-z0-9]+(?:[.\-][a-z0-9]+)*/g)) if (m[0].length > 1 || /\d/.test(m[0])) out.push(m[0]);
  for (const run of low.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

interface Index {
  chunks: Chunk[];
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avg: number;
}

const indexes = new Map<string, Promise<Index>>();

function build(chunks: Chunk[]): Index {
  const df = new Map<string, number>();
  const tf = chunks.map((c) => {
    const counts = new Map<string, number>();
    for (const t of tokens(`${c.name} ${c.text}`)) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return counts;
  });
  const len = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  return { chunks, tf, len, df, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length) };
}

const indexOf = (lib: string) => {
  let i = indexes.get(lib);
  if (!i) {
    i = db.chunks.where("lib").equals(lib).toArray().then(build);
    indexes.set(lib, i);
  }
  return i;
};

export interface Passage extends Chunk {
  score: number;
}

/** The best passages for a query across the given libraries. */
export async function searchLibraries(query: string, libs: string[], k = 6): Promise<Passage[]> {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const found: Passage[] = [];
  for (const lib of libs) {
    const ix = await indexOf(lib);
    const n = ix.chunks.length;
    ix.chunks.forEach((c, i) => {
      let score = 0;
      for (const t of q) {
        const f = ix.tf[i].get(t);
        if (!f) continue;
        const d = ix.df.get(t)!;
        const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * ix.len[i]) / ix.avg));
      }
      if (score > 0) found.push({ ...c, score });
    });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, k);
}

// ---------- libraries ----------

const save = (libraries: Library[]) => useData.getState().setLibraries(libraries);

export function createLibrary(name: string) {
  const lib: Library = { id: crypto.randomUUID().slice(0, 8), name: name.trim() || "资料库", enabled: true, docs: [], at: Date.now() };
  save([...useData.getState().libraries, lib]);
  return lib.id;
}

export async function deleteLibrary(id: string) {
  await db.chunks.where("lib").equals(id).delete();
  indexes.delete(id);
  save(useData.getState().libraries.filter((l) => l.id !== id));
}

export async function removeDoc(lib: string, doc: string) {
  await db.chunks.where("doc").equals(doc).delete();
  indexes.delete(lib);
  save(useData.getState().libraries.map((l) => (l.id === lib ? { ...l, docs: l.docs.filter((d) => d.id !== doc) } : l)));
}

/** Reads a file, splits it and stores its passages. A file with the same name is replaced. */
export async function addDoc(lib: string, file: File): Promise<LibraryDoc> {
  const read = await readAttachment(file, MAX_DOC_CHARS);
  if (!read.text || read.kind === "image") throw new Error("没有可检索的文字");
  const name = file.webkitRelativePath || file.name;
  const parts = splitText(read.text);
  const doc: LibraryDoc = { id: crypto.randomUUID(), name, size: file.size, chars: read.text.length, chunks: parts.length, at: Date.now() };
  const old = useData.getState().libraries.find((l) => l.id === lib)?.docs.find((d) => d.name === name);
  if (old) await db.chunks.where("doc").equals(old.id).delete();
  await db.chunks.bulkPut(parts.map((p, i) => ({ id: `${doc.id}:${i}`, lib, doc: doc.id, name, loc: p.loc, text: p.text })));
  indexes.delete(lib);
  save(useData.getState().libraries.map((l) => (l.id === lib ? { ...l, docs: [...l.docs.filter((d) => d.name !== name), doc] } : l)));
  return doc;
}

// ---------- the tool ----------

const ready = () => useData.getState().libraries.filter((l) => l.enabled && l.docs.length);

export function libraryRules() {
  const libs = ready();
  if (!libs.length) return "";
  return [
    `用户建了资料库，你可以用 search_library 检索：${libs.map((l) => `「${l.name}」（${l.docs.length} 个文件）`).join("、")}。`,
    "问题涉及用户的论文、笔记或资料库里可能有的内容时，先检索再回答；换几个关键词多查一两次。引用资料时在句末写出处，如【论文A.pdf · 第 3 页】；资料里没有的内容要说明是你自己的补充。",
  ].join("\n");
}

export function libraryTools(report: Report): ToolSet {
  const libs = ready();
  if (!libs.length) return {};
  return {
    search_library: tool({
      description: "在用户的资料库里按关键词检索，返回最相关的段落和出处（文件名、页码或行号）。",
      inputSchema: jsonSchema<{ query: string; library?: string }>({
        type: "object",
        properties: {
          query: { type: "string", description: "关键词或一句话问题，比如 “稀疏 剪枝 显存”" },
          library: { type: "string", enum: libs.map((l) => l.name), description: "只查这一个库；不写就查全部" },
        },
        required: ["query"],
      }),
      execute: async ({ query, library }, { toolCallId }) => {
        const scope = libs.filter((l) => !library || l.name === library);
        const hits = await searchLibraries(query, (scope.length ? scope : libs).map((l) => l.id));
        const where = (h: Passage) => `${h.name}${h.loc ? ` · ${h.loc}` : ""}`;
        report({
          id: toolCallId,
          name: "search_library",
          label: query,
          status: "done",
          detail: `${hits.length} 段`,
          passages: hits.map((h) => ({ title: where(h), text: h.text.slice(0, 300) })),
        });
        if (!hits.length) return `资料库里没有找到和「${query}」相关的内容。换个关键词再查，或者如实告诉用户资料库里没有。`;
        return hits.map((h, i) => `[${i + 1}]【${where(h)}】\n${h.text}`).join("\n\n");
      },
    }),
  };
}
