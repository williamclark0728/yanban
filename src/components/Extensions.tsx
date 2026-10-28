import { Bookmark, BookOpen, Check, Download, FolderOpen, Pencil, Plug, Plus, Trash2, Upload, X } from "lucide-react";
import { useRef, useState, type InputHTMLAttributes } from "react";
import { importConfig, saveConfigFile } from "../lib/config";
import { isDesktop, pickFolder } from "../lib/desktop";
import { describeError } from "../lib/llm";
import { testMcp } from "../lib/mcp";
import { parseSkill, skillsOnDisk } from "../lib/skills";
import { addMemory } from "../lib/memory";
import { useData, usePrefs } from "../store";
import type { McpServer, Memory, Skill } from "../types";
import { Field, inputCls, Row, StatusBox, type Status } from "./SettingsDialog";
import { IconButton, Segmented, Switch } from "./ui";

const outline = "flex h-10 items-center gap-1.5 rounded-full border border-line-2 px-4 text-sm font-medium hover:bg-hover disabled:opacity-50";
const solid = "h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50";
const area = "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-fg-3 focus:border-accent";

// ---------- config import / export (in 通用) ----------

export function ConfigRow() {
  const [withKeys, setWithKeys] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Row title="导入 / 导出配置" desc="智能体、群、模板、模型服务、搜索、技能和 MCP 服务，不含聊天记录">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            <Switch checked={withKeys} onChange={setWithKeys} label="导出时包含 API Key" />
            包含 API Key
          </label>
          <button type="button" className={outline} onClick={() => saveConfigFile(withKeys)}>
            <Download size={15} /> 导出
          </button>
          <button type="button" className={outline} onClick={() => input.current?.click()}>
            <Upload size={15} /> 导入
          </button>
        </div>
      </Row>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setStatus({ kind: "busy", text: "正在导入…" });
          try {
            setStatus({ kind: "ok", text: await importConfig(await file.text()) });
          } catch (err) {
            setStatus({ kind: "error", text: (err as Error).message });
          }
        }}
      />
      {status && (
        <div className="px-4 pb-4">
          <StatusBox status={status} />
        </div>
      )}
    </div>
  );
}

// ---------- skills ----------

/** `<input webkitdirectory>` picks a whole folder; React's types don't know the attribute. */
const folderPicker = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;

export function SkillSettings() {
  const { skills, setSkills } = useData();
  const [editing, setEditing] = useState<Skill | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const add = (found: Skill[]) => {
    if (!found.length) return setStatus({ kind: "error", text: "没有找到 SKILL.md" });
    setSkills([...skills.filter((s) => !found.some((f) => f.name === s.name)), ...found]);
    setStatus({ kind: "ok", text: `已导入 ${found.length} 个技能：${found.map((s) => s.name).join("、")}` });
  };

  const read = async (list: FileList | null, fromFolder: boolean) => {
    const picked = [...(list ?? [])].filter((f) => (fromFolder ? /(^|\/)SKILL\.md$/i.test(f.webkitRelativePath || f.name) : /\.md$/i.test(f.name)));
    const parsed = await Promise.all(
      picked.map(async (f) => {
        const path = (f.webkitRelativePath || f.name).split("/");
        // A skill is named after its folder unless its front matter says otherwise.
        const name = path.length > 1 ? path[path.length - 2] : f.name.replace(/\.md$/i, "");
        return parseSkill(await f.text(), /^skill$/i.test(name) ? "" : name);
      }),
    );
    add(parsed.filter((s): s is Skill => !!s));
  };

  if (editing) {
    return (
      <SkillForm
        skill={editing}
        onCancel={() => setEditing(null)}
        onSave={(s) => {
          setSkills(skills.some((x) => x.id === s.id) ? skills.map((x) => (x.id === s.id ? s : x)) : [...skills, s]);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[13px] text-fg-3">
        技能用通用的 SKILL.md 格式（和 Claude、Codex 的技能一样）。智能体回复时能看到每个技能的名字和用途，需要时读取完整说明再照做。导入整个技能文件夹会找出其中所有的 SKILL.md。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={outline}
          onClick={() =>
            // The desktop app reads the folder itself, so a skill keeps its scripts and reference files.
            isDesktop
              ? void pickFolder()
                  .then((dir) => (dir ? skillsOnDisk(dir).then(add) : undefined))
                  .catch((e: Error) => setStatus({ kind: "error", text: e.message }))
              : folder.current?.click()
          }
        >
          <FolderOpen size={15} /> 导入技能文件夹
        </button>
        <button type="button" className={outline} onClick={() => files.current?.click()}>
          <Upload size={15} /> 导入 SKILL.md
        </button>
        <button type="button" className={outline} onClick={() => setEditing({ id: crypto.randomUUID(), name: "", description: "", body: "", enabled: true })}>
          <Plus size={15} /> 新建
        </button>
      </div>
      <input ref={folder} type="file" hidden multiple {...folderPicker} onChange={(e) => void read(e.target.files, true).finally(() => (e.target.value = ""))} />
      <input ref={files} type="file" hidden multiple accept=".md,text/markdown" onChange={(e) => void read(e.target.files, false).finally(() => (e.target.value = ""))} />
      <StatusBox status={status} />
      {skills.length > 0 ? (
        <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
          {skills.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
                <BookOpen size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.name}</div>
                <div className="line-clamp-2 text-[13px] text-fg-3">{s.description}</div>
              </div>
              <IconButton aria-label="编辑" onClick={() => setEditing(s)}>
                <Pencil size={16} />
              </IconButton>
              <IconButton aria-label="删除" onClick={() => setSkills(skills.filter((x) => x.id !== s.id))}>
                <Trash2 size={16} />
              </IconButton>
              <Switch checked={s.enabled} onChange={(enabled) => setSkills(skills.map((x) => (x.id === s.id ? { ...x, enabled } : x)))} label={`启用 ${s.name}`} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-3">还没有技能</div>
      )}
    </div>
  );
}

export function SkillForm({ skill, onSave, onCancel }: { skill: Skill; onSave: (s: Skill) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(skill);
  const set = (patch: Partial<Skill>) => setDraft((d) => ({ ...d, ...patch }));
  const ok = draft.name.trim() && draft.body.trim();
  return (
    <div className="space-y-4">
      <Field label="名字">
        <input className={inputCls} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="比如 论文润色" />
      </Field>
      <Field label="什么时候用" hint="智能体根据这句话判断要不要用这个技能">
        <textarea className={area} rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label="说明">
        <textarea className={`${area} font-mono text-[13px]`} rows={12} value={draft.body} onChange={(e) => set({ body: e.target.value })} placeholder="按步骤写清楚怎么做" />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={outline} onClick={onCancel}>
          取消
        </button>
        <button type="button" className={solid} disabled={!ok} onClick={() => onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim(), body: draft.body.trim() })}>
          保存
        </button>
      </div>
    </div>
  );
}

// ---------- MCP ----------

const headerText = (h: Record<string, string>) =>
  Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

const parseHeaders = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => /^\s*([^:\s]+)\s*:\s*(.+?)\s*$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );

export function McpSettings() {
  const { mcpServers, setMcpServers } = useData();
  const [editing, setEditing] = useState<McpServer | null>(null);

  if (editing) {
    return (
      <McpForm
        server={editing}
        onCancel={() => setEditing(null)}
        onSave={(s) => {
          setMcpServers(mcpServers.some((x) => x.id === s.id) ? mcpServers.map((x) => (x.id === s.id ? s : x)) : [...mcpServers, s]);
          setEditing(null);
        }}
        onDelete={() => {
          setMcpServers(mcpServers.filter((x) => x.id !== editing.id));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[13px] text-fg-3">
        {isDesktop
          ? "连接远程 MCP 服务（Streamable HTTP）或本机程序（stdio），它们的工具会提供给所有智能体，调用时显示在回复的步骤里。"
          : "连接远程 MCP 服务（Streamable HTTP），它的工具会提供给所有智能体，调用时显示在回复的步骤里。本机的 stdio 服务要在桌面版里用。"}
      </p>
      <button type="button" className={outline} onClick={() => setEditing({ id: crypto.randomUUID(), name: "", url: "", headers: {}, enabled: true })}>
        <Plus size={15} /> 添加 MCP 服务
      </button>
      {mcpServers.length > 0 ? (
        <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
          {mcpServers.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
                <Plug size={17} />
              </span>
              <button type="button" onClick={() => setEditing(s)} className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium">{s.name}</div>
                <div className="truncate font-mono text-[12px] text-fg-3">{s.transport === "stdio" ? `本机：${s.command}` : s.url}</div>
              </button>
              <Switch checked={s.enabled} onChange={(enabled) => setMcpServers(mcpServers.map((x) => (x.id === s.id ? { ...x, enabled } : x)))} label={`启用 ${s.name}`} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-3">还没有 MCP 服务</div>
      )}
    </div>
  );
}

function fallbackName(url: string, command: string) {
  if (command.trim()) return command.trim().split(/\s+/).find((w) => !/^(npx|uvx|-y|node|python|cmd)$/i.test(w))?.split(/[\\/]/).pop() ?? "MCP 服务";
  try {
    return new URL(url).hostname;
  } catch {
    return "MCP 服务";
  }
}

function McpForm({ server, onSave, onCancel, onDelete }: { server: McpServer; onSave: (s: McpServer) => void; onCancel: () => void; onDelete: () => void }) {
  const [name, setName] = useState(server.name);
  const [transport, setTransport] = useState(server.transport ?? "http");
  const [url, setUrl] = useState(server.url);
  const [command, setCommand] = useState(server.command ?? "");
  const [headers, setHeaders] = useState(headerText(server.headers));
  const [status, setStatus] = useState<Status>(null);
  const local = transport === "stdio";
  const draft = (): McpServer => ({
    ...server,
    name: name.trim() || fallbackName(local ? "" : url, local ? command : ""),
    transport,
    url: local ? "" : url.trim(),
    command: local ? command.trim() : undefined,
    headers: local ? {} : parseHeaders(headers),
  });
  const valid = local ? !!command.trim() : /^https?:\/\/\S+$/.test(url.trim());

  const test = async () => {
    setStatus({ kind: "busy", text: "正在连接…" });
    try {
      const tools = await testMcp(draft());
      setStatus({ kind: "ok", text: tools.length ? `连接成功，${tools.length} 个工具：${tools.slice(0, 8).join("、")}${tools.length > 8 ? "…" : ""}` : "连接成功，这个服务没有工具" });
    } catch (e) {
      const err = describeError(e);
      setStatus({ kind: "error", text: err.message, detail: err.detail });
    }
  };

  return (
    <div className="space-y-4">
      <Field label="名字">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 文献检索" />
      </Field>
      {isDesktop && (
        <Field label="连接方式">
          <Segmented
            value={transport}
            onChange={(v) => {
              setTransport(v);
              setStatus(null);
            }}
            options={[
              { value: "http", label: "远程（HTTP）" },
              { value: "stdio", label: "本机程序（stdio）" },
            ]}
          />
        </Field>
      )}
      {local ? (
        <Field label="启动命令" hint="在本机启动服务的命令，第一次用 npx / uvx 时会先下载，需要多等一会儿">
          <input
            className={`${inputCls} font-mono text-sm`}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @modelcontextprotocol/server-filesystem D:\docs"
            spellCheck={false}
          />
        </Field>
      ) : (
        <>
          <Field label="地址" hint="Streamable HTTP 端点，通常以 /mcp 结尾">
            <input className={`${inputCls} font-mono text-sm`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </Field>
          <Field label="请求头（可选）" hint="每行一个，比如 Authorization: Bearer …，保存在本机">
            <textarea className={`${area} font-mono text-[13px]`} rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} />
          </Field>
        </>
      )}
      <StatusBox status={status} />
      <div className="flex flex-wrap items-center gap-2">
        {(server.url || server.command) && (
          <button type="button" onClick={onDelete} className="h-10 rounded-full px-4 text-sm font-medium text-bad hover:bg-bad-soft">
            删除
          </button>
        )}
        <div className="flex-1" />
        <button type="button" className={outline} onClick={onCancel}>
          取消
        </button>
        <button type="button" className={outline} disabled={!valid || status?.kind === "busy"} onClick={test}>
          测试连接
        </button>
        <button type="button" className={solid} disabled={!valid} onClick={() => onSave(draft())}>
          保存
        </button>
      </div>
    </div>
  );
}

// ---------- memory ----------

export function MemorySettings() {
  const { memories, setMemories } = useData();
  const { autoMemory, set } = usePrefs();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const add = () => {
    if (addMemory(draft)) setDraft("");
  };
  const save = (m: Memory, text: string) => {
    const clean = text.trim();
    setMemories(clean ? memories.map((x) => (x.id === m.id ? { ...x, text: clean } : x)) : memories.filter((x) => x.id !== m.id));
    setEditing(null);
  };
  return (
    <div className="space-y-4">
      <p className="px-1 text-[13px] text-fg-3">
        这里的每一条，所有智能体在每次对话里都能看到（比如年级、研究方向、写作习惯）。智能体自己记下的会注明是谁记的；单个智能体专属的记忆在它的资料页 → 记忆。
      </p>
      <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
        <Row title="让智能体自己记" desc={autoMemory ? "聊天中说到关于你的长期信息时，智能体会记下来，回复里显示「记住：…」" : "只用下面你自己写的记忆"}>
          <Switch checked={autoMemory} onChange={(v) => set({ autoMemory: v })} label="让智能体自己记" />
        </Row>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className={`${inputCls} h-10`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="比如：武汉大学大三，研究方向是模型压缩" maxLength={300} />
        <button type="submit" className={solid} disabled={!draft.trim()}>
          添加
        </button>
      </form>
      {memories.length > 0 ? (
        <div className="divide-y divide-line rounded-2xl border border-line bg-raise">
          {[...memories].reverse().map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
                <Bookmark size={16} />
              </span>
              {editing?.id === m.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(m, editing.text);
                  }}
                >
                  <input autoFocus className={`${inputCls} h-9`} value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} maxLength={300} />
                  <IconButton aria-label="保存" type="submit">
                    <Check size={16} />
                  </IconButton>
                  <IconButton aria-label="取消" onClick={() => setEditing(null)}>
                    <X size={16} />
                  </IconButton>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="break-words">{m.text}</div>
                    <div className="text-[12px] text-fg-3">
                      {new Date(m.at).toLocaleDateString("zh-CN")} · {m.by ? `${m.by}记下` : "你写的"}
                    </div>
                  </div>
                  <IconButton aria-label="编辑" onClick={() => setEditing({ id: m.id, text: m.text })}>
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton aria-label="删除" onClick={() => setMemories(memories.filter((x) => x.id !== m.id))}>
                    <Trash2 size={16} />
                  </IconButton>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-3">还没有记忆</div>
      )}
    </div>
  );
}
