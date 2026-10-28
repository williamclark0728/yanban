import { CornerDownLeft, Loader2, Quote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { uid, useBusy } from "../lib/chat";
import { attachmentText } from "../lib/files";
import { describeError, streamReply } from "../lib/llm";
import { resolveModel, useData, usePrefs, useUi, type Aside } from "../store";
import type { Attachment } from "../types";
import { BotAvatar } from "./Avatar";
import { Composer } from "./Composer";
import { RichText } from "./MessageItem";
import { IconButton } from "./ui";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "streaming" | "error" | "stopped";
  error?: string;
  /** Copied back into the main chat. */
  inserted?: boolean;
}

const FIRST = "讲解一下这段";

const RULES = [
  "用户在读你之前的一段回答时选中了其中一部分，想单独弄懂它。",
  "只讲这一部分：先用一两句话说清它的意思，再解释其中的概念、术语或推理步骤，必要时举一个简单的例子。",
  "按初学者的水平讲，少用术语；不要重复整段回答。用户接着追问时，围绕这一部分回答。",
].join("\n");

/**
 * A side chat about one passage of a reply. It is not saved and doesn't enter the main chat's context,
 * unless the user puts an answer back.
 */
export function ExplainPanel({ aside }: { aside: Aside }) {
  const close = useUi((s) => s.closeAside);
  const { messages, agents, providers, defaultModel, addMessage } = useData();
  const mainBusy = useBusy((s) => !!s[aside.chat]);
  const found = messages.find((m) => m.id === aside.messageId);
  const source = found && found.kind !== "round" ? found : undefined;
  const agent = source && agents.find((a) => a.id === source.sender);
  const [turns, setTurns] = useState<Turn[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = turns.at(-1)?.status === "streaming";

  const ask = async (question: string, files: Attachment[], before: Turn[]) => {
    const target = resolveModel(agent, providers, defaultModel);
    const id = uid();
    const asked: Turn = { id: uid(), role: "user", text: question };
    setTurns([...before, asked, { id, role: "assistant", text: "", status: "streaming" }]);
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)));
    if (!target || !source) return patch({ status: "error", error: target ? "原消息已不在了" : "还没有连接模型服务" });

    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const me = usePrefs.getState().name.trim();
    const system = [agent ? `你是「${agent.name}」，${agent.tagline}。` : "你是研伴里的助手。", me && `用户的称呼：${me}`, RULES].filter(Boolean).join("\n");
    const opening = `你之前的回答：\n<回答>\n${source.text}\n</回答>\n\n我选中的部分：\n「${aside.quote}」`;
    const history = [...before, asked].filter((t) => t.status !== "error");
    const extra = attachmentText(files);
    let out = "";
    try {
      await streamReply({
        provider: target.provider,
        modelId: target.modelId,
        system,
        messages: history.map((t, i) => ({
          role: t.role,
          content: [i === 0 ? `${opening}\n\n${t.text}` : t.text, t === asked && extra].filter(Boolean).join("\n\n"),
        })),
        params: agent?.params ?? { temperature: 0.7, topP: 1, maxTokens: 0, history: 20 },
        signal: c.signal,
        onText: (d) => {
          out += d;
          if (ctrl.current === c) patch({ text: out });
        },
        onReasoning: () => {},
      });
      if (ctrl.current === c) patch({ text: out, status: undefined });
    } catch (e) {
      if (ctrl.current === c) patch(c.signal.aborted ? { status: "stopped" } : { status: "error", error: describeError(e).message });
    }
  };

  useEffect(() => {
    void ask(FIRST, [], []);
    return () => ctrl.current?.abort();
    // One explanation per opened passage; the panel is keyed by it.
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  /** Puts a question and its answer at the end of the main chat, where later replies can see them. */
  const putBack = (i: number) => {
    const answer = turns[i];
    const question = turns[i - 1];
    if (!agent || !answer || !question) return;
    const quote = aside.quote.split("\n").map((l) => `> ${l}`).join("\n");
    const now = Date.now();
    addMessage({ id: uid(), chat: aside.chat, kind: "text", sender: "me", text: `${quote}\n\n${question.text}`, at: now });
    addMessage({ id: uid(), chat: aside.chat, kind: "text", sender: agent.id, text: answer.text, at: now + 1 });
    setTurns((t) => t.map((x) => (x.id === answer.id ? { ...x, inserted: true } : x)));
  };

  return (
    <aside className="flex h-full flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        {agent && <BotAvatar agent={agent} size={26} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">单独讲解</div>
          <div className="truncate text-[12px] text-fg-3">不进入主对话，关掉就没了；有用的回答可以放回对话</div>
        </div>
        <IconButton aria-label="关闭讲解" onClick={close}>
          <X size={18} />
        </IconButton>
      </header>
      <div ref={scroller} className="scroll flex-1 px-4 py-4">
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-raise px-3 py-2.5 text-[13.5px] text-fg-2">
          <Quote size={14} className="mt-1 shrink-0 text-fg-3" />
          <span className="line-clamp-6 whitespace-pre-wrap">{aside.quote}</span>
        </div>
        {turns.map((t, i) =>
          t.role === "user" ? (
            i > 0 && (
              <div key={t.id} className="mt-4 flex justify-end">
                <div className="max-w-[85%] rounded-[18px] bg-bubble-me px-3.5 py-2 text-[14px]">{t.text}</div>
              </div>
            )
          ) : (
            <div key={t.id} className="mt-3">
              <div className="rounded-[18px] bg-bubble px-3.5 py-2.5">
                {t.text ? <RichText text={t.text} agents={agents} /> : t.status === "streaming" && <Loader2 size={16} className="animate-spin text-fg-3" />}
                {t.status === "error" && <div className="text-sm text-bad">{t.error}</div>}
                {t.status === "stopped" && <div className="mt-1 text-[12px] text-fg-3">已停止</div>}
              </div>
              {!t.status && t.text && agent && (
                <button
                  type="button"
                  disabled={t.inserted || mainBusy}
                  onClick={() => putBack(i)}
                  title={mainBusy ? "主对话正在回复，等它完成再放" : "把这次提问和讲解加到主对话末尾，之后的回复能看到"}
                  className="mt-1 flex items-center gap-1 px-2 text-[12px] text-fg-3 enabled:hover:text-fg disabled:opacity-60"
                >
                  <CornerDownLeft size={12} />
                  {t.inserted ? "已放回对话" : "放回对话"}
                </button>
              )}
            </div>
          ),
        )}
      </div>
      <div className="px-3 pb-3">
        <Composer
          placeholder="继续追问这一段"
          members={[]}
          busy={busy}
          onStop={() => ctrl.current?.abort()}
          onSend={(text, files) => void ask(text || FIRST, files, turns)}
        />
      </div>
    </aside>
  );
}
