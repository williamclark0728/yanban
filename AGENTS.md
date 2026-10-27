# 研伴开发约定

给在本仓库工作的人和 AI 助手看。产品现状、路线图和课程背景记在仓库外的课程资料目录里（`研伴_重构方案与进度.md`）。

## 运行与检查

- `npm run dev` → http://localhost:5180（端口固定，`/api/relay` 由 `vite.config.ts` 里的插件提供）
- 每次改动后依次运行：`npx tsc -b`、`npm run build`、`npm run check:copy`
- 不用真实 Key 的端到端测试：`node scripts/mock-llm.mjs`，在设置里添加自定义服务，Base URL 填 `http://127.0.0.1:5199/v1`。它能扮演主持人（返回分工 JSON）和审查人（第 1 轮报问题，第 2 轮通过）；群聊里说「自我介绍」走各自发言、说「先搜集」走两人流水线；消息含「搜索」时调用 web_search，含「交给群」时调用 dispatch_to_group，含「生成 Word / Excel / PPT」时调用 make_file；模型 `mock-plain` 模拟不支持工具。搜索服务选 SearXNG、地址填 `http://127.0.0.1:5199` 即可用模拟搜索
- 线上环境预演：`npm run build && npx wrangler pages dev dist --port 8788`

## 代码地图

- `src/lib/llm.ts`：按协议创建模型，`streamReply`（流式）和 `completeText`（一次性），模型列表，连接测试，`describeError`（把错误转成一句中文）
- `src/lib/chat.ts`：系统提示（四要素、记忆、当前日期）、上下文组装（附件、图片、群聊记录 `transcript`）、`speak`（流式发言写进消息）、私聊
- `src/lib/collab.ts`：群聊入口 `sendToGroup`、@ 回复、`collaborate`（分工 → 产出 / 修订 → 审查 → `judge` → 交付）、`runBaseline`（单 Agent 对照）、`acceptance`（接受率）；`dispatchTools`（私聊里主持人把任务派到群，等交付后返回结果）。主持人分工提示（`planSystem`，在 chat.ts）分三种（JSON 的 `mode`：work / speak / answer）：实际工作分工、成员各自发言（只产出不审查，主持人只用一两句收尾）、自己回答；主持人回复只是复述用户原话时（`echoes`）改为直接回复一次。产出成员默认并行；分工里的 `after` 指向排在前面的产出成员时，等它完成再开始（流水线），之后的修订轮只由链条末端的成员修订。`@所有人` 让全部成员（含主持人）直接回复
- `src/lib/tools.ts`、`src/lib/search.ts`：`web_search` 和 `read_page` 工具，搜索服务配置在 设置 → 联网搜索；每次工具调用写进消息的 `tools` 字段，界面显示为步骤和来源。工具都在浏览器里执行，网络请求走 `/api/relay`
- `src/lib/templates.ts`、`src/components/Templates.tsx`：团队模板。内置模板的成员取自 `seed.ts`（管家、主笔、核查员、审稿人）加上调研员、策划；按模板建群时同名智能体直接复用；用户的模板存在 kv `templates`。每个模板只放一位产出成员，其余做审查（需要先后顺序时由主持人用 `after` 安排）
- `src/lib/outputs.ts`、`src/lib/filegen.ts`、`src/components/MadeFiles.tsx`：文件产出。每次发言（`speak`）都带 `make_file` 工具，模型只写内容（Markdown 正文 / 工作表 / 每页标题、要点、讲稿），存在消息的 `files` 字段；预览直接渲染这些内容，下载时才按需加载 `filegen.ts`（docx、SheetJS、pptxgenjs）生成真文件，PPT 套用内置版式。生成的文件内容会写进群聊记录，审查成员能看到。任何回复都可以「下载为 Word」
- `src/lib/files.ts`：附件读取；`src/lib/export.ts`：记录导出
- `src/store.ts`：Zustand store，所有写操作都同步写入 IndexedDB；`resolveModel` 决定每个智能体实际用哪个模型
- `relay/handler.ts`：开发环境和 Cloudflare 共用的转发逻辑
- `relay/trial.ts`：体验模型（`/api/trial`）。服务器端持有额度，按访客每天限次；前端把它当成 id 为 `trial` 的服务，排在用户自己的服务之后，不存进数据库
- `relay/search.ts`：本站联网搜索（`/api/search`），用站长的 Tavily Key，访客和全站每天限次，和体验模型共用 D1 计数表（访客哈希加了用途前缀，互不影响）；用户自己的搜索服务配好后前端不再调用它

## 约定

- 界面文案只写操作、结果、状态。不写免责声明式的话（“仅代表”“不等于”“仅供参考”等），`check:copy` 会拦截。
- 不在代码、测试数据、文档里出现真实 API Key。用户的 Key 只存在其浏览器的 IndexedDB 里；体验模型的 Key 只放在 Cloudflare 的机密变量里，不下发到浏览器。
- 新功能先考虑能不能在三个平台都用：网页版和安卓版只有聊天模式，本地文件和命令只能放在 Windows 桌面版的工作模式里。
- 模型返回 JSON 的地方（分工、审查）都要能容错：去掉代码块和 `<think>`，读不出来时按最保守的方式处理（审查读不出来记为存疑，不算通过）。
- 群聊上下文从本次任务的用户消息开始完整保留（`sinceId`），之前的只带最近 N 条。
- 提交信息用中文，说明改了什么。不加 `Co-Authored-By` 等协作者署名，作者是否署名由用户自己决定。提交作者用本机 git 的全局身份（williamclark0728 的 noreply 邮箱），不要改。
