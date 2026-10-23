export type AgentColor = "violet" | "amber" | "teal" | "orange" | "rose" | "sky" | "snow";

export interface RoleCard {
  duty: string;     // 职责定位
  scope: string;    // 能力边界
  io: string;       // 输入输出
  protocol: string; // 协作协议
}

export interface ModelParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  history: number; // how many past messages go into the context
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
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  leadId: string;
  maxRounds: number;
  consensus: "strict" | "relaxed";
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
  kind?: "text" | "pdf" | "docx" | "image";
  mime?: string;
  text?: string; // extracted text, line- or page-numbered
  image?: string; // base64 without the data: prefix
  pages?: number;
  truncated?: boolean;
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
};

export interface Source {
  title: string;
  url: string;
  site?: string;
  date?: string;
}

export interface ToolTrace {
  id: string;
  name: "web_search" | "read_page" | "dispatch_to_group";
  /** One line for the UI, e.g. the search query or the group name. */
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  sources?: Source[];
  /** Citation number of the first source; later ones count up from it. */
  first?: number;
  /** The group a dispatch went to. */
  groupId?: string;
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
