import clsx from "clsx";
import { Check, Copy, Eye, FileDown, Loader2, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { describeError } from "../lib/llm";
import { docOf, rewrite } from "../lib/docs";
import { download, replyAsDocx } from "../lib/outputs";
import { useData, useUi } from "../store";
import { RichText } from "./MessageItem";
import { IconButton } from "./ui";
import { useShallow } from "zustand/react/shallow";

const QUICK = ["更简洁", "改得更通顺", "改成学术书面语", "扩写，补充细节"];

interface Pick {
  start: number;
  end: number;
  text: string;
}

/** The chat's shared document: edit it, have a selected passage rewritten, export it. */
export function DocPanel({ chat }: { chat: string }) {
  const doc = useData((s) => s.docs.find((d) => d.chat === chat));
  const { saveDoc, deleteDoc, agents } = useData(useShallow((s) => ({ saveDoc: s.saveDoc, deleteDoc: s.deleteDoc, agents: s.agents })));
  const closePane = useUi((s) => s.closePane);
  const [preview, setPreview] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [ask, setAsk] = useState("");
  const [proposal, setProposal] = useState<{ pick: Pick; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  if (!doc) return null;

  const set = (patch: Partial<typeof doc>) => saveDoc({ ...doc, ...patch, updatedAt: Date.now() });

  const readPick = () => {
    const el = area.current;
    if (!el || el.selectionStart === el.selectionEnd) return setPick(null);
    setPick({ start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) });
  };

  const run = async (instruction: string) => {
    if (!pick || !instruction.trim()) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setWorking(true);
    setError("");
    try {
      const text = await rewrite(chat, pick.text, instruction.trim(), c.signal);
      if (!c.signal.aborted) setProposal({ pick, text });
    } catch (e) {
      if (!c.signal.aborted) setError(describeError(e).message);
    } finally {
      setWorking(false);
    }
  };

  const accept = () => {
    if (!proposal) return;
    const current = docOf(chat)?.text ?? "";
    const { start, end, text } = proposal.pick;
    // The user may have kept typing; replace the passage only where it still is.
    const at = current.slice(start, end) === text ? start : current.indexOf(text);
    if (at < 0) return setError("原来那段已经改动过，找不到了，没有替换");
    set({ text: current.slice(0, at) + proposal.text + current.slice(at + text.length) });
    setProposal(null);
    setPick(null);
    setAsk("");
  };

  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className="flex h-16 shrink-0 items-center gap-1 border-b border-line px-3">
        <input
          value={doc.title}
          onChange={(e) => set({ title: e.target.value })}
          aria-label="文档标题"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[15px] font-semibold outline-none hover:bg-hover focus:bg-hover"
        />
        <IconButton aria-label={preview ? "编辑" : "预览"} title={preview ? "编辑" : "预览排版"} onClick={() => setPreview((v) => !v)}>
          {preview ? <Pencil size={16} /> : <Eye size={16} />}
        </IconButton>
        <IconButton
          aria-label="复制全文"
          title="复制全文"
          onClick={() =>
            void navigator.clipboard.writeText(doc.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
        <IconButton aria-label="下载为 Word" title="下载为 Word" disabled={!doc.text.trim()} onClick={() => void download(replyAsDocx(doc.text, doc.title || "文档"))}>
          <FileDown size={16} />
        </IconButton>
        {armed ? (
          <button
            type="button"
            onClick={() => {
              deleteDoc(chat);
              closePane();
            }}
            className="h-8 shrink-0 rounded-full bg-bad px-3 text-[12.5px] font-semibold text-white"
          >
            再点一次删除
          </button>
        ) : (
          <IconButton aria-label="删除文档" title="删除文档" onClick={() => setArmed(true)}>
            <Trash2 size={16} />
          </IconButton>
        )}
        <IconButton aria-label="关闭" onClick={closePane}>
          <X size={18} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1">
        {preview ? (
          <div className="scroll h-full px-5 py-4">{doc.text.trim() ? <RichText text={doc.text} agents={agents} /> : <p className="text-fg-3">文档是空的</p>}</div>
        ) : (
          <textarea
            ref={area}
            value={doc.text}
            onChange={(e) => {
              set({ text: e.target.value });
              setProposal(null);
            }}
            onSelect={readPick}
            onKeyUp={readPick}
            onMouseUp={readPick}
            placeholder={"在这里写，支持 Markdown。\n\n也可以点回复下方的「放进文档」把回答放进来，或者在对话里让智能体“写进文档”。\n选中一段文字，可以让 AI 按你的要求改写。"}
            className="scroll h-full w-full resize-none bg-transparent px-5 py-4 font-mono text-[14px] leading-relaxed outline-none placeholder:font-sans placeholder:text-fg-3"
          />
        )}
      </div>

      {!preview && (pick || proposal) && (
        <div className="shrink-0 space-y-2 border-t border-line p-3">
          {proposal ? (
            <>
              <div className="text-[12.5px] font-medium text-fg-2">改写结果</div>
              <div className="scroll max-h-48 space-y-2 text-[13.5px]">
                <div className="whitespace-pre-wrap rounded-xl bg-bad-soft px-3 py-2 text-fg-2 line-through decoration-bad/50">{proposal.pick.text}</div>
                <div className="whitespace-pre-wrap rounded-xl bg-ok-soft px-3 py-2">{proposal.text}</div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setProposal(null)} className="h-8 rounded-full px-3 text-[13px] text-fg-2 hover:bg-hover">
                  放弃
                </button>
                <button type="button" onClick={() => void run(ask)} disabled={working || !ask.trim()} className="h-8 rounded-full border border-line-2 px-3 text-[13px] hover:bg-hover disabled:opacity-40">
                  再改一次
                </button>
                <button type="button" onClick={accept} className="h-8 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
                  替换原文
                </button>
              </div>
            </>
          ) : (
            pick && (
              <>
                <div className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
                  <Sparkles size={13} className="text-accent-text" /> 改写选中的 {pick.text.length} 字
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={working}
                      onClick={() => {
                        setAsk(q);
                        void run(q);
                      }}
                      className="rounded-full border border-line-2 bg-raise px-3 py-1 text-[12.5px] hover:bg-hover disabled:opacity-40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(ask);
                  }}
                >
                  <input
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    placeholder="或者写下怎么改，比如 把结论放到前面"
                    className="h-9 min-w-0 flex-1 rounded-full border border-line bg-raise px-3 text-[13px] outline-none focus:border-line-2"
                  />
                  <button type="submit" disabled={working || !ask.trim()} className={clsx("flex h-9 shrink-0 items-center gap-1 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg disabled:opacity-40")}>
                    {working && <Loader2 size={13} className="animate-spin" />} 改写
                  </button>
                </form>
              </>
            )
          )}
          {error && <div className="text-[12.5px] text-bad">{error}</div>}
        </div>
      )}
    </aside>
  );
}
