# 研伴开发约定

给在本仓库工作的人和 AI 助手看。产品现状、路线图和课程背景记在仓库外的课程资料目录里（`研伴_重构方案与进度.md`）。

## 运行与检查

- `npm run dev` → http://localhost:5180（端口固定，`/api/relay` 由 `vite.config.ts` 里的插件提供）
- 每次改动后依次运行：`npx tsc -b`、`npm run build`、`npm run check:copy`
- 不用真实 Key 的端到端测试：`node scripts/mock-llm.mjs`，在设置里添加自定义服务，Base URL 填 `http://127.0.0.1:5199/v1`。它能扮演主持人（返回分工 JSON）和审查人（第 1 轮报问题，第 2 轮通过）
- 线上环境预演：`npm run build && npx wrangler pages dev dist --port 8788`

## 代码地图

- `src/lib/llm.ts`：按协议创建模型，`streamReply`（流式）和 `completeText`（一次性），模型列表，连接测试，`describeError`（把错误转成一句中文）
- `src/lib/chat.ts`：系统提示（四要素、记忆、当前日期）、上下文组装（附件、图片、群聊记录 `transcript`）、`speak`（流式发言写进消息）、私聊
- `src/lib/collab.ts`：群聊入口 `sendToGroup`、@ 回复、`collaborate`（分工 → 产出 / 修订 → 审查 → `judge` → 交付）、`runBaseline`（单 Agent 对照）、`acceptance`（接受率）
- `src/lib/files.ts`：附件读取；`src/lib/export.ts`：记录导出
- `src/store.ts`：Zustand store，所有写操作都同步写入 IndexedDB；`resolveModel` 决定每个智能体实际用哪个模型
- `relay/handler.ts`：开发环境和 Cloudflare 共用的转发逻辑

## 约定

- 界面文案只写操作、结果、状态。不写免责声明式的话（“仅代表”“不等于”“仅供参考”等），`check:copy` 会拦截。
- 不在代码、测试数据、文档里出现真实 API Key。Key 只存在用户浏览器的 IndexedDB 里。
- 新功能先考虑能不能在三个平台都用：网页版和安卓版只有聊天模式，本地文件和命令只能放在 Windows 桌面版的工作模式里。
- 模型返回 JSON 的地方（分工、审查）都要能容错：去掉代码块和 `<think>`，读不出来时按最保守的方式处理（审查读不出来记为存疑，不算通过）。
- 群聊上下文从本次任务的用户消息开始完整保留（`sinceId`），之前的只带最近 N 条。
- 提交信息用中文，说明改了什么。
