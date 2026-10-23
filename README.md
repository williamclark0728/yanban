# 研伴

多智能体协作聊天应用。每个智能体有独立的角色、模型和记忆，可以单独聊，也可以拉进群里：主持人分工，成员产出，审查成员按“成立 / 存疑 / 不成立”提出疑点，按共识规则判定是否退回修订，多轮之后交付，全过程留有记录。

## 功能

- 智能体：名称、头像颜色、角色四要素（职责、能力边界、输入输出、协作方式）、模型、生成参数、私有记忆。
- 私聊：流式回复、思考过程、停止和重试，每个智能体的上下文互相独立。
- 群聊：@ 成员单独回复；不 @ 时由主持人分工，“产出 → 审查 → 共识判定 → 修订”多轮循环。
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

数据（智能体、聊天、协作记录、API Key）只存在当前浏览器的 IndexedDB 中，不上传服务器。浏览器不能直接调用大多数模型接口（跨域限制），请求经 `/api/relay` 转发：转发只处理本站页面发出的请求，只转发 https 地址，拒绝内网地址，也不保存任何内容。开发时由 Vite 插件提供，部署后由 `functions/api/relay.ts` 提供，两者共用 `relay/handler.ts`。`localhost` 和 http 地址（如 Ollama）由浏览器直接访问。

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

## 目录

```
src/
  App.tsx                三栏布局与主题
  store.ts               界面状态与数据（Zustand + IndexedDB）
  types.ts               数据类型
  lib/
    catalog.ts           内置模型服务与协议
    db.ts, seed.ts       本地数据库与首次启动的示例
    llm.ts               模型调用（Vercel AI SDK）、模型列表、错误说明
    chat.ts              上下文组装、流式回复、私聊
    collab.ts            群聊协作：分工、审查、共识、修订、单 Agent 对照、接受率
    files.ts             附件读取（文本、PDF、Word、图片）
    export.ts            协作记录导出
  components/            界面组件
relay/handler.ts         请求转发
relay/trial.ts           体验模型：后端选择、访客限额、Workers AI 输出转换
functions/api/           Cloudflare Pages Function 入口（relay、trial）
scripts/                 文案检查、本机模拟模型服务
```

## 许可证

MIT。`public/pdfjs/` 下的字符映射表和字体来自 pdf.js，许可证见该目录内的 LICENSE 文件。
