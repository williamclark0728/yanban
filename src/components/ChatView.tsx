import { ChevronLeft, FileUp, PanelRight, PlugZap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendToAgent, stop, useBusy } from "../lib/chat";
import { sendToGroup } from "../lib/collab";
import { dayLabel, sameDay } from "../lib/time";
import { resolveModel, useData, usePrefs, useUi } from "../store";
import type { Attachment, Message } from "../types";
import { BotAvatar, GroupAvatar } from "./Avatar";
import { Composer, type ComposerHandle } from "./Composer";
import { ContextMeter, EffortChip } from "./ContextMeter";
import { MessageItem } from "./MessageItem";
import { ModelChip } from "./ModelChip";
import { IconButton } from "./ui";

const senderOf = (m?: Message) => (m && (m.kind === "text" || m.kind === "review") ? m.sender : undefined);

export function ChatView() {
  const { agents, groups, messages, providers, defaultModel, markRead } = useData();
  const { active, back, togglePanel, panelOpen, openSettings } = useUi();
  const dev = usePrefs((s) => s.mode === "dev");
  const busy = useBusy((s) => (active ? !!s[active.id] : false));
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [dragging, setDragging] = useState(false);
  const stick = useRef(true);

  const group = active?.kind === "group" ? groups.find((g) => g.id === active.id) : undefined;
  const agent = active?.kind === "agent" ? agents.find((a) => a.id === active.id) : undefined;
  const chatId = active?.id ?? "";
  const list = messages.filter((m) => m.chat === chatId);
  const members = group ? group.memberIds.map((id) => agents.find((a) => a.id === id)!).filter(Boolean) : [];
  const target = agent ? resolveModel(agent, providers, defaultModel) : null;
  const tail = list.at(-1);
  const tailSize = tail && "text" in tail ? tail.text.length : 0;

  useEffect(() => {
    if (chatId) markRead(chatId);
    stick.current = true;
  }, [chatId, markRead]);

  // Follow new content while the user is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chatId, list.length, tailSize]);

  if (!active || (!group && !agent)) {
    return (
      <main className="hidden flex-1 place-items-center bg-bg md:grid">
        <div className="text-center">
          <img src="/icon.svg" alt="" className="mx-auto size-16 rounded-2xl" />
          <p className="mt-4 text-fg-2">选择一个会话开始</p>
        </div>
      </main>
    );
  }

  const name = group?.name ?? agent!.name;

  const send = (text: string, files: Attachment[]) => {
    const attachments = files.length ? files : undefined;
    if (agent) void sendToAgent(agent.id, text, attachments);
    else void sendToGroup(chatId, text, attachments);
  };

  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");

  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col bg-bg"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        composer.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-accent-text">
            <FileUp size={32} />
            <span className="font-medium">松开即可添加文件</span>
            <span className="text-[13px] opacity-80">文本、代码、PDF、Word、Excel、PPT、zip 或图片</span>
          </div>
        </div>
      )}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-20 items-start justify-between bg-gradient-to-b from-bg from-40% to-transparent px-3 pt-3">
        <IconButton aria-label="返回" onClick={back} className="pointer-events-auto md:invisible">
          <ChevronLeft size={22} />
        </IconButton>
        <button
          type="button"
          onClick={() => togglePanel(true)}
          className="pointer-events-auto flex max-w-[70%] items-center gap-2 rounded-full border border-line bg-raise/80 py-1.5 pl-1.5 pr-4 shadow-[var(--shadow)] backdrop-blur-xl"
        >
          {group ? <GroupAvatar members={members} size={28} /> : <BotAvatar agent={agent!} size={28} />}
          <span className="truncate font-semibold">{name}</span>
          {group && <span className="shrink-0 text-sm text-fg-3">{members.length + 1} 人</span>}
          {agent && dev && target && <span className="truncate font-mono text-xs text-fg-3">{target.modelId}</span>}
        </button>
        <IconButton aria-label={panelOpen ? "收起详情" : "展开详情"} onClick={() => togglePanel()} className="pointer-events-auto">
          <PanelRight size={19} />
        </IconButton>
      </header>

      <div
        ref={scroller}
        className="scroll flex-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-[820px] px-4 pb-6 pt-20 md:px-6">
          {list.length === 0 && agent && (
            <div className="flex flex-col items-center pt-[12vh] text-center">
              <BotAvatar agent={agent} size={72} />
              <h2 className="mt-4 text-xl font-semibold">{agent.name}</h2>
              <p className="mt-1 text-fg-2">{agent.tagline}</p>
            </div>
          )}
          {list.map((m, i) => {
            const prev = list[i - 1];
            const next = list[i + 1];
            const s = senderOf(m);
            const newDay = !prev || !sameDay(prev.at, m.at);
            return (
              <div key={m.id} id={`msg-${m.id}`} className="rounded-2xl">
                {newDay && (
                  <div className="my-5 flex justify-center">
                    <span className="rounded-full bg-raise-2 px-3 py-1 text-xs font-medium text-fg-2">{dayLabel(m.at)}</span>
                  </div>
                )}
                <MessageItem
                  msg={m}
                  agents={agents}
                  inGroup={!!group}
                  first={newDay || !s || senderOf(prev) !== s}
                  last={!s || senderOf(next) !== s || (!!next && !sameDay(m.at, next.at))}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[820px] px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-1 md:px-5 md:pb-5">
        {agent && !target && (
          <button
            type="button"
            onClick={() => openSettings("providers")}
            className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-line bg-raise px-4 py-3 text-left hover:bg-raise-2"
          >
            <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent-text">
              <PlugZap size={16} />
            </span>
            <span className="flex-1 text-sm">还没有可用的模型，先连接一个模型服务</span>
            <span className="text-sm font-medium text-accent-text">去连接</span>
          </button>
        )}
        <Composer
          ref={composer}
          key={chatId}
          placeholder={group ? `发消息给 ${name}，@ 可指定成员` : `发消息给 ${name}`}
          members={members}
          busy={busy}
          tools={
            agent && (
              <>
                <ModelChip agent={agent} />
                <EffortChip agent={agent} />
              </>
            )
          }
          trailing={<ContextMeter chat={chatId} />}
          onStop={() => stop(chatId)}
          onSend={send}
        />
      </div>
    </main>
  );
}
