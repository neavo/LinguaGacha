# LinguaGacha 工作流

本文规定维护任务的阅读路径、验证选择、长期文档同步和交付自检。专题正文不要写在这里。

## 1. 起手式

1. 先判断任务类型，再读 [`ARCHITECTURE.md`](ARCHITECTURE.md) 和对应专题文档，纯文档自检可直接读目标文档与 `project-doc` 技能。
2. 改代码前确认状态拥有者、唯一写入口、事件回流路径和失败回滚语义，不只按目录名推断边界。
3. 代码事实优先于文档，文档与代码冲突时回到当前实现，证据不足列为未决，不写成长期规则。
4. 改动会影响未来维护判断时，同一任务内同步唯一归宿文档，能从代码、目录、类型名或局部实现直接看出的事实不写长期文档。
5. 完成后回看 diff，确认没有制造并行规则、旧入口、低密度重复正文或无关改动。

## 2. 阅读路径

| 任务类型 | 必读 | 补读 |
| --- | --- | --- |
| 架构、进程边界、跨层依赖 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | `src/index.ts`、`src/backend/bootstrap/`、相关入口测试 |
| CLI 命令、参数、输出、平台启动器 | [`CLI.md`](CLI.md) | `src/cli/`、`buildtools/builder/`、CLI / index 测试 |
| API、SSE、错误、项目读写 | [`BACKEND.md`](BACKEND.md) | `src/backend/api/`、`src/backend/project/`、`src/backend/cache/`、`src/shared/error/` |
| 数据库、`.lg`、migration、asset、NativeFs | [`BACKEND.md`](BACKEND.md) | `src/backend/database/`、`src/backend/migration/`、`src/native/` |
| 任务、worker、LLM | [`BACKEND.md`](BACKEND.md) | `src/backend/engine/`、`src/backend/worker/`、`src/backend/llm/` |
| Electron / preload / renderer 接入 | [`FRONTEND.md`](FRONTEND.md) | `src/gui/`、`src/frontend/app/desktop/` |
| 前端共享状态、页面 query、导航、页面 UI 状态 | [`FRONTEND.md`](FRONTEND.md) | `src/frontend/app/state/`、`src/frontend/app/session/`、`src/frontend/pages/` |
| 前端可见文案、样式消费、视觉边界 | [`FRONTEND.md`](FRONTEND.md) | `DESIGN.md`、`src/frontend/index.css`、相关组件 / 页面 CSS |
| 长期文档治理 | `.codex/skills/project-doc/SKILL.md` | `AGENTS.md`、`docs/`、README / 脚本引用 |

## 3. 验证矩阵

代码、测试、构建配置或脚本有任何改动时，先执行代码基线，再按影响范围追加验证：

```bash
npx tsc -b --noEmit
npm run lint
npm run check
npm run format
```

| 改动范围 | 基线后追加验证 |
| --- | --- |
| 纯长期文档 | 检查目标文档形态、相对链接和 diff，涉及 README、脚本提示或测试断言时全文检索相关入口 |
| TypeScript 非视觉逻辑 | `npm test -- <相关 test 文件>` 或 `npm test` |
| 后端 API / database / task / shared error | 相关 `src/backend/**/*.test.ts`，影响共享行为时跑 `npm test` |
| CLI 命令、入口分发或平台启动器 | 相关 `src/cli/**/*.test.ts`、`src/index.test.ts`、`buildtools/builder/*.test.mjs`，影响打包时跑 `npm run build` |
| 前端状态 / 页面逻辑 | 相关 `src/frontend/**/*.test.ts(x)` |
| 前端视觉 / CSS / 可见文案 | 相关页面或组件测试，核对 `DESIGN.md`，必要时 Electron 真机检查 |
| 跨前后端状态或共享契约 | 后端相关测试 + frontend state/store 测试，必要时 `npm test` 或 `npm run dev` 走主链路 |
| 构建、Vite、electron-builder、发布资产 | `npm run build`，按影响范围追加 CLI / frontend / backend 测试 |

纯长期文档不强制执行代码基线，若同时改代码或工程配置，则按代码基线处理。

## 4. 长期文档同步闸门

一条信息必须同时满足四项才进入长期文档：

| 判断问题 | 不满足时 |
| --- | --- |
| 不知道它会改错落点、边界、契约或验证吗？ | 删除 |
| 它无法从代码、目录、类型名或局部实现直接看出吗？ | 删除 |
| 它描述当前稳定事实，而不是历史过程、本次改动或临时状态吗？ | 删除或改写 |
| 它有且只有一个固定归宿吗？ | 拆分、迁移、合并或删除 |

归宿规则：

- 协作、编码和交付硬约束归 `AGENTS.md`。
- 系统分层、跨层边界和主链路归 `ARCHITECTURE.md`。
- CLI 命令模式归 `CLI.md`。
- 后端协议、状态、任务和存储归 `BACKEND.md`。
- 前端接入、运行态、页面 query、导航和样式消费归 `FRONTEND.md`。
- 阅读路径、验证矩阵、文档同步和交付自检归本文。
- 产品语义与设计权威分别归 `PRODUCT.md` / `DESIGN.md`，不被本流程吸收。

删除或迁移文档入口前，全文检索 README、脚本报错、测试断言、技能提示和文档内链接，确认不再指向旧入口。

## 5. 交付自检

- diff 只包含本任务相关文件，命名、实现边界、注释和文档边界一致。
- 没有把专题正文写进 `AGENTS.md` 或 `ARCHITECTURE.md`，也没有新增临时权威入口。
- 协议、状态、数据库、任务、前端运行态、CLI 或验证要求的变化已同步到唯一归宿。
- 代码、测试、构建配置或脚本改动已执行代码基线，并按矩阵追加影响范围内测试，未执行项说明原因与影响范围。
- 前端视觉改动已说明是否核对 `DESIGN.md`，以及是否做了真机或等价验证。
- 文档治理交付说明应按删除、合并、迁移、压缩、补写、保留、未决、验证报告信息集合变化，而不是复述过程。

## 6. 更新触发条件

- 改起手阅读路径、验证命令、检查脚本、文档同步归宿或交付格式，更新本文。
- 新增长期文档入口、删除旧入口或改变 `AGENTS.md` 与 `docs/` 的目标形态，更新本文并检查仓库链接。
- 改产品 / 设计流程入口时，只在本文保留入口关系，不吸收 `PRODUCT.md` / `DESIGN.md` 正文。
