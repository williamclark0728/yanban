import clsx from "clsx";
import { ChevronLeft, Minus, Pencil, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { builtInTemplates, existingFor, freeGroupName, instantiate, snapshot } from "../lib/templates";
import { MAX_ROUNDS, useData, useUi } from "../store";
import type { Agent, TeamTemplate, TemplateMember } from "../types";
import { BotAvatar, GroupAvatar } from "./Avatar";
import { Actions, DangerButton, Field, inputCls, Modal } from "./Editors";
import { IconButton, Segmented } from "./ui";
import { useShallow } from "zustand/react/shallow";

/** Template members look like agents to the avatar components. */
const asAgents = (members: TemplateMember[]) => members.map((m) => ({ ...m, id: m.key }) as unknown as Agent);

const rules = (t: Pick<TeamTemplate, "consensus" | "maxRounds">) => `${t.consensus === "strict" ? "严格" : "宽松"}规则 · 最多 ${t.maxRounds} 轮`;

// ---------- pick a template, then create a group from it ----------

export function TemplatePicker({ onClose }: { onClose: () => void }) {
  const { templates, groups } = useData(useShallow((s) => ({ templates: s.templates, groups: s.groups })));
  const [picked, setPicked] = useState<TeamTemplate | null>(null);
  const [name, setName] = useState("");

  if (picked) {
    return <CreateFromTemplate template={picked} name={name} setName={setName} onBack={() => setPicked(null)} onClose={onClose} />;
  }

  const choose = (t: TeamTemplate) => {
    setName(freeGroupName(t.name, groups));
    setPicked(t);
  };

  return (
    <Modal title="从模板新建群聊" onClose={onClose} footer={<div className="flex-1 text-[13px] text-fg-3">选一个模板，下一步可以改群名、看成员</div>}>
      <div className="space-y-5">
        <Section title="内置模板">
          {builtInTemplates.map((t) => (
            <TemplateCard key={t.id} template={t} onPick={() => choose(t)} />
          ))}
        </Section>
        <Section title="我的模板">
          {templates.length ? (
            templates.map((t) => <TemplateCard key={t.id} template={t} onPick={() => choose(t)} editable />)
          ) : (
            <p className="rounded-2xl border border-dashed border-line-2 px-4 py-4 text-[13px] text-fg-3">
              在群聊资料里点「存为模板」，就能把自己搭好的团队（成员、角色、规则）存到这里，以后一键复用。
            </p>
          )}
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-fg-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TemplateCard({ template: t, onPick, editable }: { template: TeamTemplate; onPick: () => void; editable?: boolean }) {
  const edit = useUi((s) => s.edit);
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-line bg-raise pr-2 transition-colors hover:bg-raise-2">
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 text-left">
        <GroupAvatar members={asAgents(t.members)} size={46} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t.name}</span>
          {t.description && <span className="mt-0.5 line-clamp-2 block text-[13px] text-fg-2">{t.description}</span>}
          <span className="mt-1 block text-[12px] text-fg-3">
            {t.members.map((m) => m.name).join("、")} · {rules(t)}
          </span>
        </span>
      </button>
      {editable && (
        <IconButton aria-label="编辑模板" onClick={() => edit({ kind: "template", id: t.id })}>
          <Pencil size={16} />
        </IconButton>
      )}
    </div>
  );
}

function CreateFromTemplate({
  template: t,
  name,
  setName,
  onBack,
  onClose,
}: {
  template: TeamTemplate;
  name: string;
  setName: (v: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { agents } = useData(useShallow((s) => ({ agents: s.agents })));
  const open = useUi((s) => s.open);
  const created = t.members.filter((m) => !existingFor(m, agents)).length;

  const create = () => {
    const id = instantiate(t, name.trim());
    open({ kind: "group", id });
    onClose();
  };

  return (
    <Modal title={t.name} onClose={onClose} footer={<Actions onCancel={onBack} onSave={create} saveLabel="创建群聊" disabled={!name.trim()} />}>
      <div className="space-y-5">
        <button type="button" onClick={onBack} className="-ml-1 flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
          <ChevronLeft size={17} /> 全部模板
        </button>
        {t.description && <p className="text-[14px] text-fg-2">{t.description}</p>}
        <Field label="群名称">
          <input className={clsx(inputCls, "h-11")} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm font-medium">
            <span>成员</span>
            <span className="text-[13px] font-normal text-fg-3">{created ? `新建 ${created} 位，其余用已有的同名智能体` : "都用已有的同名智能体"}</span>
          </div>
          <MemberRows template={t} agents={agents} />
        </div>
        <p className="text-[13px] text-fg-3">{rules(t)}，创建后可以在群资料里调整。</p>
      </div>
    </Modal>
  );
}

function MemberRows({ template: t, agents, onRemove }: { template: TeamTemplate; agents?: Agent[]; onRemove?: (key: string) => void }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
      {t.members.map((m) => {
        const same = agents && existingFor(m, agents);
        return (
          <div key={m.key} className="flex items-center gap-3 px-4 py-2.5">
            <BotAvatar agent={same ?? m} size={34} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                {m.name}
                {m.key === t.leadKey && <span className="rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-text">主持</span>}
                {m.web && <span className="rounded-md bg-raise-2 px-1.5 py-px text-[11px] text-fg-2">联网</span>}
              </span>
              <span className="block truncate text-[13px] text-fg-3">{(same ?? m).tagline}</span>
            </span>
            {agents && <span className={clsx("shrink-0 text-[12px]", same ? "text-fg-3" : "text-ok")}>{same ? "已有" : "新建"}</span>}
            {onRemove && m.key !== t.leadKey && t.members.length > 2 && (
              <IconButton aria-label={`移除${m.name}`} className="size-7" onClick={() => onRemove(m.key)}>
                <X size={15} />
              </IconButton>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- save a group as a template ----------

export function SaveTemplate({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { groups, agents, saveTemplate } = useData(useShallow((s) => ({ groups: s.groups, agents: s.agents, saveTemplate: s.saveTemplate })));
  const group = groups.find((g) => g.id === groupId);
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState("");
  if (!group) return null;
  const preview = snapshot(group, agents, name, description);

  return (
    <Modal
      title="存为模板"
      onClose={onClose}
      footer={
        <Actions
          onCancel={onClose}
          onSave={() => {
            saveTemplate(snapshot(group, agents, name.trim(), description.trim()));
            onClose();
          }}
          saveLabel="保存"
          disabled={!name.trim()}
        />
      }
    >
      <div className="space-y-5">
        <p className="text-[14px] text-fg-2">保存这个群现在的成员、角色设定、模型和协作规则。以后在「从模板新建群聊」里一键复用。</p>
        <Field label="模板名称">
          <input className={clsx(inputCls, "h-11")} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="说明" hint="写这个团队适合做什么，选模板时会看到">
          <input className={clsx(inputCls, "h-11")} maxLength={60} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="比如：课程作业，查资料 + 写报告 + 核对" />
        </Field>
        <div>
          <div className="mb-1.5 text-sm font-medium">成员</div>
          <MemberRows template={preview} />
        </div>
        <p className="text-[13px] text-fg-3">{rules(preview)}</p>
      </div>
    </Modal>
  );
}

// ---------- edit or delete one of the user's templates ----------

export function TemplateEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { templates, saveTemplate, deleteTemplate } = useData(useShallow((s) => ({ templates: s.templates, saveTemplate: s.saveTemplate, deleteTemplate: s.deleteTemplate })));
  const edit = useUi((s) => s.edit);
  const found = templates.find((t) => t.id === id);
  const [draft, setDraft] = useState<TeamTemplate | undefined>(found);
  if (!found || !draft) return null;
  const set = (patch: Partial<TeamTemplate>) => setDraft((d) => d && { ...d, ...patch });
  const back = () => edit({ kind: "templates" });

  return (
    <Modal
      title="编辑模板"
      onClose={onClose}
      footer={
        <>
          <DangerButton
            label="删除模板"
            onConfirm={() => {
              deleteTemplate(id);
              back();
            }}
          />
          <Actions
            onCancel={back}
            onSave={() => {
              saveTemplate({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
              back();
            }}
            saveLabel="保存"
            disabled={!draft.name.trim()}
          />
        </>
      }
    >
      <div className="space-y-5">
        <Field label="模板名称">
          <input className={clsx(inputCls, "h-11")} maxLength={20} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="说明">
          <input className={clsx(inputCls, "h-11")} maxLength={60} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div>
          <div className="mb-1.5 text-sm font-medium">成员</div>
          <MemberRows template={draft} onRemove={(key) => set({ members: draft.members.filter((m) => m.key !== key) })} />
          <p className="mt-1.5 text-[13px] text-fg-3">要加人或改角色，先在群里调整，再重新存为模板</p>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">共识规则</span>
          <Segmented
            size="sm"
            value={draft.consensus}
            onChange={(consensus) => set({ consensus })}
            options={[
              { value: "strict", label: "严格" },
              { value: "relaxed", label: "宽松" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">最多轮数</span>
          <div className="flex items-center gap-1">
            <IconButton aria-label="减少" className="size-7" onClick={() => set({ maxRounds: Math.max(1, draft.maxRounds - 1) })}>
              <Minus size={15} />
            </IconButton>
            <span className="w-6 text-center font-semibold tabular-nums">{draft.maxRounds}</span>
            <IconButton aria-label="增加" className="size-7" onClick={() => set({ maxRounds: Math.min(MAX_ROUNDS, draft.maxRounds + 1) })}>
              <Plus size={15} />
            </IconButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
