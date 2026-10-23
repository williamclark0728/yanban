# 研伴

> 你只管提需求，一支 AI 团队替你分工、干活、互相挑错，最后交给你一份核对过的结果。

**👉 一键体验：[yanban.shengzy.top](https://yanban.shengzy.top)**　打开就能用，不用注册，不填 Key 也能先聊

还在担心 AI 没听懂你的意思，答非所问？
还在担心 AI 一本正经地编数字、造引用？
还在把同一个问题复制到好几个 AI 里，自己来回核对？

把这些交给研伴吧。研伴把多个 AI 模型组织成一个团队：你像老板一样把任务交给**管家**，管家会拆分任务，派给主笔、核查员、审稿人。写稿的写稿，核对的核对，审稿人把每个疑点标成「成立 / 存疑 / 不成立」并写明依据。审核不通过就退回重写，通过了才交到你手里。需求、分工、审核、交付连成一个闭环，每一步都有记录可查。

## 它怎么干活

```
你 ──任务──▶ 管家 ──分工──▶ 主笔：写稿
                          ├──▶ 核查员：对照原文核数字
                          └──▶ 审稿人：挑逻辑和措辞
                 ◀── 疑点 ──┘  不通过就退回修订（最多 N 轮）
你 ◀──交付── 管家汇总：最终稿和各方结论
```

## 亮点

- 🧑‍💼 **一支 AI 团队，不只是一个聊天框**：每个智能体有自己的角色、模型和记忆，上下文互不干扰。可以单独私聊，也可以拉进群里一起协作。
- 🔍 **专人审核，疑点有据**：审查意见一条一条列出来，每条都标明成立、存疑还是不成立，并附上原文出处。共识规则有严格和宽松两种，自己选。
- 🔁 **多轮修订，过程透明**：每一轮谁做了什么、发现了什么问题、怎么改的，全都留有记录，可以导出成 Markdown 或 JSON。
- ⚖️ **和单个 AI 比一比**：同一个任务一键交给单个 AI 再做一遍，用同样的标准审查，团队和单个 AI 的差别一目了然。
- 🌐 **能上网查资料**：打开联网搜索的智能体会自己搜网页、读原文，回答里用 [1][2] 标注来源，点一下就能打开原网页。
- 📨 **私聊管家也能派活**：在私聊里跟管家说一声，它会把任务交给群里协作，等审核通过后回来向你汇报。
- 📎 **直接丢文件**：PDF（包括中文论文）、Word、图片、文本，拖进来、粘贴进来都行。
- 🔌 **模型随你挑**：内置 DeepSeek、通义千问、Kimi、智谱、豆包、硅基流动、OpenAI、Claude、Gemini、OpenRouter 等，也能接入任何自定义 API。每个智能体可以用不同的模型。
- 🎚️ **新手和爱折腾的都照顾到**：简洁模式开箱即用；开发者模式可以调参数，看 Token 用量、耗时和审核通过率。
- 🔒 **数据留在你自己手里**：聊天记录和 API Key 只存在你自己的浏览器里，不会上传到服务器。

## 三步上手

1. 打开 [yanban.shengzy.top](https://yanban.shengzy.top)
2. 先用内置的体验模型直接聊（每天 30 次）；想长期用，就在 设置 → 模型服务 里填一个自己的 API Key
3. 进「论文写作组」，把任务交给管家，然后看它们干活

## 接下来

- 🧩 团队模板：论文写作、资料调研、写作、PPT 制作，也能把自己搭好的团队存成模板
- 📄 直接生成 Word、Excel、PPT
- 💻 Windows 桌面版「工作模式」：在本地读写文件、写代码，权限分三档审批
- 📱 安卓版
- 🧰 MCP 与 Skills 扩展

**开源、免费（MIT 协议）**。欢迎 Star、提 Issue，一起把它做得更好用。

---

## 功能清单

- 智能体：名称、头像颜色、角色四要素（职责、能力边界、输入输出、协作方式）、模型、生成参数、私有记忆。
- 私聊：流式回复、思考过程、停止和重试，每个智能体的上下文互相独立。群的主持人在私聊里可以把任务派到群里，等群里交付后汇报结果。
- 群聊：@ 成员单独回复；不 @ 时由主持人分工，“产出 → 审查 → 共识判定 → 修订”多轮循环。
- 联网搜索：给智能体打开「联网搜索」即可用本站提供的搜索（每天限次）；在 设置 → 联网搜索 里连接自己的博查、Tavily 或自建 SearXNG 后不限次。读网页全文用 Jina Reader。回答里的 [n] 链接到对应来源。模型不支持工具调用时自动改为直接回答。
- 共识规则：严格（成立和存疑都要解决）或宽松（没有成立的疑点即通过），记录里可以对比两种规则的接受率。
- 协作记录：逐轮留痕，单 Agent 对照（同一任务单独完成，再用同样的标准审查），导出 Markdown 或 JSON。
- 文件：文本、PDF（含中文）、Word、图片，可以选择文件、拖放或粘贴。
- 模型服务：内置 DeepSeek、通义百炼、Kimi、智谱、豆包、硅基流动、OpenAI、Anthropic、Gemini、OpenRouter、NVIDIA、Ollama，也可以添加自定义服务。支持 OpenAI Chat、OpenAI Responses、Anthropic Messages、Gemini 四种协议。
- 简洁模式和开发者模式（参数、Token、耗时、接受率）；深色、浅色或跟随系统；适配手机宽度。

## 运行

```bash
npm install
npm run dev
```

打开 http://localhost:5180 ，在 设置 → 模型服务 里填入任一服务的 API Key。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查并打包到 `dist/` |
| `npm run check:copy` | 检查界面文案里的免责声明式措辞 |
| `npx wrangler pages dev dist` | 在本机按 Cloudflare Pages 的方式运行打包结果（含 `/api/relay`） |
| `node scripts/mock-llm.mjs` | 本机模拟模型服务，Base URL 填 `http://127.0.0.1:5199/v1`，会扮演主持人和审查人 |

## 数据与密钥

数据（智能体、聊天、协作记录、模型和搜索服务的 API Key）只存在当前浏览器的 IndexedDB 中，不上传服务器。浏览器不能直接调用大多数模型接口（跨域限制），请求经 `/api/relay` 转发：转发只处理本站页面发出的请求，只转发 https 地址，拒绝内网地址，也不保存任何内容。开发时由 Vite 插件提供，部署后由 `functions/api/relay.ts` 提供，两者共用 `relay/handler.ts`。`localhost` 和 http 地址（如 Ollama）由浏览器直接访问。

## 部署到 Cloudflare Pages

在 Cloudflare 控制台 → Workers & Pages → 创建 → Pages → 连接 GitHub 仓库：

| 设置 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| Node 版本 | 由仓库里的 `.node-version` 指定（22），不用另设 |

`functions/` 目录会自动部署为 Pages Functions。部署完成后在“自定义域”里绑定域名。

### 体验模型（可选）

让新用户不填 Key 也能先聊几句。接口是 `/api/trial`（`relay/trial.ts`），对前端表现为一个 OpenAI Chat 兼容的服务；每个访客每天限定次数，按 IP 哈希计数，不保存原始 IP。在 Pages 项目的 设置 → 绑定 / 变量和机密 里配置：

| 名称 | 类型 | 作用 |
| --- | --- | --- |
| `DB` | D1 数据库 | 记录每个访客当天的次数，**必需**（没有它体验模型不开启） |
| `AI` | Workers AI | 用 Cloudflare 账号的免费额度调用模型，不需要 Key |
| `TRIAL_API_KEY` | 密钥 | 可选。填了就优先用这个服务（默认智谱 GLM-4.7-Flash），失败时退回 Workers AI |
| `TRIAL_BASE_URL`、`TRIAL_MODEL` | 文本 | 可选，换成别的 OpenAI 兼容服务和模型 |
| `TRIAL_AI_MODEL` | 文本 | 可选，Workers AI 模型，默认 `@cf/qwen/qwen3-30b-a3b-fp8` |
| `TRIAL_DAILY` | 文本 | 可选，每个访客每天的次数，默认 30 |

改完绑定或变量后要重新部署一次才生效。用户连接了自己的模型服务后，智能体会自动改用它。

本机调试：在 `.env.local` 里写 `TRIAL_API_KEY=mock`、`TRIAL_BASE_URL=http://127.0.0.1:5199/v1`、`TRIAL_MODEL=mock-chat`，再运行 `node scripts/mock-llm.mjs` 和 `npm run dev`。

### 本站联网搜索（可选）

让没连接搜索服务的用户也能联网。接口是 `/api/search`（`relay/search.ts`），用站长的 Tavily Key 搜索，Key 只在服务器上。和体验模型共用 `DB` 计数，每个访客每天限次，全站每天也有总数上限，免费额度不会几天就用完。

| 名称 | 类型 | 作用 |
| --- | --- | --- |
| `SEARCH_TAVILY_KEY` | 密钥 | Tavily 的 API Key，**必需** |
| `SEARCH_DAILY` | 文本 | 可选，每个访客每天的搜索次数，默认 10 |
| `SEARCH_SITE_DAILY` | 文本 | 可选，全站每天的搜索总数，默认 50（Tavily 免费版每月 1000 次） |

用户在 设置 → 联网搜索 里连接了自己的服务后，自动改用自己的。本机调试：`.env.local` 里写 `SEARCH_TAVILY_KEY=mock`、`SEARCH_TAVILY_URL=http://127.0.0.1:5199/tavily/search`。

## 目录

```
src/
  App.tsx                三栏布局与主题
  store.ts               界面状态与数据（Zustand + IndexedDB）
  types.ts               数据类型
  lib/
    catalog.ts           内置模型服务与协议
    db.ts, seed.ts       本地数据库与首次启动的示例
    llm.ts               模型调用（Vercel AI SDK）、工具调用与不支持时的退回、模型列表、错误说明
    chat.ts              上下文组装、流式回复、私聊
    collab.ts            群聊协作：分工、审查、共识、修订、单 Agent 对照、接受率；主持人从私聊派单
    tools.ts, search.ts  联网搜索与读网页工具（博查、Tavily、SearXNG、Jina Reader）、工具步骤记录
    files.ts             附件读取（文本、PDF、Word、图片）
    export.ts            协作记录导出
  components/            界面组件
relay/handler.ts         请求转发
relay/trial.ts           体验模型：后端选择、访客限额、Workers AI 输出转换
relay/search.ts          本站联网搜索：Tavily、访客和全站每日限次
functions/api/           Cloudflare Pages Function 入口（relay、trial、search）
scripts/                 文案检查、本机模拟模型服务
```

## 许可证

MIT。`public/pdfjs/` 下的字符映射表和字体来自 pdf.js，许可证见该目录内的 LICENSE 文件。
