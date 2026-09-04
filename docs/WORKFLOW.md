# LinguaGacha 工作流

本文只提供项目阅读路径与验证范围；始终适用的行动规则归 [`AGENTS.md`](../AGENTS.md)，长期文档治理归 [`project-doc` 技能](../.codex/skills/project-doc/SKILL.md)。专题正文不写在这里。

## 1. 阅读路径

|任务类型|必读|补读|
|---|---|---|
|架构、进程边界、跨层依赖|[`ARCHITECTURE.md`](ARCHITECTURE.md)|`src/index.ts`、`src/backend/bootstrap/`、相关入口测试|
|CLI 命令、输出、临时工程、平台启动器|[`CLI.md`](CLI.md)|`src/cli/`、`buildtools/builder/`、CLI / index 测试|
|API、SSE、错误、项目读写|[`BACKEND.md`](BACKEND.md)|`src/backend/api/`、`src/backend/project/`、`src/backend/cache/`、`src/shared/error/`|
|数据库、`.lg`、migration、asset、NativeFs|[`BACKEND.md`](BACKEND.md)|`src/backend/database/`、`src/backend/migration/`、`src/native/`|
|任务、worker、共享 LLM、系统代理网络|[`BACKEND.md`](BACKEND.md)|`src/backend/engine/`、`src/backend/worker/`、`src/backend/llm/`、`src/backend/network/`|
|产品 Agent 会话、资源、skill、工具、宿主能力、页面消费|[`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)|`src/backend/agent/`、`src/shared/agent.ts`、`src/shared/backend-runtime.ts`、`src/frontend/app/session/agent/`、`src/frontend/pages/agent-page/`、`builtin/agent/`|
|Electron / preload / renderer 接入|[`FRONTEND.md`](FRONTEND.md)|`src/gui/`、`src/frontend/app/desktop/`|
|前端共享状态、跨页面 feature、页面 query、导航、session UI|[`FRONTEND.md`](FRONTEND.md)|`src/frontend/app/state/`、`src/frontend/app/session/`、`src/frontend/features/`、`src/frontend/pages/`|
|前端文案、样式消费、视觉|[`FRONTEND.md`](FRONTEND.md)|当前任务设计输入、既有界面证据、`src/frontend/index.css`、相关组件 / 页面 CSS|
|长期文档治理|[`project-doc` 技能](../.codex/skills/project-doc/SKILL.md)|`docs/`、README / 脚本 / 测试中的文档引用|

## 2. 验证矩阵

代码、测试、构建配置或脚本有改动时先执行代码基线；需要运行 `npm run build` 时，其内部已经包含 typecheck，不再单独重复执行 `npx tsc`：

```bash
npx tsc -b --noEmit
npm run lint
npm run check
npm run format -- --check
```

Vitest 按运行环境分为 `node` 与 `renderer` 两个项目：后端、CLI、共享逻辑、Electron 主进程和构建工具使用 Node 环境，前端与 preload 桥接使用 `happy-dom` 及 renderer 专属初始化。全量验证运行 `npm test`；影响面明确时使用 `npm test -- --project node` 或 `npm test -- --project renderer`，并继续通过测试文件路径收窄目标。

格式检查失败时运行 `npm run format` 修复相关文件，再重新执行 `npm run format -- --check`。
`npm run check` 同时禁止生产异常使用中文非 i18n 字面量，以及按 `Error.message` 文本建立控制流。

|改动范围|基线后追加验证|
|---|---|
|纯长期文档|检查 [`AGENTS.md`](../AGENTS.md) 声明的文档集合、相对链接和 diff；涉及 README、脚本提示、测试断言或技能时全文检索入口|
|单域源码行为|运行离改动最近的 `*.test.ts`、`*.test.tsx` 或 `*.test.mjs`|
|跨目录、跨前后端或共享契约|运行双方相关测试；影响面无法可靠收窄时执行 `npm test`|
|GUI / preload / native / Backend Runtime worker|运行相关单测和 `npm run check`；共享资源或 GUI Backend 生命周期变化时运行真实 `BackendResources` 与 `GuiBackendBootstrap` 集成测试；构建入口变化时执行 `npm run build`；只有视觉或原生交互证据确有需要时才执行 `npm run dev`|
|Agent 磁盘工作区或 Deno runner|运行 `src/backend/agent/workspace/`、`deno/`、`methods/` 与 `tools/` 下相关 `*.test.ts`，以及受影响的 Backend Runtime 和 main 路径测试；运行真实 Deno smoke 验证 TypeScript 加载、权限与文件边界；组合根、资源路径或打包资产变化时补真实 Electron smoke|
|前端视觉、CSS、可见文案|运行相关页面或组件测试，核对当前设计输入与既有视觉证据，必要时 Electron 真机检查|
|Windows Go launcher|在受影响的 `buildtools/builder/win-cli` 或 `buildtools/builder/win-berserker` 内执行 `go test ./...`|
|构建、Vite、electron-builder、afterPack、发布资产|`npm run build`；检查 Electron 发行包 locale 与 `src/shared/i18n` 的 `LOCALES` 一致，Deno runtime 是无外部 import 的单文件，manifest 同时校验发布资产与目标二进制且复用有效安装，afterPack 安装当前目标 Deno 与 runtime bundle，并测试、构建对应 Go module|

纯长期文档不强制执行代码基线；同时改代码、测试、配置或脚本时按完整基线处理。
