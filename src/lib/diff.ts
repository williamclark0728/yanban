import type { DiffLine } from "../types";

const CONTEXT = 3;
// Above this many cells in the middle section the preview only lists removed and added lines.
const MAX_CELLS = 4_000_000;

/** Line diff of two texts for a change preview, with unchanged stretches folded into "gap" lines. */
export function diffLines(before: string, after: string): DiffLine[] {
  // The newline that ends the last line doesn't make an extra empty line.
  const split = (s: string) => (s ? s.replace(/\r?\n$/, "").split(/\r?\n/) : []);
  const a = split(before);
  const b = split(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const lines: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ type: "same" as const, text })),
    ...middle(midA, midB),
    ...a.slice(endA).map((text) => ({ type: "same" as const, text })),
  ];
  return fold(lines);
}

/** Longest common subsequence over the changed middle part. */
function middle(a: string[], b: string[]): DiffLine[] {
  if (!a.length || !b.length || a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  const w = b.length + 1;
  const len = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      len[i * w + j] = a[i] === b[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i++] });
      j++;
    } else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) out.push({ type: "del", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

/** Keeps a few unchanged lines around each change and folds the rest. */
function fold(lines: DiffLine[]): DiffLine[] {
  const near = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.type !== "same") for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) near[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (near[i]) {
      if (skipped) out.push({ type: "gap", text: `${skipped} 行未改动` });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ type: "gap", text: `${skipped} 行未改动` });
  return out.slice(0, 400);
}

export const diffStats = (lines: DiffLine[]) => ({
  added: lines.filter((l) => l.type === "add").length,
  removed: lines.filter((l) => l.type === "del").length,
});
