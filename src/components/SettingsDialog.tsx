import clsx from "clsx";
import { BookOpen, CheckCircle2, ChevronLeft, ExternalLink, Eye, EyeOff, Globe, Loader2, Plug, Plus, Server, SlidersHorizontal, Sparkles, X, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { protocols } from "../lib/catalog";
import { isDesktop } from "../lib/desktop";
import { describeError, listModels, testProvider } from "../lib/llm";
import { isReady, resolveModel, TRIAL_ID, useData, usePrefs, useUi, type SettingsTab } from "../store";
import type { Provider, SearchConfig } from "../types";
import { searchProviders, searchReady, webSearch } from "../lib/search";
import { seedAgents, seedGroups } from "../lib/seed";
import { MeAvatar } from "./Avatar";
import { ConfigRow, McpSettings, SkillSettings } from "./Extensions";
import { ModelPicker } from "./ModelPicker";
import { IconButton, Segmented } from "./ui";

export function SettingsDialog() {
  const { settingsOpen, settingsTab, openSettings, closeSettings } = useUi();
  const [mobileContent, setMobileContent] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    setMobileContent(useUi.getState().settingsTab === "providers");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSettings();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  const nav: { value: SettingsTab; label: string; icon: ReactNode }[] = [
    { value: "general", label: "通用", icon: <SlidersHorizontal size={17} /> },
    { value: "providers", label: "模型服务", icon: <Server size={17} /> },
    { value: "search", label: "联网搜索", icon: <Globe size={17} /> },
    { value: "skills", label: "技能", icon: <BookOpen size={17} /> },
    { value: "mcp", label: "MCP", icon: <Plug size={17} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] md:p-6" onClick={closeSettings}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-full w-full overflow-hidden bg-panel md:h-[min(680px,100%)] md:max-w-[920px] md:rounded-3xl md:border md:border-line md:shadow-[var(--shadow)]"
      >
        <nav className={clsx("w-full shrink-0 border-line p-3 md:block md:w-52 md:border-r", mobileContent && "hidden")}>
          <div className="flex h-11 items-center justify-between px-2">
            <span className="text-lg font-semibold">设置</span>
            <IconButton aria-label="关闭" onClick={closeSettings} className="md:hidden">
              <X size={19} />
            </IconButton>
          </div>
          <div className="mt-2 space-y-0.5">
            {nav.map((n) => (
              <button
                key={n.value}
                type="button"
                onClick={() => {
                  openSettings(n.value);
                  setMobileContent(true);
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[15px] transition-colors",
                  settingsTab === n.value ? "bg-active font-medium" : "text-fg-2 hover:bg-hover hover:text-fg",
                )}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </div>
        </nav>
        <section className={clsx("min-w-0 flex-1 flex-col md:flex", mobileContent ? "flex" : "hidden")}>
          <div className="flex h-14 shrink-0 items-center gap-1 px-3 md:px-6">
            <IconButton aria-label="返回" onClick={() => setMobileContent(false)} className="md:hidden">
              <ChevronLeft size={21} />
            </IconButton>
            <h3 className="flex-1 text-lg font-semibold">{nav.find((n) => n.value === settingsTab)?.label}</h3>
            <IconButton aria-label="关闭" onClick={closeSettings}>
              <X size={19} />
            </IconButton>
          </div>
          <div className="scroll min-h-0 flex-1 px-4 pb-6 md:px-6">
            {settingsTab === "general" && <General />}
            {settingsTab === "providers" && <Providers />}
            {settingsTab === "search" && <SearchSettings />}
            {settingsTab === "skills" && <SkillSettings />}
            {settingsTab === "mcp" && <McpSettings />}
          </div>
        </section>
      </div>
    </div>
  );
}

export function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-[13px] text-fg-3">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function General() {
  const { mode, setMode, theme, setTheme, name, setName, approval, setApproval } = usePrefs();
  const { agents, groups, restoreExamples } = useData();
  const [restoring, setRestoring] = useState(false);
  const missing =
    seedAgents.filter((a) => !agents.some((x) => x.id === a.id)).length + seedGroups.filter((g) => !groups.some((x) => x.id === g.id)).length;
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
      <Row title="昵称" desc="显示在左下角，智能体会这样称呼你">
        <div className="flex w-full items-center gap-3 sm:w-64">
          <MeAvatar size={40} />
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="怎么称呼你"
            autoFocus={!name}
            maxLength={20}
          />
        </div>
      </Row>
      <Row title="界面模式" desc={mode === "simple" ? "只保留聊天和协作，参数自动设置" : "显示生成参数、Token 用量和每一步的耗时"}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "simple", label: "简洁" },
            { value: "dev", label: "开发者" },
          ]}
        />
      </Row>
      <Row title="外观">
        <Segmented
          value={theme}
          onChange={setTheme}
          options={[
            { value: "dark", label: "深色" },
            { value: "light", label: "浅色" },
            { value: "system", label: "跟随系统" },
          ]}
        />
      </Row>
      <Row title="示例" desc={`论文写作组，以及${seedAgents.map((a) => a.name).join("、")}`}>
        <button
          type="button"
          disabled={!missing || restoring}
          onClick={async () => {
            setRestoring(true);
            await restoreExamples();
            setRestoring(false);
          }}
          className="h-10 rounded-full border border-line-2 px-5 text-sm font-medium hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {missing ? `添加回来（${missing} 个）` : "都在列表里"}
        </button>
      </Row>
      {isDesktop && (
        <Row
          title="工作模式审批"
          desc={
            approval === "ask"
              ? "读文件、改文件、运行命令都先问你"
              : approval === "read"
                ? "读文件和搜索直接做，改文件和运行命令先问你"
                : "全部直接做；危险命令仍然要你确认两次"
          }
        >
          <Segmented
            value={approval}
            onChange={setApproval}
            options={[
              { value: "ask", label: "每次询问" },
              { value: "read", label: "只读自动" },
              { value: "full", label: "完全权限" },
            ]}
          />
        </Row>
      )}
      <ConfigRow />
    </div>
  );
}

function Providers() {
  const { providers, defaultModel, setDefaultModel, trial } = useData();
  const { editProvider, setEditProvider } = useUi();

  if (editProvider) {
    const current = providers.find((p) => p.id === editProvider);
    return <ProviderForm key={editProvider} provider={current} onClose={() => setEditProvider(null)} />;
  }

  const own = providers.filter((p) => p.id !== TRIAL_ID);
  const ready = own.filter(isReady);
  const rest = own.filter((p) => !isReady(p));
  const fallback = resolveModel(undefined, providers, defaultModel);
  return (
    <div className="space-y-6">
      {trial && (
        <div>
          <div className="mb-2 px-1 text-[13px] font-medium text-fg-3">体验模型</div>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-raise px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[14px] font-medium">{trial.model}</div>
              <div className="text-[13px] text-fg-3">
                免费使用，每天 {trial.limit} 次，今天还剩 {trial.remaining} 次
              </div>
            </div>
          </div>
          <p className="mt-1.5 px-1 text-[13px] text-fg-3">连接下面任一服务后，智能体自动改用你的模型</p>
        </div>
      )}
      {ready.length > 0 && (
        <div>
          <div className="mb-2 px-1 text-[13px] font-medium text-fg-3">默认模型</div>
          <ModelPicker
            value={defaultModel}
            onChange={setDefaultModel}
            shown={fallback ? { title: fallback.modelId, subtitle: fallback.provider.name } : null}
          />
          <p className="mt-1.5 px-1 text-[13px] text-fg-3">没有单独指定模型的智能体都用它</p>
        </div>
      )}
      <ProviderGroup title="已连接" items={ready} onEdit={setEditProvider} />
      <ProviderGroup title={ready.length ? "可添加" : "选一个服务，填入 API Key 即可开始"} items={rest} onEdit={setEditProvider} />
      <button
        type="button"
        onClick={() => setEditProvider("new")}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 py-3.5 text-[15px] text-fg-2 hover:bg-hover hover:text-fg"
      >
        <Plus size={18} /> 自定义服务
      </button>
    </div>
  );
}

function ProviderGroup({ title, items, onEdit }: { title: string; items: Provider[]; onEdit: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 px-1 text-[13px] font-medium text-fg-3">{title}</div>
      <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onEdit(p.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left first:rounded-t-2xl last:rounded-b-2xl hover:bg-hover"
          >
            <ProviderMark name={p.name} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="truncate text-[13px] text-fg-3">{isReady(p) ? `${p.models.length} 个模型` : p.baseUrl}</div>
            </div>
            {isReady(p) ? (
              <span className="flex items-center gap-1.5 text-[13px] text-ok">
                <span className="size-2 rounded-full bg-ok" />
                已连接
              </span>
            ) : (
              <span className="text-[13px] text-accent-text">{p.apiKey ? "待完成" : "添加"}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

const markColors = ["#8b6cff", "#22b8a0", "#f59a2f", "#4596ff", "#f06283", "#b5814f"];

function ProviderMark({ name }: { name: string }) {
  const hue = markColors[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % markColors.length];
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: hue }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[13px] text-fg-3">{hint}</div>}
    </div>
  );
}

export const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg px-3.5 text-[15px] outline-none placeholder:text-fg-3 focus:border-accent";

export type Status = { kind: "busy"; text: string } | { kind: "ok"; text: string } | { kind: "error"; text: string; detail?: string } | null;

export function StatusBox({ status }: { status: Status }) {
  const dev = usePrefs((s) => s.mode === "dev");
  if (!status) return null;
  return (
    <div
      className={clsx(
        "rounded-xl px-3.5 py-2.5 text-sm",
        status.kind === "ok" && "bg-ok-soft text-ok",
        status.kind === "error" && "bg-bad-soft text-bad",
        status.kind === "busy" && "bg-active text-fg-2",
      )}
    >
      <div className="flex items-center gap-2">
        {status.kind === "busy" && <Loader2 size={16} className="animate-spin" />}
        {status.kind === "ok" && <CheckCircle2 size={16} />}
        {status.kind === "error" && <XCircle size={16} />}
        {status.text}
      </div>
      {status.kind === "error" && dev && status.detail && <div className="mt-1 break-all font-mono text-xs text-fg-2">{status.detail}</div>}
    </div>
  );
}

export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(inputCls, "pr-11 font-mono")}
        placeholder={placeholder}
      />
      <button
        type="button"
        aria-label={show ? "隐藏" : "显示"}
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function SearchSettings() {
  const { search, saveSearch, agents, siteSearch } = useData();
  const [draft, setDraft] = useState<SearchConfig>(search);
  const [status, setStatus] = useState<Status>(null);
  const meta = searchProviders.find((p) => p.value === draft.provider)!;
  const set = (patch: Partial<SearchConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
  };
  const setKey = (v: string) => set({ keys: { ...draft.keys, [draft.provider]: v.trim() } });
  const ready = searchReady(draft);
  const webAgents = agents.filter((a) => a.web);

  const test = async () => {
    if (!ready) return setStatus({ kind: "error", text: draft.provider === "searxng" ? "先填 SearXNG 地址" : "先填 API Key" });
    setStatus({ kind: "busy", text: "正在搜索…" });
    try {
      const hits = await webSearch(draft, "今天的科技新闻");
      setStatus({ kind: "ok", text: `连接成功，搜到 ${hits.length} 条结果` });
    } catch (e) {
      const err = describeError(e);
      setStatus({ kind: "error", text: err.message, detail: err.detail });
    }
  };

  return (
    <div className="space-y-5">
      <p className="px-1 text-[13px] text-fg-3">
        连接搜索服务后，在智能体资料里打开「联网搜索」，它就能搜网页、读原文，回答里标注来源。
        {webAgents.length > 0 && ` 已开启：${webAgents.map((a) => a.name).join("、")}。`}
      </p>
      {siteSearch && (
        <div>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-raise px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
              <Globe size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">本站提供的搜索</div>
              <div className="text-[13px] text-fg-3">
                不用填 Key，每天 {siteSearch.limit} 次，今天还剩 {siteSearch.remaining} 次
              </div>
            </div>
            {searchReady(search) && <span className="shrink-0 text-[13px] text-fg-3">已改用你的服务</span>}
          </div>
          <p className="mt-1.5 px-1 text-[13px] text-fg-3">在下面连接自己的搜索服务后，自动改用你的，不受次数限制</p>
        </div>
      )}
      <Field label="搜索服务" hint={meta.hint}>
        <Segmented value={draft.provider} onChange={(provider) => set({ provider })} options={searchProviders.map((p) => ({ value: p.value, label: p.label }))} />
      </Field>
      {draft.provider === "searxng" ? (
        <Field label="SearXNG 地址" hint="需要在实例设置里允许 JSON 格式">
          <input
            className={clsx(inputCls, "font-mono text-sm")}
            value={draft.searxngUrl ?? ""}
            onChange={(e) => set({ searxngUrl: e.target.value })}
            placeholder="https://searx.example.com"
          />
        </Field>
      ) : (
        <Field
          label={
            <span className="flex items-center justify-between">
              API Key
              {meta.keyUrl && (
                <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[13px] font-normal text-accent-text hover:underline">
                  获取 API Key <ExternalLink size={13} />
                </a>
              )}
            </span>
          }
          hint="保存在本机浏览器"
        >
          <SecretInput value={draft.keys[draft.provider] ?? ""} onChange={setKey} placeholder={draft.provider === "tavily" ? "tvly-..." : "sk-..."} />
        </Field>
      )}
      <Field label="Jina Key（可选）" hint="读取网页全文用 Jina Reader，不填也能用，填了频率限制更宽">
        <SecretInput value={draft.jinaKey ?? ""} onChange={(v) => set({ jinaKey: v.trim() })} placeholder="jina_..." />
      </Field>

      <StatusBox status={status} />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex-1" />
        <button
          type="button"
          onClick={test}
          disabled={status?.kind === "busy"}
          className="h-10 rounded-full border border-line-2 px-5 text-sm font-medium hover:bg-hover disabled:opacity-50"
        >
          测试搜索
        </button>
        <button
          type="button"
          onClick={() => {
            saveSearch(draft);
            setStatus({ kind: "ok", text: ready ? "已保存" : "已保存，填好后才能使用" });
          }}
          className="h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90"
        >
          保存
        </button>
      </div>
    </div>
  );
}

const blank: Provider = { id: "", name: "", protocol: "openai-chat", baseUrl: "", apiKey: "", models: [], enabled: false, custom: true };

function ProviderForm({ provider, onClose }: { provider?: Provider; onClose: () => void }) {
  const { providers, defaultModel, saveProvider, removeProvider, setDefaultModel } = useData();
  const isNew = !provider;
  const [draft, setDraft] = useState<Provider>(provider ?? blank);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [modelInput, setModelInput] = useState("");
  const [status, setStatus] = useState<Status>(null);

  const set = (patch: Partial<Provider>) => setDraft((d) => ({ ...d, ...patch }));
  const candidate = (): Provider => ({ ...draft, apiKey: key.trim() || draft.apiKey, baseUrl: draft.baseUrl.trim() });

  const problem = (() => {
    if (isNew) {
      if (!/^[a-z][a-z0-9-]*$/.test(draft.id)) return "服务 ID 需小写字母开头，只含字母、数字和横线";
      if (providers.some((p) => p.id === draft.id)) return "这个服务 ID 已存在";
      if (!draft.name.trim()) return "填写显示名称";
    }
    try {
      new URL(draft.baseUrl.trim());
    } catch {
      return "Base URL 格式不对";
    }
    if (!draft.keyless && !key.trim() && !draft.apiKey) return "填写 API Key";
    return null;
  })();

  const addModels = (ids: string[]) => set({ models: [...new Set([...draft.models, ...ids])] });

  const fetchModels = async () => {
    if (problem) return setStatus({ kind: "error", text: problem });
    setStatus({ kind: "busy", text: "正在获取模型列表…" });
    try {
      const ids = await listModels(candidate());
      addModels(ids);
      setStatus({ kind: "ok", text: `获取到 ${ids.length} 个模型` });
    } catch (e) {
      const err = describeError(e);
      setStatus({ kind: "error", text: err.message, detail: err.detail });
    }
  };

  const test = async () => {
    if (problem) return setStatus({ kind: "error", text: problem });
    setStatus({ kind: "busy", text: "正在连接…" });
    const r = await testProvider(candidate());
    if (r.ok) {
      if (r.models && draft.models.length === 0) addModels(r.models);
      setStatus({ kind: "ok", text: r.message });
    } else setStatus({ kind: "error", text: r.message, detail: r.detail });
  };

  const save = async () => {
    if (problem) return setStatus({ kind: "error", text: problem });
    if (draft.models.length === 0) return setStatus({ kind: "error", text: "至少添加一个模型，或点「获取模型列表」" });
    const next = { ...candidate(), name: draft.name.trim(), enabled: true };
    await saveProvider(next);
    if (!defaultModel || !providers.some((p) => p.id === defaultModel.provider && isReady(p))) {
      setDefaultModel({ provider: next.id, id: next.models[0] });
    }
    onClose();
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={onClose} className="-ml-1 flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
        <ChevronLeft size={17} /> 全部服务
      </button>
      <div className="flex items-center gap-3">
        <ProviderMark name={draft.name || "+"} />
        <div className="flex-1 text-lg font-semibold">{provider?.name ?? "自定义服务"}</div>
        {provider?.keyUrl && (
          <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[13px] text-accent-text hover:underline">
            获取 API Key <ExternalLink size={13} />
          </a>
        )}
      </div>

      {isNew && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="服务 ID" hint="小写字母开头，用于区分不同服务">
            <input className={inputCls} value={draft.id} onChange={(e) => set({ id: e.target.value.trim() })} placeholder="my-gateway" />
          </Field>
          <Field label="显示名称">
            <input className={inputCls} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="我的中转" />
          </Field>
        </div>
      )}

      {!draft.keyless && (
        <Field label="API Key" hint={draft.apiKey ? "已保存在本机，留空保持不变" : "保存在本机浏览器，之后自动使用"}>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={clsx(inputCls, "pr-11 font-mono")}
              placeholder={draft.apiKey ? `已保存 ····${draft.apiKey.slice(-4)}` : "sk-..."}
            />
            <button
              type="button"
              aria-label={show ? "隐藏" : "显示"}
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg"
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
      )}

      <Field label="Base URL">
        <input className={clsx(inputCls, "font-mono text-sm")} value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
      </Field>

      <Field label="接口协议" hint={protocols.find((p) => p.value === draft.protocol)?.hint}>
        <select className={clsx(inputCls, "appearance-none")} value={draft.protocol} onChange={(e) => set({ protocol: e.target.value as Provider["protocol"] })}>
          {protocols.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={
          <span className="flex items-center justify-between">
            <span>模型{draft.models.length > 0 && <span className="ml-1.5 font-normal text-fg-3">{draft.models.length}</span>}</span>
            <span className="flex gap-3 font-normal">
              {draft.models.length > 0 && (
                <button type="button" onClick={() => set({ models: [] })} className="text-[13px] text-fg-3 hover:text-fg">
                  清空
                </button>
              )}
              <button type="button" onClick={fetchModels} className="text-[13px] text-accent-text hover:underline">
                获取模型列表
              </button>
            </span>
          </span>
        }
      >
        <div className="scroll flex max-h-48 min-h-11 flex-wrap content-start gap-2 rounded-xl border border-line bg-bg p-2">
          {draft.models.map((m) => (
            <span key={m} className="flex items-center gap-1 rounded-lg bg-raise-2 py-1 pl-2.5 pr-1.5 font-mono text-[13px]">
              {m}
              <button type="button" aria-label={`移除 ${m}`} onClick={() => set({ models: draft.models.filter((x) => x !== m) })} className="text-fg-3 hover:text-fg">
                <X size={13} />
              </button>
            </span>
          ))}
          <input
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && modelInput.trim()) {
                e.preventDefault();
                addModels([modelInput.trim()]);
                setModelInput("");
              }
            }}
            className="h-7 min-w-36 flex-1 bg-transparent px-1 font-mono text-sm outline-none placeholder:font-sans placeholder:text-fg-3"
            placeholder="输入模型 ID 回车添加"
          />
        </div>
      </Field>

      <StatusBox status={status} />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {provider && (provider.apiKey || provider.enabled) && (
          <button
            type="button"
            onClick={async () => {
              await removeProvider(provider.id);
              onClose();
            }}
            className="h-10 rounded-full px-4 text-sm font-medium text-bad hover:bg-bad-soft"
          >
            {provider.custom ? "删除服务" : "断开并清除 Key"}
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={test}
          disabled={status?.kind === "busy"}
          className="h-10 rounded-full border border-line-2 px-5 text-sm font-medium hover:bg-hover disabled:opacity-50"
        >
          测试连接
        </button>
        <button
          type="button"
          onClick={save}
          disabled={status?.kind === "busy"}
          className="h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  );
}
