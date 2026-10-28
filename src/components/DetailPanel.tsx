import { ChevronRight, LayoutTemplate, Minus, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { MAX_ROUNDS, resolveModel, usePrefs, useData, useUi, type PanelTab } from "../store";
import { ModelPicker } from "./ModelPicker";
import type { Agent, Group } from "../types";
import { BotAvatar, GroupAvatar } from "./Avatar";
import { DangerButton } from "./Editors";
import { RunList } from "./RunRecords";
import { Card, IconButton, Label, Segmented, Switch, Tabs } from "./ui";
import { DESKTOP_DOWNLOAD, isDesktop, pickFolder } from "../lib/desktop";
import { nativeSearch } from "../lib/llm";
import { searchReady } from "../lib/search";

export function DetailPanel() {
  const { agents, groups } = useData();
  const { active, panelTab, showPanel, togglePanel, edit } = useUi();
  const group = active?.kind === "group" ? groups.find((g) => g.id === active.id) : undefined;
  const agent = active?.kind === "agent" ? agents.find((a) => a.id === active.id) : undefined;
  if (!group && !agent) return null;

  const members = group ? group.memberIds.map((id) => agents.find((a) => a.id === id)!).filter(Boolean) : [];
  const tabs: { value: PanelTab; label: string }[] = group
    ? [
        { value: "info", label: "详情" },
        { value: "members", label: "成员" },
        { value: "runs", label: "协作记录" },
      ]
    : [
        { value: "info", label: "详情" },
        { value: "memory", label: "记忆" },
      ];
  const tab = tabs.some((t) => t.value === panelTab) ? panelTab : "info";

  return (
    <aside className="flex h-full w-full flex-col bg-panel">
      <div className="flex h-16 shrink-0 items-center justify-end px-3">
        <IconButton aria-label="关闭详情" onClick={() => togglePanel(false)}>
          <X size={19} />
        </IconButton>
      </div>
      <div className="scroll flex-1 px-5 pb-8">
        <div className="flex flex-col items-center text-center">
          {group ? <GroupAvatar members={members} size={84} /> : <BotAvatar agent={agent!} size={84} />}
          <h2 className="mt-3 text-xl font-semibold">{group?.name ?? agent!.name}</h2>
          <p className="mt-1 text-sm text-fg-3">{group ? `${members.length} 位智能体 · 由${nameOf(agents, group.leadId)}主持` : agent!.tagline}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => edit(group ? { kind: "group", id: group.id } : { kind: "agent", id: agent!.id })}
              className="flex items-center gap-1.5 rounded-full bg-raise-2 px-3.5 py-1.5 text-[13px] font-medium hover:bg-active"
            >
              <Pencil size={13} /> {group ? "编辑群聊" : "编辑资料"}
            </button>
            {group && (
              <button
                type="button"
                onClick={() => edit({ kind: "saveTemplate", id: group.id })}
                className="flex items-center gap-1.5 rounded-full bg-raise-2 px-3.5 py-1.5 text-[13px] font-medium hover:bg-active"
              >
                <LayoutTemplate size={13} /> 存为模板
              </button>
            )}
          </div>
        </div>
        <div className="mt-5">
          <Tabs value={tab} tabs={tabs} onChange={showPanel} />
        </div>
        <div className="mt-5">
          {group && tab === "info" && <GroupInfo group={group} />}
          {group && tab === "members" && <MemberList group={group} members={members} />}
          {group && tab === "runs" && <RunList groupId={group.id} agents={agents} />}
          {agent && tab === "info" && <AgentInfo agent={agent} />}
          {agent && tab === "memory" && <Memory agent={agent} />}
        </div>
        {tab === "info" && <ClearChat chat={(group ?? agent)!.id} />}
      </div>
    </aside>
  );
}

const nameOf = (agents: Agent[], id: string) => agents.find((a) => a.id === id)?.name ?? id;

function GroupInfo({ group }: { group: Group }) {
  const { setConsensus, setMaxRounds, updateGroup, runs } = useData();
  const dev = usePrefs((s) => s.mode === "dev");
  const groupRuns = runs.filter((r) => r.groupId === group.id);
  return (
    <div className="space-y-5">
      <div>
        <Label>协作规则</Label>
        <Card className="divide-y divide-line">
          <div className="flex items-center justify-between px-4 py-3">
            <span>最多轮数</span>
            <div className="flex items-center gap-1">
              <IconButton
                aria-label="减少"
                className="size-7"
                onClick={() => setMaxRounds(group.id, Math.max(1, group.maxRounds - 1))}
              >
                <Minus size={15} />
              </IconButton>
              <span className="w-6 text-center font-semibold tabular-nums">{group.maxRounds}</span>
              <IconButton
                aria-label="增加"
                className="size-7"
                onClick={() => setMaxRounds(group.id, Math.min(MAX_ROUNDS, group.maxRounds + 1))}
              >
                <Plus size={15} />
              </IconButton>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span>共识规则</span>
              <Segmented
                size="sm"
                value={group.consensus}
                onChange={(v) => setConsensus(group.id, v)}
                options={[
                  { value: "strict", label: "严格" },
                  { value: "relaxed", label: "宽松" },
                ]}
              />
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
              {group.consensus === "strict"
                ? "所有疑点都被否定或解决才通过，存疑也要修改。"
                : "没有成立的疑点即通过，存疑可以保留。"}
            </p>
          </div>
        </Card>
      </div>
      <div>
        <Label>能力</Label>
        <WorkMode group value={group.workspace} onChange={(workspace) => updateGroup(group.id, { workspace })} />
      </div>
      {dev && (
        <div>
          <Label>用量</Label>
          <Card className="grid grid-cols-3 divide-x divide-line">
            <Stat label="协作次数" value={String(groupRuns.length)} />
            <Stat label="平均轮数" value={groupRuns.length ? (groupRuns.reduce((n, r) => n + r.rounds.length, 0) / groupRuns.length).toFixed(1) : "-"} />
            <Stat label="Token" value={groupRuns.reduce((n, r) => n + r.tokens, 0).toLocaleString()} />
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-fg-3">{label}</div>
    </div>
  );
}

function MemberList({ group, members }: { group: Group; members: Agent[] }) {
  const open = useUi((s) => s.open);
  const dev = usePrefs((s) => s.mode === "dev");
  return (
    <Card className="divide-y divide-line">
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => open({ kind: "agent", id: m.id })}
          className="flex w-full items-center gap-3 px-4 py-3 text-left first:rounded-t-2xl last:rounded-b-2xl hover:bg-hover"
        >
          <BotAvatar agent={m} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{m.name}</span>
              {m.id === group.leadId && (
                <span className="rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent-text">主持</span>
              )}
            </div>
            <div className="truncate text-[13px] text-fg-3">{dev ? (m.model?.id ?? "默认模型") : m.tagline}</div>
          </div>
          <ChevronRight size={16} className="text-fg-3" />
        </button>
      ))}
    </Card>
  );
}

function AgentInfo({ agent }: { agent: Agent }) {
  const { providers, defaultModel, setParam, updateAgent, search, siteSearch } = useData();
  const openSettings = useUi((s) => s.openSettings);
  const dev = usePrefs((s) => s.mode === "dev");
  const searchOk = searchReady(search) || !!siteSearch;
  const target = resolveModel(agent, providers, defaultModel);
  const native = target && nativeSearch(target.provider, target.modelId);
  const fallback = resolveModel(undefined, providers, defaultModel);
  const inherits = !agent.model || !target || target.provider.id !== agent.model.provider;
  const role = [
    ["职责", agent.role.duty],
    ["边界", agent.role.scope],
    ["输入输出", agent.role.io],
    ["协作", agent.role.protocol],
  ];
  return (
    <div className="space-y-5">
      <div>
        <Label>模型</Label>
        <ModelPicker
          value={agent.model}
          onChange={(model) => updateAgent(agent.id, { model })}
          inheritLabel={fallback ? `跟随默认（${fallback.modelId}）` : "跟随默认"}
          shown={target ? { title: target.modelId, subtitle: inherits ? `默认 · ${target.provider.name}` : target.provider.name } : null}
        />
      </div>
      <div>
        <Label>能力</Label>
        <Card className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">联网搜索</div>
            <div className="text-[13px] text-fg-3">
              {native ? (
                "当前模型自带联网搜索，需要时直接搜索"
              ) : searchOk ? (
                "需要时搜索网页、阅读原文，回答里标注来源"
              ) : (
                <button type="button" onClick={() => openSettings("search")} className="text-accent-text hover:underline">
                  先连接一个搜索服务
                </button>
              )}
            </div>
          </div>
          <Switch checked={!!agent.web} onChange={(web) => updateAgent(agent.id, { web })} label="联网搜索" />
        </Card>
        <WorkMode value={agent.workspace} onChange={(workspace) => updateAgent(agent.id, { workspace })} />
      </div>
      <div>
        <Label>角色设定</Label>
        <Card className="divide-y divide-line">
          {role.map(([k, v]) => (
            <div key={k} className="px-4 py-3">
              <div className="text-xs text-fg-3">{k}</div>
              <div className="mt-0.5 text-sm leading-relaxed">{v}</div>
            </div>
          ))}
        </Card>
      </div>
      {dev && (
        <div>
          <Label>生成参数</Label>
          <Card className="space-y-4 px-4 py-4">
            <Slider label="temperature" value={agent.params.temperature} min={0} max={2} step={0.1} onChange={(v) => setParam(agent.id, "temperature", v)} />
            <Slider label="top_p" value={agent.params.topP} min={0} max={1} step={0.05} onChange={(v) => setParam(agent.id, "topP", v)} />
            <Slider label="max_tokens" value={agent.params.maxTokens} min={0} max={65536} step={1024} format={(v) => (v ? String(v) : "不限")} onChange={(v) => setParam(agent.id, "maxTokens", v)} />
            <Slider label="上下文条数" value={agent.params.history} min={2} max={60} step={2} onChange={(v) => setParam(agent.id, "history", v)} />
          </Card>
        </div>
      )}
    </div>
  );
}

/** The work-mode folder of an agent or a group; on the website, a pointer to the desktop app. */
function WorkMode({ value, onChange, group }: { value?: string; onChange: (workspace: string | undefined) => void; group?: boolean }) {
  if (!isDesktop) {
    return (
      <Card className="mt-2 flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">工作模式</div>
          <div className="text-[13px] text-fg-3">在 Windows 桌面版里读写本机文件夹、运行命令</div>
        </div>
        <a href={DESKTOP_DOWNLOAD} className="shrink-0 rounded-full border border-line-2 px-3 py-1.5 text-[13px] font-medium hover:bg-hover">
          下载桌面版
        </a>
      </Card>
    );
  }
  const pick = () => pickFolder().then((folder) => folder && onChange(folder));
  return (
    <Card className="mt-2 flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">工作模式</div>
        {value ? (
          <button type="button" title="换一个文件夹" onClick={pick} className="block max-w-full truncate text-left font-mono text-[12.5px] text-accent-text hover:underline">
            {value}
          </button>
        ) : (
          <div className="text-[13px] text-fg-3">
            {group ? "全体成员在一个文件夹里读写文件、运行命令，生成的文件直接存进去" : "选一个文件夹，读写其中的文件、运行命令；修改前可看差异、可撤销"}
          </div>
        )}
      </div>
      <Switch checked={!!value} onChange={(on) => (on ? void pick() : onChange(undefined))} label="工作模式" />
    </Card>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="font-mono text-fg-2">{props.label}</span>
        <span className="font-mono tabular-nums">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}

function Memory({ agent }: { agent: Agent }) {
  const updateAgent = useData((s) => s.updateAgent);
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v || agent.memory.includes(v)) return;
    updateAgent(agent.id, { memory: [...agent.memory, v] });
    setText("");
  };
  return (
    <div className="space-y-3">
      <p className="px-1 text-[13px] text-fg-3">{agent.name}每次回答都会参考这些内容，只在{agent.name}自己的对话里生效</p>
      {agent.memory.length > 0 && (
        <Card className="divide-y divide-line">
          {agent.memory.map((m) => (
            <div key={m} className="group/m flex items-start gap-2 px-4 py-3 text-sm">
              <span className="flex-1 leading-relaxed">{m}</span>
              <button
                type="button"
                aria-label="删除这条记忆"
                onClick={() => updateAgent(agent.id, { memory: agent.memory.filter((x) => x !== m) })}
                className="text-fg-3 opacity-0 transition-opacity hover:text-fg group-hover/m:opacity-100"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </Card>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
          placeholder="添加一条，比如：我是大三学生"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-raise px-3 text-sm outline-none placeholder:text-fg-3 focus:border-accent"
        />
        <button type="button" onClick={add} disabled={!text.trim()} className="h-10 rounded-xl bg-raise-2 px-4 text-sm font-medium hover:bg-active disabled:opacity-40">
          添加
        </button>
      </div>
    </div>
  );
}

function ClearChat({ chat }: { chat: string }) {
  const clearChat = useData((s) => s.clearChat);
  const count = useData((s) => s.messages.filter((m) => m.chat === chat).length);
  if (count === 0) return null;
  return (
    <div className="mt-6 flex justify-center">
      <DangerButton label="清空聊天记录" onConfirm={() => clearChat(chat)} />
    </div>
  );
}
