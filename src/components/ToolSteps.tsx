import clsx from "clsx";
import { AlertCircle, BookOpen, ChevronDown, FilePlus2, FileText, Globe, Loader2, Plug, Search, Users } from "lucide-react";
import { useUi } from "../store";
import type { ToolTrace } from "../types";

const icons = { web_search: Search, read_page: FileText, dispatch_to_group: Users, make_file: FilePlus2, use_skill: BookOpen, mcp: Plug };

function verb(t: ToolTrace) {
  switch (t.name) {
    case "web_search":
      return `搜索「${t.label}」`;
    case "read_page":
      return `阅读 ${shortUrl(t.label)}`;
    case "make_file":
      return `生成 ${t.label}`;
    case "use_skill":
      return `使用技能「${t.label}」`;
    case "mcp":
      return `调用 ${t.label}`;
    case "dispatch_to_group":
      return t.status === "running" ? `已派到「${t.label}」` : `「${t.label}」`;
  }
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const s = u.hostname.replace(/^www\./, "") + path;
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
  } catch {
    return url;
  }
}

/** Citation number → URL, from every search in the message. */
export function citations(steps?: ToolTrace[]) {
  const map = new Map<number, string>();
  for (const s of steps ?? []) s.sources?.forEach((src, i) => map.set((s.first ?? 1) + i, src.url));
  return map;
}

/** What an agent did with its tools before (or while) answering. */
export function ToolSteps({ steps }: { steps: ToolTrace[] }) {
  return (
    <div className="mb-2 space-y-1.5">
      {steps.map((t) => (
        <Step key={t.id} step={t} />
      ))}
    </div>
  );
}

function Step({ step: t }: { step: ToolTrace }) {
  const open = useUi((s) => s.open);
  const Icon = t.status === "running" ? Loader2 : t.status === "error" ? AlertCircle : icons[t.name];
  const head = (
    <>
      <Icon size={14} className={clsx("shrink-0", t.status === "running" && "animate-spin", t.status === "error" && "text-bad")} />
      <span className="min-w-0 truncate">{verb(t)}</span>
      {t.detail && <span className={clsx("shrink-0", t.status === "error" ? "text-bad" : "text-fg-3")}>· {t.detail}</span>}
    </>
  );
  const row = "flex min-w-0 items-center gap-1.5 text-[13px] text-fg-2";

  if (t.name === "dispatch_to_group") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-active px-3 py-2">
        <div className={clsx(row, "flex-1")}>{head}</div>
        {t.groupId && (
          <button type="button" onClick={() => open({ kind: "group", id: t.groupId! })} className="shrink-0 text-[13px] font-medium text-accent-text hover:underline">
            去群里看
          </button>
        )}
      </div>
    );
  }

  if (!t.sources?.length) return <div className={row}>{head}</div>;

  return (
    <details className="group/s">
      <summary className={clsx(row, "cursor-pointer list-none select-none")}>
        {head}
        <ChevronDown size={14} className="shrink-0 transition-transform group-open/s:rotate-180" />
      </summary>
      <ol className="mt-1.5 space-y-1 rounded-xl bg-active p-2">
        {t.sources.map((s, i) => (
          <li key={s.url + i}>
            <a href={s.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-[13px] hover:bg-hover">
              <span className="mt-px shrink-0 font-mono text-[11.5px] text-fg-3">{(t.first ?? 1) + i}</span>
              <span className="min-w-0">
                <span className="line-clamp-1 text-fg">{s.title}</span>
                <span className="flex items-center gap-1 text-[12px] text-fg-3">
                  <Globe size={11} />
                  {[s.site, s.date].filter(Boolean).join(" · ")}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
