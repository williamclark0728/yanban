export type AgentColor = "violet" | "amber" | "teal" | "orange" | "rose" | "sky" | "snow";

export interface RoleCard {
  duty: string;     // 职责定位
  scope: string;    // 能力边界
  io: string;       // 输入输出
  protocol: string; // 协作协议
}

/** How hard the model thinks before answering; "auto" leaves it to the service. */
export type Effort = "auto" | "off" | "low" | "medium" | "high" | "max";

export interface ModelParams {
  temperature: number;
  topP: number;
  /** Longest reply in tokens; 0 means no limit of our own (the service's maximum). */
  maxTokens: number;
  history: number; // how many past messages go into the context
  effort?: Effort;
}

export interface ModelRef {
  provider: string;
  id: string;
}

export interface Agent {
  id: string;
  name: string;
  color: AgentColor;
  look: number; // eye direction, -1..1
  tagline: string;
  role: RoleCard;
  model: ModelRef | null; // null follows the default model
  params: ModelParams;
  memory: string[];
  /** May search the web and read pages. */
  web?: boolean;
  /** Desktop work mode: the folder this agent can read, change and run commands in. */
  workspace?: string;
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  leadId: string;
  maxRounds: number;
  consensus: "strict" | "relaxed";
  /** Desktop work mode for the whole group: every member works in this folder. */
  workspace?: string;
  /** How this group works, from its template; the lead plans by it. */
  guide?: string;
}

export type ChatRef = { kind: "agent" | "group"; id: string };

/** One member of a team template: an agent's settings, without its id. */
export interface TemplateMember {
  key: string;
  name: string;
  color: AgentColor;
  look: number;
  tagline: string;
  role: RoleCard;
  params?: Partial<ModelParams>;
  model?: ModelRef | null;
  memory?: string[];
  web?: boolean;
}

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  members: TemplateMember[];
  leadKey: string;
  maxRounds: number;
  consensus: Group["consensus"];
  /** How the team works, handed to the lead when it plans. */
  guide?: string;
  /** Built-in templates ship with the app and cannot be edited. */
  builtIn?: boolean;
  createdAt?: number;
}

export type IssueStatus = "holds" | "rejected" | "unsure";

export interface Issue {
  text: string;
  status: IssueStatus;
  evidence?: string; // where the reviewer found it, e.g. "experiment.md 第 12 行"
}

export interface Usage {
  model: string;
  input: number;
  output: number;
  seconds: number;
}

export interface Attachment {
  id?: string;
  name: string;
  size: number | string; // bytes; older example data stores a label
  kind?: "text" | "pdf" | "docx" | "image" | "sheet" | "slides" | "zip";
  mime?: string;
  text?: string; // extracted text, line- or page-numbered
  image?: string; // base64 without the data: prefix
  pages?: number;
  truncated?: boolean;
  /** A skill the user picked with `$`: its instructions, sent along with the message. */
  skill?: boolean;
}

interface Base {
  id: string;
  chat: string;
  at: number;
}

export type TextMessage = Base & {
  kind: "text";
  sender: string;
  text: string;
  reasoning?: string;
  status?: "streaming" | "error" | "stopped";
  error?: { message: string; detail?: string };
  usage?: Usage;
  attachments?: Attachment[];
  /** Tools the agent used while writing this reply, in order. */
  tools?: ToolTrace[];
  /** Set on a task the lead brought over from a private chat: that lead's id. */
  via?: string;
  /** Files the agent made with make_file. */
  files?: MadeFile[];
  /** A summary of the chat before it; replies see this instead of the older messages. */
  summary?: boolean;
  /** With `summary`: a new topic (/clear). Replies see nothing before it, and the text is empty. */
  reset?: boolean;
  /** The agent's step list for this reply (update_todos). */
  todos?: Todo[];
  /** Written in plan mode: a plan the user can approve with one click. */
  plan?: boolean;
  /** What the user inserted (Enter) while this reply was running; the model read it before its next step. */
  steers?: string[];
  /** Replies to the same question from several models, shown side by side; they share this id. */
  compare?: string;
  /** In a comparison: the model that wrote this one, and whether the user picked it to carry on. */
  model?: string;
  chosen?: boolean;
  /** Desktop work mode: files in the workspace this reply created or changed, including ones its commands wrote. */
  outputs?: { root: string; files: { path: string; size: number }[] };
  /** What the reply claims that the app could not confirm (lib/verify.ts). */
  unverified?: Unverified;
  /** The reasoning translated into Chinese, when the model thought in English. */
  reasoningZh?: string;
  /** What the user will likely want next, offered as buttons under the reply. */
  next?: string[];
};

/** Something about the user every agent keeps in mind, across chats. */
export interface Memory {
  id: string;
  text: string;
  at: number;
  /** The agent that saved it; empty when the user wrote it. */
  by?: string;
}

export interface Todo {
  text: string;
  status: "pending" | "in_progress" | "done";
}

export type FileFormat = "md" | "docx" | "xlsx" | "pptx";

export interface Sheet {
  name: string;
  rows: (string | number)[][];
}

export interface Slide {
  title: string;
  bullets: string[];
  notes?: string;
}

/** A document an agent wrote; the file itself is built in the browser when it is downloaded. */
export interface MadeFile {
  id: string;
  format: FileFormat;
  /** File name without the extension. */
  name: string;
  /** md and docx */
  markdown?: string;
  /** xlsx */
  sheets?: Sheet[];
  /** pptx: the cover, then one entry per slide. */
  title?: string;
  subtitle?: string;
  slides?: Slide[];
  /** Desktop work mode: where the file was saved in the workspace. */
  saved?: string;
}

export interface Source {
  title: string;
  url: string;
  site?: string;
  date?: string;
}

export interface ToolTrace {
  id: string;
  name: "web_search" | "read_page" | "dispatch_to_group" | "make_file" | "use_skill" | "install_skill" | "mcp" | "ask_user" | "remember" | "search_chats" | "search_library" | "delegate" | "schedule_task" | "edit_doc" | LocalTool;
  /** One line for the UI, e.g. the search query or the group name. */
  label: string;
  /** "waiting": a local action waits for the user's approval. */
  status: "running" | "waiting" | "done" | "error";
  /** What the user is asked to approve; `review` is why smart approval passed it on to the user. */
  ask?: { what: string; diff?: DiffLine[]; danger?: string; review?: string };
  /** Smart approval let this through without asking; the reviewer's reason. */
  auto?: string;
  /** Desktop work mode: the workspace a file step happened in, so the file can be previewed. */
  root?: string;
  /** How to undo a file change: the file's earlier content, or null when the change created it. */
  undo?: { root: string; path: string; before: string | null; undone?: boolean };
  detail?: string;
  sources?: Source[];
  /** Citation number of the first source; later ones count up from it. */
  first?: number;
  /** The group a dispatch went to. */
  groupId?: string;
  /** ask_user: the question, its suggested answers, and what the user said. */
  question?: { text: string; options: string[] };
  answer?: string;
  /** search_library: the passages found, with where each came from. */
  passages?: { title: string; text: string }[];
  /** delegate: what the sub-agent handed back. */
  output?: string;
}

/** A folder of papers and notes the agents can search (search_library). The text lives in the chunks table. */
export interface Library {
  id: string;
  name: string;
  enabled: boolean;
  docs: LibraryDoc[];
  at: number;
}

export interface LibraryDoc {
  id: string;
  name: string;
  size: number;
  chars: number;
  chunks: number;
  at: number;
}

/** One passage of a library document, about a paragraph or two, with its page or line range. */
export interface Chunk {
  id: string;
  lib: string;
  doc: string;
  name: string;
  loc: string;
  text: string;
}

/** A skill in the common SKILL.md format: when to use it (description) and the instructions (body). */
export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  /** Desktop: the folder the skill came from, with its scripts and reference files. */
  dir?: string;
}

/** An MCP server: remote over Streamable HTTP, or (desktop only) a local process over stdio. Its tools are offered to every agent. */
export interface McpServer {
  id: string;
  name: string;
  transport?: "http" | "stdio";
  url: string;
  /** stdio: the command line that starts the server, e.g. `npx -y @modelcontextprotocol/server-filesystem D:\docs`. */
  command?: string;
  /** Extra request headers, e.g. Authorization. Kept in this browser like provider keys. */
  headers: Record<string, string>;
  enabled: boolean;
}

export type LocalTool = "list_dir" | "read_file" | "search_files" | "write_file" | "edit_file" | "run_command" | "start_job" | "job_output" | "stop_job";

/** A message sent to an agent at set times (Settings → 定时任务). */
export interface Schedule {
  id: string;
  agentId: string;
  prompt: string;
  /** "HH:MM", local time. */
  time: string;
  repeat: "daily" | "weekdays" | "once";
  /** For "once": the day, "YYYY-MM-DD". */
  date?: string;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
}

/** A draft the user and the agent write together, one per chat, in the side panel. */
export interface Doc {
  chat: string;
  title: string;
  text: string;
  updatedAt: number;
}

/** One line of a change preview; "gap" stands for unchanged lines left out. */
export interface DiffLine {
  type: "same" | "add" | "del" | "gap";
  text: string;
}

export type SearchProvider = "bocha" | "tavily" | "searxng";

export interface SearchConfig {
  provider: SearchProvider;
  keys: Partial<Record<SearchProvider, string>>;
  /** Base URL of a self-hosted SearXNG instance. */
  searxngUrl?: string;
  /** Optional Jina key for reading pages; without one Jina allows a lower rate. */
  jinaKey?: string;
}

export type ReviewMessage = Base & { kind: "review"; sender: string; text: string; issues: Issue[]; usage?: Usage; reasoning?: string; tools?: ToolTrace[] };

export type Verdict = "revise" | "pass" | "stop" | "done";

export type RoundMessage = Base & { kind: "round"; runId: string; round: number; verdict: Verdict; note: string };

export type Message = TextMessage | ReviewMessage | RoundMessage;

export type StepType = "plan" | "draft" | "check" | "review" | "revise" | "summary";

export interface RunStep {
  agentId: string;
  type: StepType;
  summary: string;
  issues?: Issue[];
  tokens: number;
  failed?: boolean;
  messageId?: string; // the chat message holding the full text
}

export interface RunRound {
  index: number;
  steps: RunStep[];
  verdict?: Verdict;
  note?: string;
}

/** The same task done by one agent, reviewed by the same reviewers, for comparison. */
export interface Baseline {
  status: "running" | "done" | "failed";
  agentId: string;
  model?: string;
  text?: string;
  tokens: number;
  seconds: number;
  error?: string;
  reviews: { agentId: string; summary: string; issues: Issue[]; tokens: number; failed?: boolean }[];
}

export interface Run {
  id: string;
  groupId: string;
  task: string;
  status: "running" | "done" | "stopped" | "failed";
  rounds: RunRound[];
  startedAt: number;
  endedAt?: number;
  tokens: number;
  messageId?: string; // the user's message that started the run
  consensus?: Group["consensus"];
  maxRounds?: number;
  baseline?: Baseline;
  /** Who is doing what in this run, shown above the composer while it runs. */
  board?: BoardItem[];
}

export interface BoardItem {
  agentId: string;
  task: string;
  type: "produce" | "review" | "summary";
  status: "waiting" | "working" | "done" | "failed";
  /** e.g. "第 2 轮修订" */
  note?: string;
}

export type Protocol = "openai-chat" | "openai-responses" | "anthropic" | "gemini";

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  custom: boolean;
  keyless?: boolean;
  keyUrl?: string;
}

/** What a reply says it did that the app could not confirm; shown under the reply and in the group transcript. */
export interface Unverified {
  /** Files it says it made or saved that aren't there. */
  missing?: string[];
  /** It says it ran, wrote or opened something, but called no tool in this step. */
  noTools?: boolean;
  /** It wrote out a <生成的文件> block by hand, which makes no file. */
  fakeFile?: boolean;
}
