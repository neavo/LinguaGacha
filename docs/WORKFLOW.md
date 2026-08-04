# LinguaGacha 工作流

本文只提供项目阅读路径与验证范围；始终适用的行动规则归 [`AGENTS.md`](../AGENTS.md)，长期文档治理归 [`project-doc` 技能](../.codex/skills/project-doc/SKILL.md)。专题正文不写在这里。

## 1. 阅读路径

| 任务类型 | 必读 | 补读 |
| --- | --- | --- |
| 架构、进程边界、跨层依赖 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | `src/index.ts`、`src/backend/bootstrap/`、相关入口测试 |
| CLI 命令、输出、临时工程、平台启动器 | [`CLI.md`](CLI.md) | `src/cli/`、`buildtools/builder/`、CLI / index 测试 |
| API、SSE、错误、项目读写 | [`BACKEND.md`](BACKEND.md) | `src/backend/api/`、`src/backend/project/`、`src/backend/cache/`、`src/shared/error/` |
| 数据库、`.lg`、migration、asset、NativeFs | [`BACKEND.md`](BACKEND.md) | `src/backend/database/`、`src/backend/migration/`、`src/native/` |
| 任务、worker、LLM | [`BACKEND.md`](BACKEND.md) | `src/backend/engine/`、`src/backend/worker/`、`src/backend/llm/` |
| Electron / preload / renderer 接入 | [`FRONTEND.md`](FRONTEND.md) | `src/gui/`、`src/frontend/app/desktop/` |
| 前端共享状态、跨页面 feature、页面 query、导航、session UI | [`FRONTEND.md`](FRONTEND.md) | `src/frontend/app/state/`、`src/frontend/app/session/`、`src/frontend/features/`、`src/frontend/pages/` |
| 前端文案、样式消费、视觉 | [`FRONTEND.md`](FRONTEND.md) | 当前任务设计输入、既有界面证据、`src/frontend/index.css`、相关组件 / 页面 CSS |
| 长期文档治理 | [`project-doc` 技能](../.codex/skills/project-doc/SKILL.md) | `docs/`、README / 脚本 / 测试中的文档引用 |

## 2. 验证矩阵

代码、测试、构建配置或脚本有改动时先执行代码基线；需要运行 `npm run build` 时，其内部已经包含 typecheck，不再单独重复执行 `npx tsc`：

```bash
npx tsc -b --noEmit
npm run lint
npm run check
npm run format -- --check
```

格式检查失败时运行 `npm run format` 修复相关文件，再重新执行 `npm run format -- --check`。

| 改动范围 | 基线后追加验证 |
| --- | --- |
| 纯长期文档 | 检查 [`AGENTS.md`](../AGENTS.md) 声明的文档集合、相对链接和 diff；涉及 README、脚本提示、测试断言或技能时全文检索入口 |
| 单域源码行为 | 运行离改动最近的 `*.test.ts`、`*.test.tsx` 或 `*.test.mjs` |
| 跨目录、跨前后端或共享契约 | 运行双方相关测试；影响面无法可靠收窄时执行 `npm test` |
| GUI / preload / native / Backend Runtime worker | 运行相关单测和 `npm run check`；构建入口变化时执行 `npm run build`；只有视觉或原生交互证据确有需要时才执行 `npm run dev` |
| 前端视觉、CSS、可见文案 | 运行相关页面或组件测试，核对当前设计输入与既有视觉证据，必要时 Electron 真机检查 |
| Windows Go launcher | 在受影响的 `buildtools/builder/win-cli` 或 `buildtools/builder/win-berserker` 内执行 `go test ./...` |
| 构建、Vite、electron-builder、afterPack、发布资产 | `npm run build`；afterPack 会测试并构建对应 Go module |

纯长期文档不强制执行代码基线；同时改代码、测试、配置或脚本时按完整基线处理。
