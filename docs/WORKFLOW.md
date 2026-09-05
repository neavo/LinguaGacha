# LinguaGacha 工作流

本文提供项目阅读路径、验证命令及其触发条件。始终适用的行动规则归 [AGENTS.md](../AGENTS.md)，长期文档治理方法归 [project-doc](../.codex/skills/project-doc/SKILL.md)，测试设计、诊断与整理方法归 [project-test](../.codex/skills/project-test/SKILL.md)。

## 1. 阅读路径

按当前缺失的信息选择入口。已有上下文足够时直接使用；跨层事实由专题文档定位，再按问题补读实现与测试。

|需要确认的内容|工程入口|相关实现与证据|
|---|---|---|
|架构、进程边界、跨层依赖|[ARCHITECTURE](ARCHITECTURE.md)|`src/index.ts`、`src/backend/bootstrap/`、相关入口测试|
|CLI 命令、输出、临时工程、平台启动器|[CLI](CLI.md)|`src/cli/`、`buildtools/builder/`、CLI / index 测试|
|API、SSE、错误、项目读写|[BACKEND](BACKEND.md)|`src/backend/api/`、`src/backend/project/`、`src/backend/cache/`、`src/shared/error/`|
|数据库、`.lg`、migration、asset、NativeFs|[BACKEND](BACKEND.md)|`src/backend/database/`、`src/backend/migration/`、`src/native/`|
|任务、worker、共享 LLM、系统代理网络|[BACKEND](BACKEND.md)|`src/backend/engine/`、`src/backend/worker/`、`src/backend/llm/`、`src/backend/network/`|
|产品 Agent 会话、资源、skill、工具、宿主能力、页面消费|[AGENT_RUNTIME](AGENT_RUNTIME.md)|`src/backend/agent/`、`src/shared/agent.ts`、`src/shared/backend-runtime.ts`、`src/frontend/app/session/agent/`、`src/frontend/pages/agent-page/`、`builtin/agent/`|
|Electron / preload / renderer 接入|[FRONTEND](FRONTEND.md)|`src/gui/`、`src/frontend/app/desktop/`|
|前端共享状态、feature、query、导航、session UI|[FRONTEND](FRONTEND.md)|`src/frontend/app/state/`、`src/frontend/app/session/`、`src/frontend/features/`、`src/frontend/pages/`|
|前端文案、样式消费、视觉|[FRONTEND](FRONTEND.md)|当前设计输入、既有界面证据、`src/frontend/index.css`、相关组件 / 页面 CSS|

## 2. 验证矩阵

按改动内容选择下列检查，同一改动命中多项时合并执行。已通过的检查覆盖到当前最终改动即可；新增修改、失败或未解决的影响面问题出现时，再补对应验证。

### 文本与元数据

|改动|验证|
|---|---|
|长期工程文档|核对项目声明的文档集合、事实归宿、相对链接和 diff；入口变化时检索 README、脚本、测试与技能中的受影响引用|
|开发行动规则与技能正文|核对授权、任务范围、触发条件、引用和完成条件的一致性；结构变化时使用代表任务走查读取路径与执行边界|
|开发技能元数据与路由|使用技能维护工具的校验入口检查 frontmatter，解析界面 YAML 并检查引用可达性与技能调用名称|
|静态文案、CSS|执行文件适用的静态检查；文案核对键和占位符等契约，视觉核对当前设计输入与既有界面证据；交互或机器行为变化时追加对应测试|

### 静态检查入口

|触发条件|命令与范围|
|---|---|
|TypeScript 源码、类型、测试或影响其解析的配置变化|`npx tsc -b --noEmit`；本次运行 `npm run build` 时使用其内置 typecheck 结果|
|lint 覆盖的源码、测试、脚本或规则配置变化|`npm run lint`，使用现有仓库检查入口|
|`src/`、`buildtools/` 中受架构和错误规则检查的源码或规则实现变化|`npm run check`，覆盖错误契约及 GUI、前端、后端边界|
|格式化脚本支持的源码、CSS、JSON 或相关配置变化|`npm run format -- --check <文件路径...>`；需要修复时对相同文件执行 `npm run format -- <文件路径...>` 后复查|

格式化入口 `buildtools/format-related-files.mjs` 支持显式文件路径；省略路径时收集暂存、未暂存和未跟踪的变更文件。工作区有其它任务改动时传入本任务路径。Markdown 与 YAML 通过文本或元数据检查验证。

### 行为与运行环境

|改动或风险|验证范围|
|---|---|
|单域源码行为、测试用例|运行当前实现对应的目标 `*.test.ts`、`*.test.tsx` 或 `*.test.mjs`；已有用例充分覆盖时直接运行已有测试|
|共享 helper、状态写入口、公开契约|直接受影响的调用者及生产者、消费者相关测试|
|测试配置、环境初始化、广泛共享基础设施|受影响的测试项目；影响面无法可靠界定时执行 `npm test`|
|GUI / preload / native / Backend Runtime worker 行为|相关目标测试；共享资源或 GUI Backend 生命周期变化时运行真实 `BackendResources` 与 `GuiBackendBootstrap` 集成测试|
|Agent 工作区或 Deno runtime 行为|`src/backend/agent/workspace/`、`model-tools/` 及受影响的 Backend Runtime / main 路径测试；TypeScript 加载、权限、真实文件边界、系统代理或流式网页转换的环境语义存在风险时，对相应行为运行真实 Deno smoke|
|宿主加载、组合根、资源定位或跨进程通信与启动契约变化|低层测试不足以证明变化时，对受影响的契约执行真实 Electron 集成或 smoke 验证|
|端到端 UI 冒烟|用户明确要求时执行；或已识别具体高风险，且低层验证不足以证明结果时执行。需要启动真机应用时使用 `npm run dev`|
|Windows Go launcher|在受影响的 `buildtools/builder/win-cli` 或 `buildtools/builder/win-berserker` 内执行 `go test ./...`|
|构建、Vite、electron-builder、afterPack、发布资产|`npm run build`，并按下文核对受影响的产物契约|

Vitest 在 `buildtools/vitest/vitest.config.ts` 中划分 `node` 与 `renderer`：后端、CLI、共享逻辑、Electron 主进程和构建工具使用 Node 环境，前端与 preload 桥接使用 `happy-dom` 及 renderer 初始化。使用 `npm test -- --project node <测试文件路径...>` 或 `npm test -- --project renderer <测试文件路径...>` 定位目标；省略文件路径运行对应项目。

构建或发布资产变化时，根据影响面核对：Electron 发行包 locale 与 `src/shared/i18n` 的 `LOCALES` 一致；Deno runtime 为无外部 import 的单文件；manifest 校验发布资产与目标二进制并复用有效安装；afterPack 安装当前目标 Deno 与 runtime bundle；涉及平台启动器时测试并构建对应 Go module。
