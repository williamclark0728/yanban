import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronUp, ClipboardList, Clock, CornerDownRight, FileUp, Info, Lightbulb, NotebookPen, PanelRight, Pencil, PlugZap, Quote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setPlanMode, usePlanMode } from "../lib/agentTools";
import { compact, newTopic, stop, useBusy } from "../lib/chat";
import { isDesktop } from "../lib/desktop";
import { exportChat } from "../lib/export";
import { moveQueued, queue, send as sendNowOrInsert, unqueue, unsteer, useQueue, useSteer } from "../lib/queue";
import { dayLabel, sameDay } from "../lib/time";
import { resolveModel, useData, usePrefs, useUi } from "../store";
import type { Attachment, Message, TextMessage } from "../types";
import { BotAvatar, GroupAvatar } from "./Avatar";
import { CompareChip, CompareRow } from "./Compare";
import { GoalBar } from "./Goal";
import { JobsBar } from "./Jobs";
import { openDoc } from "../lib/docs";
import { Composer, type Command, type ComposerHandle } from "./Composer";
import { ContextMeter, EffortChip } from "./ContextMeter";
import { MessageItem } from "./MessageItem";
import { DEMO_IDS } from "../lib/seed";
import { ModelChip } from "./ModelChip";
import { TaskBoard } from "./TaskBoard";
import { IconButton } from "./ui";

const senderOf = (m?: Message) => (m && (m.kind === "text" || m.kind === "review") ? m.sender : undefined);

interface Picked {
  text: string;
  messageId: string;
  x: number;
  top: number;
  bottom: number;
}

/** The selected text when it lies inside one reply, with where to show the toolbar. */
function readSelection(within: HTMLElement | null): Picked | null {
  const s = window.getSelection();
  const text = s?.toString().trim() ?? "";
  if (!s || s.isCollapsed || !text || !s.rangeCount || !within) return null;
  const range = s.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const reply = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-reply]");
  if (!reply || !within.contains(reply)) return null;
  const r = range.getBoundingClientRect();
  return { text: text.slice(0, 3000), messageId: reply.dataset.reply!, x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
}

/** Floats over a selection in a reply: quote it into the box, or ask about it in a side chat. */
function SelectionBar({ picked, onQuote, onExplain }: { picked: Picked; onQuote: () => void; onExplain: () => void }) {
  const above = picked.top > 120;
  const x = Math.min(Math.max(picked.x, 90), window.innerWidth - 90);
  return (
    <div
      className="fixed z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-fg p-1 text-bg shadow-[var(--shadow)]"
      style={{ left: x, top: above ? picked.top - 46 : picked.bottom + 8 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" onClick={onQuote} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-bg/15">
        <Quote size={14} /> 引用
      </button>
      <button type="button" onClick={onExplain} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-bg/15">
        <Lightbulb size={14} /> 讲解
      </button>
    </div>
  );
}

/** Plan mode for a private chat: the agent proposes a plan and changes nothing until the user says go. */
function PlanChip({ chat }: { chat: string }) {
  const on = usePlanMode((s) => !!s[chat]);
  return (
    <button
      type="button"
      onClick={() => setPlanMode(chat, !on)}
      title={on ? "计划模式：先出方案，不改文件；点一下关闭" : "计划模式：先出方案给你确认，同意后再动手"}
      className={clsx(
        "hidden h-8 shrink-0 items-center gap-1 self-center rounded-full px-2.5 text-[13px] transition-colors sm:flex",
        on ? "bg-accent-soft font-medium text-accent-text" : "text-fg-2 hover:bg-active hover:text-fg",
      )}
    >
      <ClipboardList size={14} />
      计划
    </button>
  );
}

export function ChatView() {
  const { agents, groups, messages, providers, defaultModel, markRead, updateAgent, skills } = useData();
  const { active, back, togglePanel, panelOpen, openSettings, openAside, setChip, setHelp, focus, quote, focusMessage, quoteInto } = useUi();
  const dev = usePrefs((s) => s.mode === "dev");
  const busy = useBusy((s) => (active ? !!s[active.id] : false));
  const planOn = usePlanMode((s) => (active ? !!s[active.id] : false));
  const queued = useQueue((s) => (active ? s[active.id] : undefined));
  const inserted = useSteer((s) => (active ? s[active.id] : undefined));
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [goalEdit, setGoalEdit] = useState(false);
  const flashTimer = useRef(0);
  const stick = useRef(true);

  // Selecting text in a reply shows the quote / explain toolbar.
  useEffect(() => {
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setPicked(readSelection(scroller.current)), 120);
    };
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      clearTimeout(timer);
    };
  }, []);

  // "/" outside a text field starts a command, like in the CLI agents.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector(".fixed.inset-0")) return;
      e.preventDefault();
      composer.current?.focus("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    setChip(null);
    setGoalEdit(false);
  }, [chatId, markRead, setChip]);

  // Follow new content while the user is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chatId, list.length, tailSize]);

  // A message picked in the history search: scroll to it and light it up for a moment.
  useEffect(() => {
    const el = focus && document.getElementById(`msg-${focus.id}`);
    if (!focus || !el) return;
    stick.current = false;
    el.scrollIntoView({ block: "center" });
    setFlash(focus.id);
    focusMessage(null);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, [focus, chatId, list.length, focusMessage]);

  // An old message quoted from the history search goes into this chat's composer.
  useEffect(() => {
    if (!quote) return;
    composer.current?.quote(quote.text);
    quoteInto(null);
  }, [quote, quoteInto]);

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

  const send = (text: string, files: Attachment[], toQueue?: boolean) =>
    (toQueue ? queue : sendNowOrInsert)(chatId, text, files.length ? files : undefined);

  const commands: Command[] = [
    { name: "compact", label: "压缩上下文", hint: "把之前的对话写成摘要", run: () => void compact(chatId) },
    { name: "clear", label: "开始新话题", hint: "之后的回复不带上面的对话，记录不删", run: () => newTopic(chatId) },
    ...(agent
      ? [
          {
            name: "plan",
            label: planOn ? "退出计划模式" : "计划模式",
            hint: "先出方案，确认后再动手",
            run: () => setPlanMode(chatId, !planOn),
          },
          { name: "model", label: "换模型", run: () => setChip("model") },
          { name: "compare", label: "多模型对比", hint: "选 2–3 个模型同时回答", run: () => setChip("compare") },
          { name: "goal", label: "设定目标", hint: "智能体自动接着做，直到完成或到轮数上限", run: () => setGoalEdit(true) },
          { name: "effort", label: "思考强度", run: () => setChip("effort") },
          { name: "web", label: agent.web ? "关闭联网" : "打开联网", hint: `现在${agent.web ? "开着" : "关着"}`, run: () => updateAgent(agent.id, { web: !agent.web }) },
        ]
      : []),
    { name: "doc", label: "共写文档", hint: "在侧栏写一份文档，可以让 AI 改写选中的段落", run: () => openDoc(chatId) },
    { name: "export", label: "导出对话", hint: "存成 Markdown 文件", run: () => exportChat(chatId) },
    { name: "help", label: "快捷键和命令", run: () => setHelp(true) },
  ];

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
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
        <div className="flex w-[72px]">
          <IconButton aria-label="返回" onClick={back} className="pointer-events-auto md:invisible">
            <ChevronLeft size={22} />
          </IconButton>
        </div>
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
        <div className="pointer-events-auto flex">
          <IconButton aria-label="共写文档" title="共写文档（/doc）" onClick={() => openDoc(chatId)}>
            <NotebookPen size={18} />
          </IconButton>
          <IconButton aria-label={panelOpen ? "收起详情" : "展开详情"} onClick={() => togglePanel()}>
            <PanelRight size={19} />
          </IconButton>
        </div>
      </header>

      <div
        ref={scroller}
        className="scroll flex-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (picked) setPicked(readSelection(el));
        }}
      >
        <div className="mx-auto w-full max-w-[var(--chat-w)] px-4 pb-6 pt-20 md:px-6">
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
            const day = newDay && (
              <div className="my-5 flex justify-center">
                <span className="rounded-full bg-raise-2 px-3 py-1 text-xs font-medium text-fg-2">{dayLabel(m.at)}</span>
              </div>
            );
            // Answers from several models to one question sit side by side, drawn once at the first of them.
            if (m.kind === "text" && m.compare) {
              if (list.findIndex((x) => x.kind === "text" && x.compare === m.compare) !== i) return null;
              const replies = list.filter((x): x is TextMessage => x.kind === "text" && x.compare === m.compare);
              return (
                <div key={m.id} className={clsx("rounded-2xl transition-colors duration-700", replies.some((r) => r.id === flash) && "bg-accent-soft")}>
                  {day}
                  <CompareRow replies={replies} agents={agents} />
                </div>
              );
            }
            // The built-in example run is labelled, so nobody takes it for a real chat.
            const demoStart = DEMO_IDS.has(m.id) && !(prev && DEMO_IDS.has(prev.id));
            return (
              <div key={m.id} id={`msg-${m.id}`} className={clsx("rounded-2xl transition-colors duration-700", flash === m.id && "bg-accent-soft")}>
                {day}
                {demoStart && (
                  <div className="mx-auto mb-4 flex max-w-xl items-start gap-2 rounded-xl border border-dashed border-line-2 px-3.5 py-2.5 text-[13px] text-fg-2">
                    <Info size={15} className="mt-0.5 shrink-0 text-accent-text" />
                    <span>
                      下面是<b className="font-semibold text-fg">内置的示例对话</b>，演示群聊怎么分工、审查和交付，不是真实的聊天记录。直接在下方输入框发消息就能开始用。
                    </span>
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

      <div className="mx-auto w-full max-w-[var(--chat-w)] px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-1 md:px-5 md:pb-5">
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
        {group && <TaskBoard group={group.id} />}
        {isDesktop && (agent?.workspace ?? group?.workspace) && <JobsBar root={(agent?.workspace ?? group?.workspace)!} />}
        {agent && <GoalBar chat={agent.id} editing={goalEdit} onClose={() => setGoalEdit(false)} send={(t) => sendNowOrInsert(agent.id, t)} />}
        {inserted && inserted.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {inserted.map((q) => (
              <span key={q.id} className="flex max-w-full items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft py-1 pl-2.5 pr-1.5 text-[12.5px] text-accent-text">
                <CornerDownRight size={12} className="shrink-0" />
                <span className="truncate">插入中，下一步送达：{q.text || `${q.attachments?.length ?? 0} 个附件`}</span>
                <button type="button" aria-label="撤回这条" onClick={() => unsteer(chatId, q.id)} className="shrink-0 opacity-70 hover:opacity-100">
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        {queued && queued.length > 0 && (
          <div className="mb-2 space-y-1 rounded-2xl border border-line bg-raise p-1.5 shadow-[var(--shadow)]">
            <div className="flex items-center gap-1.5 px-1.5 pt-0.5 text-[12px] text-fg-3">
              <Clock size={12} /> 排队中（{queued.length}），这条回复完成后按顺序发出
            </div>
            {queued.map((q, i) => (
              <div key={q.id} className="group/q flex items-center gap-1 rounded-xl px-1.5 py-1 text-[13px] hover:bg-hover">
                <span className="w-4 shrink-0 text-center text-[11.5px] text-fg-3">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{q.text || `${q.attachments?.length ?? 0} 个附件`}</span>
                <IconButton aria-label="上移" disabled={i === 0} onClick={() => moveQueued(chatId, q.id, -1)} className="size-6 disabled:opacity-30">
                  <ChevronUp size={14} />
                </IconButton>
                <IconButton aria-label="下移" disabled={i === queued.length - 1} onClick={() => moveQueued(chatId, q.id, 1)} className="size-6 disabled:opacity-30">
                  <ChevronDown size={14} />
                </IconButton>
                <IconButton
                  aria-label="编辑"
                  title="放回输入框修改"
                  onClick={() => {
                    unqueue(chatId, q.id);
                    composer.current?.restore(q.text, q.attachments);
                  }}
                  className="size-6"
                >
                  <Pencil size={13} />
                </IconButton>
                <IconButton aria-label="撤回" onClick={() => unqueue(chatId, q.id)} className="size-6">
                  <X size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <Composer
          ref={composer}
          key={chatId}
          draft={chatId}
          placeholder={group ? `发消息给 ${name}，@ 指定成员，/ 命令，$ 技能` : `发消息给 ${name}，/ 命令，$ 技能`}
          members={members}
          busy={busy}
          canQueue
          commands={commands}
          skills={skills.filter((s) => s.enabled)}
          workspace={isDesktop ? (agent?.workspace ?? group?.workspace) : undefined}
          tools={
            agent && (
              <>
                <ModelChip agent={agent} />
                <EffortChip agent={agent} />
                <PlanChip chat={agent.id} />
                <CompareChip agent={agent} />
              </>
            )
          }
          trailing={<ContextMeter chat={chatId} />}
          onStop={() => stop(chatId)}
          onSend={send}
        />
      </div>
      {picked && (
        <SelectionBar
          picked={picked}
          onQuote={() => {
            composer.current?.quote(picked.text);
            clearSelection();
          }}
          onExplain={() => {
            openAside({ chat: chatId, messageId: picked.messageId, quote: picked.text });
            clearSelection();
          }}
        />
      )}
    </main>
  );
}
