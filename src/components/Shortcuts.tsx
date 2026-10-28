import { X } from "lucide-react";
import { useEffect } from "react";
import { useUi } from "../store";
import { IconButton } from "./ui";

const KEYS: [string, string][] = [
  ["Enter", "发送"],
  ["Shift + Enter", "换行"],
  ["Enter（回复进行中）", "插入：正在回复的智能体下一步就能看到；群聊里改为排队"],
  ["Ctrl + Enter（回复进行中）", "排队：回复完成后按顺序发出，排队的消息可以编辑、撤回、调整顺序"],
  ["Esc", "停止正在生成的回复；关闭弹出的列表"],
  ["Ctrl + 加号 / 减号 / 0", "桌面版放大、缩小、还原整个界面（也可以 Ctrl + 滚轮）；网页版由浏览器缩放"],
  ["↑ ↓ 然后 Enter 或 Tab", "在弹出的列表里选择"],
  ["/（不在输入框里时）", "跳到输入框并开始输入命令"],
];

const TRIGGERS: [string, string][] = [
  ["/", "命令：/compact 压缩上下文、/clear 开始新话题、/plan 计划模式、/model 换模型、/effort 思考强度、/web 联网开关、/export 导出对话、/help 本页"],
  ["$", "选一个技能，这次对话按它的说明做"],
  ["@", "群聊里指定成员；桌面版工作模式下还能选工作区里的文件，内容直接附上"],
  ["选中回答里的文字", "弹出「引用」和「讲解」：引用到输入框，或在右侧单独讲解这一段"],
];

export function Shortcuts() {
  const { helpOpen, setHelp, openSettings } = useUi();
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, setHelp]);
  if (!helpOpen) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-4" onClick={() => setHelp(false)}>
      <div className="rise w-full max-w-lg rounded-3xl border border-line bg-raise p-5 shadow-[var(--shadow)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">快捷键和命令</h2>
          <IconButton aria-label="关闭" onClick={() => setHelp(false)}>
            <X size={18} />
          </IconButton>
        </div>
        <h3 className="mt-3 text-[13px] font-medium text-fg-3">按键</h3>
        <dl className="mt-1.5 space-y-1.5 text-sm">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-40 shrink-0">
                <kbd className="rounded-md border border-line-2 bg-bg px-1.5 py-0.5 font-mono text-[12px]">{k}</kbd>
              </dt>
              <dd className="text-fg-2">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-4 text-[13px] font-medium text-fg-3">在输入框里输入</h3>
        <dl className="mt-1.5 space-y-2 text-sm">
          {TRIGGERS.map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-40 shrink-0 font-medium">{k}</dt>
              <dd className="text-fg-2">{v}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={() => {
            setHelp(false);
            openSettings("guide");
          }}
          className="mt-4 text-[13px] font-medium text-accent-text hover:underline"
        >
          各个区域和按钮是做什么的？看新手教程
        </button>
      </div>
    </div>
  );
}
