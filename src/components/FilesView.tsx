import clsx from "clsx";
import { ChevronRight, FolderOpen, FolderTree, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { call, reveal } from "../lib/desktop";
import { useUi } from "../store";
import { DockEmpty } from "./DockTabs";
import { FileIcon, kindOf } from "./FileCard";
import { IconButton } from "./ui";

interface Entry {
  name: string;
  dir: boolean;
  size: number;
}

interface Hit {
  path: string;
  line: number;
  text: string;
}

const join = (dir: string, name: string) => (dir === "." ? name : `${dir}/${name}`);
const open = (root: string, path: string) => useUi.getState().openPane({ kind: "file", root, path });

/** The dock's file view: the open chat's workspace as a tree; type to filter names, or start with ? to search inside files. */
export function FilesView({ root }: { root?: string }) {
  const [query, setQuery] = useState("");
  // Bumped by the refresh button, so every open folder reads its entries again.
  const [version, setVersion] = useState(0);
  if (!root) {
    return (
      <DockEmpty
        icon={<FolderTree size={28} />}
        title="这个对话没有工作区"
        text="在聊天的详情里打开工作模式、选一个文件夹，这里就会显示里面的文件。"
      />
    );
  }
  const name = root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={root}>
          {name}
        </span>
        <IconButton aria-label="刷新" title="刷新" onClick={() => setVersion((v) => v + 1)} className="size-8">
          <RefreshCw size={15} />
        </IconButton>
        <IconButton aria-label="在资源管理器中显示" title="在资源管理器中显示" onClick={() => void reveal(root)} className="size-8">
          <FolderOpen size={16} />
        </IconButton>
      </div>
      <div className="px-2 pt-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-raise px-2.5 focus-within:border-accent">
          <Search size={14} className="shrink-0 text-fg-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选文件名，开头加 ? 搜索文件内容"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
      </div>
      <div className="scroll min-h-0 flex-1 px-1.5 py-1.5 text-[13px]">
        {query.trim() ? <Found root={root} query={query.trim()} /> : <Folder key={`${root}:${version}`} root={root} path="." depth={0} />}
      </div>
    </div>
  );
}

/** One folder's entries, read when it is first shown; subfolders open in place. */
function Folder({ root, path, depth }: { root: string; path: string; depth: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    setEntries(null);
    setError("");
    let alive = true;
    call<Entry[]>("ws_list", { root, path }).then(
      (list) => alive && setEntries(list),
      (e: Error) => alive && setError(e.message ?? String(e)),
    );
    return () => {
      alive = false;
    };
  }, [root, path]);
  const pad = { paddingLeft: 6 + depth * 14 };
  if (error) return <div className="py-1 text-bad" style={pad}>{error}</div>;
  if (!entries) return <Loader2 size={14} className="my-1 animate-spin text-fg-3" style={{ marginLeft: pad.paddingLeft }} />;
  if (!entries.length && depth === 0) return <div className="px-2 py-1 text-fg-3">文件夹是空的</div>;
  const sorted = [...entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "zh"));
  return (
    <>
      {sorted.map((e) => {
        const p = join(path, e.name);
        const isOpen = opened.has(p);
        return (
          <div key={e.name}>
            <button
              type="button"
              onClick={() =>
                e.dir
                  ? setOpened((s) => {
                      const n = new Set(s);
                      if (n.has(p)) n.delete(p);
                      else n.add(p);
                      return n;
                    })
                  : open(root, p)
              }
              className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left hover:bg-hover"
              style={pad}
              title={p}
            >
              {e.dir ? <ChevronRight size={14} className={clsx("shrink-0 text-fg-3 transition-transform", isOpen && "rotate-90")} /> : <span className="w-3.5 shrink-0" />}
              {!e.dir && <FileIcon kind={kindOf(e.name)} />}
              <span className="min-w-0 truncate">{e.name}</span>
            </button>
            {e.dir && isOpen && <Folder root={root} path={p} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

/** Files whose names match, or (after "?") lines that contain the words. */
function Found({ root, query }: { root: string; query: string }) {
  const inside = query.startsWith("?") || query.startsWith("？");
  const words = inside ? query.slice(1).trim() : query;
  const [names, setNames] = useState<string[] | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    setNames(null);
    setHits(null);
    if (!words) return;
    // Wait for a pause in typing.
    const t = setTimeout(() => {
      if (inside) {
        const pattern = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        call<Hit[]>("ws_search", { root, pattern: `(?i)${pattern}`, path: null, glob: null }).then((h) => setHits(h.slice(0, 100)), (e: Error) => setError(e.message ?? String(e)));
      } else {
        call<string[]>("ws_files", { root, query: words }).then(setNames, (e: Error) => setError(e.message ?? String(e)));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [root, words, inside]);
  if (!words) return <div className="px-2 py-1 text-fg-3">输入要找的内容</div>;
  if (error) return <div className="px-2 py-1 text-bad">{error}</div>;
  const list = inside ? hits : names;
  if (!list) return <Loader2 size={14} className="m-2 animate-spin text-fg-3" />;
  if (!list.length) return <div className="px-2 py-1 text-fg-3">没有找到</div>;
  return (
    <>
      {inside
        ? hits!.map((h, i) => (
            <button key={i} type="button" onClick={() => open(root, h.path)} className="block w-full rounded-md px-2 py-1 text-left hover:bg-hover">
              <div className="truncate text-[12.5px] text-fg-3">
                {h.path}:{h.line}
              </div>
              <div className="truncate font-mono text-[12px]">{h.text.trim()}</div>
            </button>
          ))
        : names!.map((p) => (
            <button key={p} type="button" onClick={() => open(root, p)} className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-hover" title={p}>
              <FileIcon kind={kindOf(p)} />
              <span className="min-w-0 truncate">{p}</span>
            </button>
          ))}
    </>
  );
}
