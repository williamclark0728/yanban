# 研伴开发约定

给在本仓库工作的人和 AI 助手看。产品现状、路线图和课程背景记在仓库外的课程资料目录里（`研伴_重构方案与进度.md`）。

## 运行与检查

- `npm run dev` → http://localhost:5180（端口固定，`/api/relay` 由 `vite.config.ts` 里的插件提供）
- 每次改动后依次运行：`npx tsc -b`、`npm run build`、`npm run check:copy`
- 不用真实 Key 的端到端测试：`node scripts/mock-llm.mjs`，在设置里添加自定义服务，Base URL 填 `http://127.0.0.1:5199/v1`。它能扮演主持人（返回分工 JSON）和审查人（第 1 轮报问题，第 2 轮通过）；群聊里说「自我介绍」走各自发言、说「先搜集」走两人流水线；消息含「搜索」时调用 web_search，含「交给群」时调用 dispatch_to_group，含「生成 Word / Excel / PPT」时调用 make_file，含「技能」时调用 use_skill，含「查论文」时调用模拟 MCP 服务（`http://127.0.0.1:5199/mcp`）的 lookup_paper；模型 `mock-plain` 模拟不支持工具。搜索服务选 SearXNG、地址填 `http://127.0.0.1:5199` 即可用模拟搜索
- 线上环境预演：`npm run build && npx wrangler pages dev dist --port 8788`
- 桌面版：需要 Rust（MSVC 工具链）和 VS 生成工具的 C++ 组件。`npm run desktop:dev` 开发，`npm run desktop:build` 打安装包（`src-tauri/target/release/bundle/nsis/`）。Rust 测试：`cargo test --manifest-path src-tauri/Cargo.toml`
- 发布桌面版：先改 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` 里的版本号并提交推送，再 `npm run desktop:release -- "更新说明"`。它用 `~/.tauri/yanban.key`（不在仓库里，丢了就没法给已安装的版本推更新）签名，上传 `Yanban-Windows-x64-setup.exe` 和 `latest.json`；应用内更新读 `releases/latest/download/latest.json`。

## 代码地图

- `src/lib/llm.ts`：按协议创建模型，`streamReply`（流式）和 `completeText`（一次性），模型列表，连接测试，`describeError`（把错误转成一句中文）
- `src/lib/chat.ts`：系统提示（四要素、记忆、当前日期）、上下文组装（附件、图片、群聊记录 `transcript`）、`speak`（流式发言写进消息）、私聊
- `src/lib/collab.ts`：群聊入口 `sendToGroup`、@ 回复、`collaborate`（分工 → 产出 / 修订 → 审查 → `judge` → 交付）、`runBaseline`（单 Agent 对照）、`acceptance`（接受率）；`dispatchTools`（私聊里主持人把任务派到群，等交付后返回结果）。主持人分工提示（`planSystem`，在 chat.ts）分三种（JSON 的 `mode`：work / speak / answer）：实际工作分工、成员各自发言（只产出不审查，主持人只用一两句收尾）、自己回答；主持人回复只是复述用户原话时（`echoes`）改为直接回复一次。产出成员默认并行；分工里的 `after` 指向排在前面的产出成员时，等它完成再开始（流水线），之后的修订轮只由链条末端的成员修订。`@所有人` 让全部成员（含主持人）直接回复
- `src/lib/tools.ts`、`src/lib/search.ts`：`web_search` 和 `read_page` 工具，搜索服务配置在 设置 → 联网搜索。智能体开了联网、而模型自带搜索时（`nativeSearch`，在 llm.ts：通义千问加 `enable_search`，智谱加 `web_search` 工具，Kimi 用 `builtin_function` 的 `$web_search` 原样回传参数，Gemini 3 及以后加 Google Search 并显示来源），直接用模型自带的搜索，不再传这两个工具（`webPlan` / `webAccess`）；DeepSeek 等没有自带搜索的仍用这两个工具；每次工具调用写进消息的 `tools` 字段，界面显示为步骤和来源。工具都在浏览器里执行，网络请求走 `/api/relay`
- `src/lib/templates.ts`、`src/components/Templates.tsx`：团队模板。内置模板的成员取自 `seed.ts`（管家、主笔、核查员、审稿人）加上调研员、策划；按模板建群时同名智能体直接复用；用户的模板存在 kv `templates`。每个模板只放一位产出成员，其余做审查（需要先后顺序时由主持人用 `after` 安排）
- `src/lib/outputs.ts`、`src/lib/filegen.ts`、`src/components/MadeFiles.tsx`：文件产出。每次发言（`speak`）都带 `make_file` 工具，模型只写内容（Markdown 正文 / 工作表 / 每页标题、要点、讲稿），存在消息的 `files` 字段；预览直接渲染这些内容，下载时才按需加载 `filegen.ts`（docx、SheetJS、pptxgenjs）生成真文件，PPT 套用内置版式。生成的文件内容会写进群聊记录，审查成员能看到。任何回复都可以「下载为 Word」
- `src/lib/skills.ts`：技能（通用 SKILL.md 格式，可导入整个技能文件夹，比如 `~/.codex/skills`）。系统提示只列名字和用途，模型用 `use_skill` 读取完整说明
- `src/lib/mcp.ts`：远程 MCP 客户端（Streamable HTTP，自己实现的 initialize / tools/list / tools/call，响应可以是 JSON 或事件流），请求和模型调用一样走 `/api/relay`；启用的服务的工具提供给每次发言。本地 stdio MCP 留给桌面版
- `src/lib/config.ts`、`src/components/Extensions.tsx`：配置导入导出（不含聊天记录；默认不含 Key，导入时文件里为空的 Key 不覆盖本机已存的），以及 设置 → 技能 / MCP 页面
- 桌面版（Tauri 2，`src-tauri/`）：前端完全复用，`src/lib/desktop.ts` 判断是否在桌面里（`isDesktop`）并桥接 Rust。桌面里模型服务、搜索和远程 MCP 都用 HTTP 插件直连（不走 `/api/relay`），不提供本站的体验模型和本站搜索。工作模式：智能体资料里打开「工作模式」选一个文件夹（`Agent.workspace`），每次发言就带上 `src/lib/workmode.ts` 的六个工具（list_dir / read_file / search_files / write_file / edit_file / run_command），工作区的 `AGENTS.md` 写进系统提示当记忆。审批三档在 设置 → 通用（`usePrefs.approval`）；危险命令（`danger()` 的规则）任何档位都要点两次。改文件前在步骤里显示差异（`src/lib/diff.ts`），改完可撤销（旧内容存在步骤的 `undo` 里）。Rust 端（`src-tauri/src/workspace.rs`）所有路径都检查不能出工作区，命令用 PowerShell、有超时；`mcp.rs` 管本机 stdio MCP 进程，JSON-RPC 在前端（`mcp.ts` 的 `StdioSession`）
- `src/lib/files.ts`：附件读取；`src/lib/export.ts`：记录导出
- `src/lib/agentTools.ts`：每次发言都带的 `update_todos`（步骤清单写进消息 `todos`）和 `ask_user`（问题卡片，`useQuestions` 等用户回答）；计划模式 `usePlanMode`（按私聊记，开启时 `readOnly` 只留只看不改的工具，加 `PLAN_RULES`，回复标 `plan`，下方「按计划执行」）；`guard` 包住所有工具：同样参数第 3 次拒绝、网络类工具 90 秒超时（会等用户的工具不计时）、超过 2 万字的结果截头尾（桌面工作模式存到 `.yanban/outputs/`）。群协作的任务看板是 `Run.board`，在 `collaborate` 里随成员开始 / 完成更新，`TaskBoard.tsx` 显示。回复下方的改动汇总和「全部撤销」用 `workmode.ts` 的 `undoAll`
- 输入框（`src/components/Composer.tsx`）：`/` 命令（列表由 `ChatView` 传入；`/clear` 是 `chat.ts` 的 `newTopic`，写一条 `summary + reset` 的空标记消息，之后的上下文从它开始），`$` 技能（作为 `Attachment.skill` 随消息发出），`@` 成员或工作区文件（Rust `ws_files` / `ws_read_bytes`，读出的字节按上传文件解析）。回复进行中：Enter 是插入（`inbox.ts` 的 `useSteer`，私聊的 `speak` 通过 `streamReply` 的 `steer` → AI SDK `prepareStep` 在下一步前把它作为用户消息加进去，记在回复的 `steers` 上；回复没有下一步就结束时 `requeueSteers` 把它放到队首），Ctrl+Enter 是排队（`useQueue`，可编辑、撤回、调整顺序；空闲时由 `queue.ts` 自动发出）。`inbox.ts` 不依赖 chat.ts，避免循环引用。选中回答文字（`[data-reply]`）弹出引用 / 讲解，讲解是 `ExplainPanel.tsx` 的临时对话，不存库、不进主对话上下文，「放回对话」才写进消息
- 0.5.0：`src/lib/memory.ts`：长期记忆（kv `memories`，所有智能体的系统提示都带上；`remember` 工具受设置 → 记忆的 `autoMemory` 控制），`searchMessages` 全文搜聊天记录（左上角搜索和 `search_chats` 工具共用）。`src/lib/compare.ts`：私聊多模型对比（`useCompare`，同一组回答共用 `compare` id，`withoutAlternatives` 让上下文只带选中的那个，界面在 `Compare.tsx`）；回复末尾 `<next>a|b</next>` 由 `splitNext` 拆成消息的 `next` 按钮。「存成技能」是 `skills.ts` 的 `draftSkill` + `SaveSkill.tsx`。团队模板和群的 `guide` 写进主持人分工提示；分工的 `after` 可以写多个名字（深度调研组：两位检索员并行，撰写人等两人都完成）。桌面版用 `tauri-plugin-single-instance`，再次启动只把已有窗口切到前台
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
