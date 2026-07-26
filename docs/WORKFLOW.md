# LinguaGacha 工作流

本文供需要项目文档支持的实现或长期文档维护任务选择阅读路径、验证范围、文档同步和交付自检；它不替代始终适用的仓库行动规则。专题正文不写在这里。

## 1. 起手式

1. 先判断任务类型，再读 [`ARCHITECTURE.md`](ARCHITECTURE.md) 和对应专题文档；纯文档自检可直接读目标文档与 [`project-doc` 技能](../.codex/skills/project-doc/SKILL.md)。
2. 文档与代码冲突时回到当前实现，证据不足列为未决，不写成长期规则。
3. 涉及共享状态、任务、文件集合、数据库或持久化写入时，改动前确认拥有者、唯一写入口、事件回流、互斥、事务和失败补偿；纯函数、样式等无关任务不套用这组检查。
4. 改动会影响未来维护判断时，同一任务内同步唯一归宿；可从单个局部实现轻易看出的事实不进入长期文档。
5. 完成后回看 diff，确认没有并行规则、旧入口、低密度重复或无关改动。

## 2. 阅读路径

| 任务类型 | 必读 | 补读 |
| --- | --- | --- |
| 架构、进程边界、跨层依赖 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | `src/index.ts`、`src/backend/bootstrap/`、相关入口测试 |
| CLI 命令、输出、临时工程、平台启动器 | [`CLI.md`](CLI.md) | `src/cli/`、`buildtools/builder/`、CLI / index 测试 |
| API、SSE、错误、项目读写 | [`BACKEND.md`](BACKEND.md) | `src/backend/api/`、`src/backend/project/`、`src/backend/cache/`、`src/shared/error/` |
| 数据库、`.lg`、migration、asset、NativeFs | [`BACKEND.md`](BACKEND.md) | `src/backend/database/`、`src/backend/migration/`、`src/native/` |
| 任务、worker、LLM | [`BACKEND.md`](BACKEND.md) | `src/backend/engine/`、`src/backend/worker/`、`src/backend/llm/` |
| Electron / preload / renderer 接入 | [`FRONTEND.md`](FRONTEND.md) | `src/gui/`、`src/frontend/app/desktop/` |
| 前端共享状态、页面 query、导航、session UI | [`FRONTEND.md`](FRONTEND.md) | `src/frontend/app/state/`、`src/frontend/app/session/`、`src/frontend/pages/` |
| 前端文案、样式消费、视觉 | [`FRONTEND.md`](FRONTEND.md) | 当前任务设计输入、既有界面证据、`src/frontend/index.css`、相关组件 / 页面 CSS |
| 长期文档治理 | [`project-doc` 技能](../.codex/skills/project-doc/SKILL.md) | `docs/`、README / 脚本 / 测试中的文档引用 |

## 3. 验证矩阵

代码、测试、构建配置或脚本有改动时先执行代码基线：

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
| 单域 TypeScript 行为 | 运行离改动最近的 `*.test.ts(x)` |
| 跨目录、跨前后端或共享契约 | 运行双方相关测试；影响面无法可靠收窄时执行 `npm test` |
| GUI / preload / native / 桌面集成 | 运行相关单测，必要时 `npm run dev` 走真实主链路 |
| 前端视觉、CSS、可见文案 | 运行相关页面或组件测试，核对当前设计输入与既有视觉证据，必要时 Electron 真机检查 |
| Windows Go launcher | 在受影响的 `buildtools/builder/win-cli` 或 `buildtools/builder/win-berserker` 内执行 `go test ./...` |
| 构建、Vite、electron-builder、afterPack、发布资产 | `npm run build`；afterPack 会测试并构建对应 Go module |

纯长期文档不强制执行代码基线；同时改代码、测试、配置或脚本时按完整基线处理。

## 4. 长期文档同步

- 长期文档统一按 [`project-doc` 技能](../.codex/skills/project-doc/SKILL.md) 的收录闸门与先减后增流程治理；项目文档集合与行动边界以 [`AGENTS.md`](../AGENTS.md) 为准，专题归宿见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
- 删除或迁移入口前，全文检索 README、脚本报错、测试断言、技能提示和文档链接，确认不再指向旧位置。

## 5. 交付自检

- diff 只包含本任务文件，命名、实现、测试与文档边界一致。
- 代码基线和影响范围验证已执行；未执行、失败或只执行部分时说明原因与影响范围。
- 协议、状态、数据库、任务、前端运行态、CLI 或验证要求的变化已同步到唯一归宿。
- 前端视觉改动已说明采用的设计输入或视觉证据，以及是否做了真机或等价验证。
- 文档治理按删除、合并、迁移、压缩、补写、保留、未决、验证汇报信息集合变化。

## 6. 更新条件

阅读路径、验证命令、测试分层、文档同步入口或交付要求变化时更新本文；项目长期文档集合或专题归宿变化时同步检查仓库引用。
