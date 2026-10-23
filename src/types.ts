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
};

export type ReviewMessage = Base & { kind: "review"; sender: string; text: string; issues: Issue[]; usage?: Usage; reasoning?: string };

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
