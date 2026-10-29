// Agents reading pages in the built-in browser (desktop): sites the user signed into there, like X, 小红书
// and Reddit, can be read with the user's own session. Read only: no clicking, posting or forms.
import { jsonSchema, tool, type ToolSet } from "ai";
import type { Agent } from "../types";
import { activeTab, agentOpen, readTab } from "./browser";
import type { Report } from "./tools";

export const BROWSER_RULES = [
  "你还可以用右侧的内置浏览器：browser_open 打开一个网页并读取正文和链接；browser_read 读取用户当前在内置浏览器里看的页面（用户说“看看我浏览器里这页”时用）。",
  "内置浏览器用的是用户自己的登录状态：X（推特）、小红书、Reddit 等 read_page 读不到的网站，用 browser_open 读。读到的是登录页或验证页时，请用户在右侧浏览器里登录，再让你读；不要自己填账号密码。",
  "动态加载的页面（时间线、搜索结果）把 more 设为 true，会先往下滚动几屏再读。",
  "只读页面：不要替用户点赞、评论、发帖、关注或提交表单。帖子的链接、作者、日期只写页面里真实出现的。",
].join("\n");

const format = (p: { url: string; title: string; text: string; links: string[] }) =>
  [`标题：${p.title || "（无标题）"}`, `网址：${p.url}`, "", p.text || "（页面没有文字）", p.links.length ? `\n页面里的链接（前 ${p.links.length} 个）：\n${p.links.map((l) => `- ${l}`).join("\n")}` : ""].join("\n");

export function browserTools(agent: Agent, report: Report): ToolSet {
  return {
    browser_open: tool({
      description: "在内置浏览器里打开网页并读取（用用户在内置浏览器的登录状态，能读要登录的网站）。返回标题、正文和页面里的链接。",
      inputSchema: jsonSchema<{ url: string; more?: boolean }>({
        type: "object",
        properties: {
          url: { type: "string", description: "完整网址，或要在必应搜索的词" },
          more: { type: "boolean", description: "先往下滚动几屏再读，用于时间线、搜索结果这类动态加载的页面" },
        },
        required: ["url"],
      }),
      execute: async ({ url, more }, { toolCallId }) => {
        const base = { id: toolCallId, name: "browser_open" as const, label: url };
        report({ ...base, status: "running" });
        try {
          const page = await agentOpen(agent.id, agent.name, url, !!more);
          report({ ...base, label: page.url, status: "done", detail: `${page.text.length} 字` });
          return format(page);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          report({ ...base, status: "error", detail: msg });
          return `内置浏览器没能打开：${msg}`;
        }
      },
    }),
    browser_read: tool({
      description: "读取用户当前在内置浏览器里看的页面。",
      inputSchema: jsonSchema<{ more?: boolean }>({
        type: "object",
        properties: { more: { type: "boolean", description: "先往下滚动几屏再读" } },
      }),
      execute: async ({ more }, { toolCallId }) => {
        const tab = activeTab();
        const base = { id: toolCallId, name: "browser_read" as const, label: tab?.url || "内置浏览器" };
        if (!tab?.label) {
          report({ ...base, status: "error", detail: "浏览器里没有打开的页面" });
          return "内置浏览器里没有打开的页面。可以用 browser_open 打开一个，或请用户先在右侧浏览器里打开。";
        }
        report({ ...base, status: "running" });
        try {
          const page = await readTab(tab.key, !!more);
          report({ ...base, label: page.url, status: "done", detail: `${page.text.length} 字` });
          return format(page);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          report({ ...base, status: "error", detail: msg });
          return `读取失败：${msg}`;
        }
      },
    }),
  };
}
