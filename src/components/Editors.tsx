import clsx from "clsx";
import { Check, LayoutTemplate, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { resolveModel, useData, useUi } from "../store";
import type { Agent, AgentColor, Group, RoleCard } from "../types";
import { BotAvatar, palette } from "./Avatar";
import { ModelPicker } from "./ModelPicker";
import { SaveTemplate, TemplateEditor, TemplatePicker } from "./Templates";
import { IconButton } from "./ui";
import { useShallow } from "zustand/react/shallow";

export function Editors() {
  const editor = useUi((s) => s.editor);
  const edit = useUi((s) => s.edit);
  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && edit(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, edit]);
  if (!editor) return null;
  const close = () => edit(null);
  switch (editor.kind) {
    case "agent":
      return <AgentEditor key={editor.id ?? "new"} id={editor.id} onClose={close} />;
    case "group":
      return <GroupEditor key={editor.id ?? "new"} id={editor.id} onClose={close} />;
    case "templates":
      return <TemplatePicker onClose={close} />;
    case "template":
      return <TemplateEditor key={editor.id} id={editor.id!} onClose={close} />;
    case "saveTemplate":
      return <SaveTemplate key={editor.id} groupId={editor.id!} onClose={close} />;
  }
}

export function Modal({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-full w-full flex-col overflow-hidden bg-panel md:h-auto md:max-h-[min(760px,100%)] md:max-w-[580px] md:rounded-3xl md:border md:border-line md:shadow-[var(--shadow)]"
      >
        <div className="flex h-14 shrink-0 items-center px-5">
          <h3 className="flex-1 text-lg font-semibold">{title}</h3>
          <IconButton aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        <div className="scroll min-h-0 flex-1 px-5 pb-4">{children}</div>
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

export const inputCls = "w-full rounded-xl border border-line bg-bg px-3.5 text-[15px] outline-none placeholder:text-fg-3 focus:border-accent";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[13px] text-fg-3">{hint}</div>}
    </label>
  );
}

export function DangerButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={clsx("h-10 rounded-full px-4 text-sm font-medium text-bad", armed ? "bg-bad-soft" : "hover:bg-bad-soft")}
    >
      {armed ? "再点一次确认" : label}
    </button>
  );
}

export function Actions({ onCancel, onSave, saveLabel, disabled }: { onCancel: () => void; onSave: () => void; saveLabel: string; disabled: boolean }) {
  return (
    <>
      <div className="flex-1" />
      <button type="button" onClick={onCancel} className="h-10 rounded-full px-5 text-sm font-medium hover:bg-hover">
        取消
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-40"
      >
        {saveLabel}
      </button>
    </>
  );
}

// ---------- agent ----------

const colors = Object.keys(palette) as AgentColor[];

const templates: { label: string; tagline: string; role: RoleCard }[] = [
  {
    label: "主笔",
    tagline: "起草和修订正文",
    role: { duty: "根据材料和要求写出完整稿件，按意见修订。", scope: "只使用给定材料中的事实和数字。", io: "输入：任务与材料。输出：完整稿件和修订说明。", protocol: "每条成立的意见都要回应：已改或说明理由。" },
  },
  {
    label: "审稿人",
    tagline: "看逻辑、措辞和结构",
    role: { duty: "从读者角度检查论证是否成立、表述是否准确。", scope: "只提意见，不重写全文。", io: "输入：稿件。输出：逐条修改意见。", protocol: "意见具体到句子，并给出改法。" },
  },
  {
    label: "事实核查",
    tagline: "逐条核对数字和出处",
    role: { duty: "把稿件里的数字、事实与原始材料逐条对照。", scope: "只判断对错并给出原文位置，不改文风。", io: "输入：稿件与材料。输出：疑点清单，每条标为成立、不成立或存疑。", protocol: "疑点必须附出处；找不到出处的标为存疑。" },
  },
  {
    label: "翻译",
    tagline: "中英互译与润色",
    role: { duty: "准确翻译并保持术语一致。", scope: "不增删原意。", io: "输入：原文。输出：译文，必要时附术语说明。", protocol: "遇到歧义先列出可能译法。" },
  },
  {
    label: "程序员",
    tagline: "写代码、查 bug",
    role: { duty: "根据需求写出可运行的代码，解释关键思路。", scope: "不确定的 API 要说明需要查证。", io: "输入：需求或报错。输出：代码和简短说明。", protocol: "代码附运行方式。" },
  },
];

const defaults = { temperature: 0.7, topP: 1, maxTokens: 0, history: 20 };

function AgentEditor({ id, onClose }: { id?: string; onClose: () => void }) {
  const { agents, providers, defaultModel, addAgent, updateAgent, deleteAgent } = useData(useShallow((s) => ({ agents: s.agents, providers: s.providers, defaultModel: s.defaultModel, addAgent: s.addAgent, updateAgent: s.updateAgent, deleteAgent: s.deleteAgent })));
  const open = useUi((s) => s.open);
  const existing = agents.find((a) => a.id === id);
  const [draft, setDraft] = useState<Agent>(
    existing ?? {
      id: crypto.randomUUID().slice(0, 8),
      name: "",
      color: colors.find((c) => !agents.some((a) => a.color === c)) ?? colors[agents.length % colors.length],
      look: Math.round((Math.random() * 2 - 1) * 10) / 10,
      tagline: "",
      role: { duty: "", scope: "", io: "", protocol: "" },
      model: null,
      params: defaults,
      memory: [],
    },
  );
  const set = (patch: Partial<Agent>) => setDraft((d) => ({ ...d, ...patch }));
  const setRole = (patch: Partial<RoleCard>) => setDraft((d) => ({ ...d, role: { ...d.role, ...patch } }));
  const target = resolveModel(draft, providers, defaultModel);
  const fallback = resolveModel(undefined, providers, defaultModel);

  const nameTaken = agents.some((a) => a.id !== draft.id && a.name === draft.name.trim());
  const valid = !!draft.name.trim() && !!draft.role.duty.trim() && !nameTaken;

  const save = () => {
    const clean = { ...draft, name: draft.name.trim(), tagline: draft.tagline.trim() || draft.role.duty.trim().slice(0, 20) };
    if (existing) updateAgent(clean.id, clean);
    else {
      addAgent(clean);
      open({ kind: "agent", id: clean.id });
    }
    onClose();
  };

  return (
    <Modal
      title={existing ? "编辑智能体" : "新建智能体"}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <DangerButton
              label="删除智能体"
              onConfirm={() => {
                deleteAgent(existing.id);
                onClose();
              }}
            />
          )}
          <Actions onCancel={onClose} onSave={save} saveLabel={existing ? "保存" : "创建"} disabled={!valid} />
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <button type="button" aria-label="换个眼神" onClick={() => set({ look: Math.round((Math.random() * 2 - 1) * 10) / 10 })}>
            <BotAvatar agent={draft} size={64} />
          </button>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set({ color: c })}
                className={clsx("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-[var(--panel)]", draft.color === c && "ring-2 ring-fg")}
                style={{ background: palette[c].body }}
              >
                {draft.color === c && <Check size={14} color={palette[c].eye} />}
              </button>
            ))}
          </div>
        </div>

        {!existing && (
          <div>
            <div className="mb-1.5 text-sm font-medium">从模板开始</div>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, name: d.name || t.label, tagline: t.tagline, role: t.role }))}
                  className="rounded-full border border-line px-3 py-1.5 text-[13px] hover:bg-hover"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称" hint={nameTaken ? "已有同名智能体" : undefined}>
            <input className={clsx(inputCls, "h-11")} maxLength={12} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="比如：数据分析师" />
          </Field>
          <Field label="一句话介绍">
            <input className={clsx(inputCls, "h-11")} maxLength={30} value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="显示在列表里" />
          </Field>
        </div>

        <Field label="职责" hint="它负责做什么。群聊里管家按这一条给它派活">
          <textarea className={clsx(inputCls, "min-h-20 resize-y py-2.5")} value={draft.role.duty} onChange={(e) => setRole({ duty: e.target.value })} />
        </Field>
        <Field label="能力边界">
          <textarea className={clsx(inputCls, "min-h-16 resize-y py-2.5")} value={draft.role.scope} onChange={(e) => setRole({ scope: e.target.value })} placeholder="不做什么、只用哪些信息" />
        </Field>
        <Field label="输入输出">
          <textarea className={clsx(inputCls, "min-h-16 resize-y py-2.5")} value={draft.role.io} onChange={(e) => setRole({ io: e.target.value })} placeholder="收到什么、交出什么" />
        </Field>
        <Field label="协作方式">
          <textarea className={clsx(inputCls, "min-h-16 resize-y py-2.5")} value={draft.role.protocol} onChange={(e) => setRole({ protocol: e.target.value })} placeholder="在群里和别人怎么配合" />
        </Field>

        <div>
          <div className="mb-1.5 text-sm font-medium">模型</div>
          <ModelPicker
            value={draft.model}
            onChange={(model) => set({ model })}
            inheritLabel={fallback ? `跟随默认（${fallback.modelId}）` : "跟随默认"}
            shown={target ? { title: target.modelId, subtitle: draft.model ? target.provider.name : `默认 · ${target.provider.name}` } : null}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------- group ----------

function GroupEditor({ id, onClose }: { id?: string; onClose: () => void }) {
  const { agents, groups, addGroup, updateGroup, deleteGroup } = useData(useShallow((s) => ({ agents: s.agents, groups: s.groups, addGroup: s.addGroup, updateGroup: s.updateGroup, deleteGroup: s.deleteGroup })));
  const open = useUi((s) => s.open);
  const edit = useUi((s) => s.edit);
  const existing = groups.find((g) => g.id === id);
  const [draft, setDraft] = useState<Group>(
    existing ?? {
      id: crypto.randomUUID().slice(0, 8),
      name: "",
      memberIds: [],
      leadId: "",
      maxRounds: 3,
      consensus: "strict",
    },
  );

  const toggle = (agentId: string) =>
    setDraft((d) => {
      const memberIds = d.memberIds.includes(agentId) ? d.memberIds.filter((m) => m !== agentId) : [...d.memberIds, agentId];
      const leadId = memberIds.includes(d.leadId) ? d.leadId : (memberIds.find((m) => m === "butler") ?? memberIds[0] ?? "");
      return { ...d, memberIds, leadId };
    });

  const valid = !!draft.name.trim() && draft.memberIds.length > 0 && draft.memberIds.includes(draft.leadId);
  const members = draft.memberIds.map((m) => agents.find((a) => a.id === m)).filter((a): a is Agent => !!a);

  const save = () => {
    const clean = { ...draft, name: draft.name.trim() };
    if (existing) updateGroup(clean.id, clean);
    else {
      addGroup(clean);
      open({ kind: "group", id: clean.id });
    }
    onClose();
  };

  return (
    <Modal
      title={existing ? "编辑群聊" : "新建群聊"}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <DangerButton
              label="解散群聊"
              onConfirm={() => {
                deleteGroup(existing.id);
                onClose();
              }}
            />
          )}
          <Actions onCancel={onClose} onSave={save} saveLabel={existing ? "保存" : "创建"} disabled={!valid} />
        </>
      }
    >
      <div className="space-y-5">
        {!existing && (
          <button
            type="button"
            onClick={() => edit({ kind: "templates" })}
            className="flex w-full items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-left text-accent-text hover:opacity-90"
          >
            <LayoutTemplate size={18} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">从模板创建</span>
              <span className="block text-[13px] opacity-80">论文写作、资料调研、写作、PPT 制作，或你存的模板</span>
            </span>
          </button>
        )}
        <Field label="群名称">
          <input className={clsx(inputCls, "h-11")} maxLength={20} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="比如：论文写作组" />
        </Field>

        <div>
          <div className="mb-1.5 text-sm font-medium">
            成员<span className="ml-1.5 font-normal text-fg-3">{draft.memberIds.length}</span>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
            {agents.map((a) => {
              const on = draft.memberIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left first:rounded-t-2xl last:rounded-b-2xl hover:bg-hover"
                >
                  <BotAvatar agent={a} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{a.name}</span>
                    <span className="block truncate text-[13px] text-fg-3">{a.tagline}</span>
                  </span>
                  <span className={clsx("grid size-5 place-items-center rounded-full border", on ? "border-accent bg-accent text-white" : "border-line-2")}>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {members.length > 0 && (
          <div>
            <div className="mb-1.5 text-sm font-medium">主持人</div>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, leadId: m.id }))}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm",
                    draft.leadId === m.id ? "border-accent bg-accent-soft text-accent-text" : "border-line hover:bg-hover",
                  )}
                >
                  <BotAvatar agent={m} size={22} />
                  {m.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[13px] text-fg-3">没有 @ 具体成员的消息由主持人接手：拆分任务、派给成员，最后汇总</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
