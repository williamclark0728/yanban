import clsx from "clsx";
import { Bot, Plus, Search, Settings, Users, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { listTime } from "../lib/time";
import { useData, usePrefs, useUi } from "../store";
import type { ChatRef, Message } from "../types";
import { BotAvatar, GroupAvatar, MeAvatar } from "./Avatar";
import { IconButton } from "./ui";

export function Sidebar() {
  const { agents, groups, messages, unread } = useData();
  const { active, open, search, setSearch, openSettings, edit } = useUi();
  const mode = usePrefs((s) => s.mode);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);

  const q = search.trim().toLowerCase();
  const last = new Map<string, Message>();
  for (const m of messages) last.set(m.chat, m);

  const chats = [
    ...groups.map((group) => ({ ref: { kind: "group", id: group.id } as ChatRef, name: group.name, group, agent: undefined })),
    ...agents.map((agent) => ({ ref: { kind: "agent", id: agent.id } as ChatRef, name: agent.name, group: undefined, agent })),
  ];
  const rows = chats
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .map((c) => ({ ...c, last: last.get(c.ref.id) }))
    .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));

  const preview = (m?: Message) => {
    if (!m) return { text: "", who: "", time: "" };
    const time = listTime(m.at);
    if (m.kind === "round") return { text: `第 ${m.round} 轮 · ${m.note}`, who: "", time };
    if (m.kind === "text" && m.status === "error") return { text: m.error?.message ?? "", who: "", time };
    const plain = m.text.replace(/[*_>#`]/g, "").replace(/\s+/g, " ").trim();
    return { text: plain || (m.kind === "text" && m.status === "streaming" ? "正在输入…" : ""), who: m.sender === "me" ? "" : agents.find((a) => a.id === m.sender)?.name ?? "", time };
  };

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar md:w-[300px] md:shrink-0 md:border-r md:border-line">
      <header className="flex h-16 items-center gap-1 px-4">
        {searching ? (
          <div className="flex h-9 flex-1 items-center gap-2 rounded-full bg-raise-2 px-3">
            <Search size={16} className="text-fg-3" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            />
            <button
              type="button"
              aria-label="关闭搜索"
              onClick={() => {
                setSearch("");
                setSearching(false);
              }}
              className="text-fg-3 hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-1 items-center gap-2 pl-1">
              <span className="text-[17px] font-semibold tracking-tight">研伴</span>
              {mode === "dev" && (
                <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-text">开发者</span>
              )}
            </div>
            <IconButton aria-label="搜索" onClick={() => setSearching(true)} className="bg-raise-2">
              <Search size={17} />
            </IconButton>
            <div className="relative">
              <IconButton aria-label="新建" onClick={() => setMenu((v) => !v)} className="bg-raise-2">
                <Plus size={18} />
              </IconButton>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="rise absolute right-0 top-11 z-20 w-44 rounded-2xl border border-line bg-raise p-1.5 shadow-[var(--shadow)]">
                    <MenuItem icon={<Bot size={16} />} label="新建智能体" onClick={() => { setMenu(false); edit({ kind: "agent" }); }} />
                    <MenuItem icon={<Users size={16} />} label="新建群聊" onClick={() => { setMenu(false); edit({ kind: "group" }); }} />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </header>

      <nav className="scroll flex-1 px-2 pb-2">
        {rows.map((r) => {
          const p = preview(r.last);
          const selected = active?.id === r.ref.id;
          const count = unread[r.ref.id] ?? 0;
          const members = r.group ? r.group.memberIds.map((m) => agents.find((a) => a.id === m)!).filter(Boolean) : [];
          return (
            <button
              key={r.ref.id}
              type="button"
              onClick={() => open(r.ref)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors",
                selected ? "bg-active" : "hover:bg-hover",
              )}
            >
              {r.group ? <GroupAvatar members={members} size={46} /> : <BotAvatar agent={r.agent!} size={46} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-fg-3">{p.time}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="truncate text-[13.5px] text-fg-2">
                    {r.group && p.who && <span className="text-fg">{p.who}：</span>}
                    {p.text || (r.agent ? r.agent.tagline : "")}
                  </span>
                  {count > 0 && (
                    <span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-badge px-1.5 text-[11px] font-semibold text-white">
                      {count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-fg-3">没有匹配的会话</p>}
      </nav>

      <footer className="flex items-center gap-2 border-t border-line px-3 py-3">
        <button
          type="button"
          onClick={() => openSettings("general")}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-1 pl-1 pr-3 hover:bg-hover"
        >
          <MeAvatar size={34} />
          <span className="truncate font-medium">盛致远</span>
        </button>
        <IconButton aria-label="设置" onClick={() => openSettings()}>
          <Settings size={18} />
        </IconButton>
      </footer>
    </aside>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-hover"
    >
      <span className="text-fg-2">{icon}</span>
      {label}
    </button>
  );
}
