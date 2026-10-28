import { useData } from "../store";
import type { Agent, TextMessage, Unverified } from "../types";
import { call, isDesktop } from "./desktop";
import { webPlan } from "./tools";

/** For every agent with tools: say only what really happened. */
export const HONEST_RULES = [
  "只说你这一步真正做过的事：没有调用工具并拿到成功结果，就不要说已执行、已运行、已生成、已写入、已保存、已打开、已核实。",
  "说文件存在、文件在哪之前，先用 list_dir、search_files 或 run_command 查过；不要编造命令输出、文件大小、修改时间、哈希值。",
  "工作区里新建的文件会自动列在回复下方，make_file 生成的文件会显示成文件卡片，都不用你写链接或“附件”；不要写假的链接。",
  "这次回复没有联网搜索或读网页时，不要列参考文献、论文出处或网址，凭记忆写的出处常常是错的；用户需要出处时，建议打开联网再查。",
  "工具失败、文件没生成、没法做到时如实说，并给出下一步怎么办。不要在回复里手写「<生成的文件>」或贴出文件内容来代替 make_file，那样不会生成文件。",
].join("\n");

/** Claiming an action as done: "已生成", "成功写入", "已执行命令"… */
const DID = /(已|成功|已经)(经)?(执行|运行|调用|生成|写入|保存|存入|存进|创建|打开|调起|重命名|删除|落地|导出)/;
/** Sentences that say where a file is or that it was made. */
const WHERE = /(已|成功|已经|真实|确实|物理)?(生成|保存|写入|存入|存进|创建|导出|存在|位于|落地)|路径/;
const EXT = "xlsx|xls|docx|doc|pptx|ppt|pdf|md|csv|txt|py|json|png|jpg|jpeg|zip|html|tex|ipynb";
/** A full Windows path or a bare file name with a known extension. */
const FILE_RE = new RegExp(`[A-Za-z]:\\\\[^\\s"'“”「」《》<>|*?\`]+?\\.(?:${EXT})\\b|[^\\s"'“”「」『』《》〈〉<>|*?\`\\\\/:：，。；、（）()【】]+\\.(?:${EXT})\\b`, "gi");

/** Saying something did not happen, or quoting an earlier claim: "未找到", "此前声称已生成"… */
const DENIED = /未|没有|没能|并没|不存在|找不到|不在|无法|失败|❌|⚠|声称|此前|之前|刚才|误报|错误/;
/** A plan or a request rather than a report: "将生成", "请主笔生成", "@核查员 检查是否存在"… */
const PLANNED = /将|会|即将|马上|正在|准备|稍后|接下来|下一步|请|让|派|要求|命名为|是否|@/;

/** The sentences that state as fact that something was done. */
function assertions(text: string) {
  return text.split(/[\n。！？!?；;]/).filter((s) => !DENIED.test(s) && !(PLANNED.test(s) && !/已|成功/.test(s)));
}

/** File names said to exist in the reply's own sentences that claim so. */
export function claimedFiles(text: string) {
  const names = new Set<string>();
  for (const line of assertions(text)) {
    if (!WHERE.test(line)) continue;
    for (const m of line.matchAll(FILE_RE)) names.add(m[0].replace(/[*_]+$/, ""));
  }
  return [...names].slice(0, 12);
}

/**
 * Checks a finished reply against what really happened: the tools it called and the files on disk.
 * Only flags; the reply itself stays as written.
 */
export async function verifyReply(messageId: string, agent: Agent) {
  const { messages, patchMessage } = useData.getState();
  const m = messages.find((x): x is TextMessage => x.id === messageId && x.kind === "text");
  if (!m?.text) return;
  const text = m.text.replace(/```[\s\S]*?```/g, " ");
  const found: Unverified = {};
  if (/<生成的文件[\s>]/.test(m.text)) found.fakeFile = true;
  // A lead's summary reports what members did: tools and files from this run's other messages count.
  const lastAsk = messages.findLast((x) => x.chat === m.chat && x.kind === "text" && x.sender === "me" && x.at <= m.at);
  const teamDid = messages.some(
    (x) => x.chat === m.chat && x.id !== m.id && x.kind === "text" && x.at >= (lastAsk?.at ?? 0) && (x.files?.length || x.tools?.some((t) => t.status === "done")),
  );
  if (!m.tools?.length && !teamDid && assertions(text).some((s) => DID.test(s))) found.noTools = true;
  // References without a search: models often make them up. Services that search on their own leave no step, so they are skipped.
  const searched = m.tools?.some((t) => t.sources?.length || t.passages?.length || t.name === "read_page");
  const plan = webPlan(agent);
  if (!searched && plan !== "qwen" && plan !== "zhipu" && /https?:\/\/|参考(文献|资料)|References|et al\./i.test(text)) found.unsourced = true;

  if (isDesktop && agent.workspace) {
    // Files this reply really made, or that the user attached, are known to exist.
    const known = new Set([...(m.files ?? []).map((f) => `${f.name}.${f.format}`), ...(m.outputs?.files ?? []).map((f) => f.path.split("/").pop()!)].map((s) => s.toLowerCase()));
    const names = claimedFiles(text).filter((n) => !known.has(n.split(/[\\/]/).pop()!.toLowerCase()));
    if (names.length) {
      try {
        const there = await call<boolean[]>("ws_exists", { root: agent.workspace, names });
        const missing = names.filter((_, i) => !there[i]);
        if (missing.length) found.missing = missing;
      } catch {
        /* the folder may be gone; nothing to compare with */
      }
    }
  }
  if (found.missing || found.noTools || found.fakeFile || found.unsourced) patchMessage(messageId, { unverified: found }, true);
}

/** One line for the transcript: what the app knows about this message, so the next speaker can't take a claim at face value. */
export function factsLine(m: TextMessage) {
  const parts: string[] = [];
  const steps = (m.tools ?? []).filter((t) => t.status === "done" || t.status === "error");
  if (steps.length) {
    parts.push(
      `调用的工具：${steps
        .map((t) => `${t.name}「${t.label.length > 60 ? `${t.label.slice(0, 60)}…` : t.label}」${t.status === "error" ? "失败" : "成功"}${t.detail ? `（${t.detail}）` : ""}`)
        .join("；")}`,
    );
  }
  if (m.outputs?.files.length) parts.push(`工作区里这次新建或改动的文件：${m.outputs.files.map((f) => f.path).join("、")}`);
  const u = m.unverified;
  if (u?.noTools) parts.push("这条发言说做了操作，但没有调用任何工具，那些操作没有实际发生");
  if (u?.fakeFile) parts.push("里面手写的「生成的文件」不是真文件，没有调用 make_file");
  if (u?.missing?.length) parts.push(`提到的 ${u.missing.join("、")} 在工作区里找不到`);
  if (u?.unsourced) parts.push("这条发言没有联网搜索，列出的参考资料或链接可能不准确");
  return parts.length ? `（系统记录：${parts.join("。")}。）` : "";
}
