# LinguaGacha 开发工作流

本文提供源码定位、开发命令和验证入口。

- 设计意图从 [ARCHITECTURE](ARCHITECTURE.md) 进入对应专题。
- 行动规则见 [AGENTS.md](../AGENTS.md)。
- 测试设计与诊断方法见 [project-test](../.codex/skills/project-test/SKILL.md)。

## 🧭 定位实现

按当前问题选择入口，再阅读直接相关的调用者和测试。

### 启动与后端

|问题|实现入口|
|---|---|
|启动、资源注入与关闭|[产品入口](../src/index.ts)、[后端组合根](../src/backend/bootstrap/)、[GUI 入口](../src/gui/gui-entry.ts)|
|CLI 参数与帮助|[参数解析](../src/cli/cli-parser.ts)、[帮助文本](../src/cli/cli-output.ts)|
|CLI 输出与任务|[状态输出](../src/cli/cli-status-reporter.ts)、[任务执行](../src/cli/job/cli-job-runner.ts)|
|API、SSE 与错误|[API](../src/backend/api/)、[共享协议](../src/shared/)、[错误定义](../src/shared/error/)|
|工程、修订与缓存|[工程服务](../src/backend/project/)、[缓存](../src/backend/cache/)、[运行互斥](../src/backend/runtime-operation-gate.ts)|
|数据库、迁移与 IO|[数据库](../src/backend/database/)、[迁移](../src/backend/migration/)、[平台 IO](../src/native/)|
|翻译与计算|[批量翻译](../src/backend/batch-translation/)、[计算线程](../src/backend/worker/)|
|模型与请求|[LLM](../src/backend/llm/)、[网络](../src/backend/network/)|
|PDF 来源、页面与导出|[PDF](../src/backend/file/pdf/)、[页面写入](../src/backend/project/agent-workspace-page-write.ts)、[打印宿主](../src/native/pdf-host.ts)|

### Agent 与前端

|问题|实现入口|
|---|---|
|Agent 会话与指令|[Agent](../src/backend/agent/)、[公开会话类型](../src/shared/agent.ts)、[运行时资源](../builtin/)|
|工具与工作区|[工具](../src/backend/agent/tools/)、[工作区](../src/backend/agent/workspace/)|
|模型可读契约|[Schema](../src/backend/agent/workspace/schema.ts)、[契约生成](../src/backend/agent/tools/contract.ts)|
|宿主桥与传输|[GUI](../src/gui/)、[桌面传输](../src/frontend/app/desktop/)|
|前端运行态|[共享状态](../src/frontend/app/state/)、[会话](../src/frontend/app/session/)|
|业务交互与页面|[共享能力](../src/frontend/features/)、[页面](../src/frontend/pages/)|
|文案与样式|[词典](../src/shared/i18n/)、[外观](../src/frontend/app/appearance/)、[全局样式](../src/frontend/index.css)|

### 构建与平台

|问题|实现入口|
|---|---|
|构建与打包|[构建脚本](../buildtools/)、[打包配置](../buildtools/builder/electron-builder.config.ts)|
|Windows 入口|[CLI 启动器](../buildtools/builder/win-cli/)、[更新器](../buildtools/builder/win-berserker/)|

## 🛠️ 开发与命令帮助

|操作|命令|
|---|---|
|启动开发应用|`npm run dev`|
|构建发行包|`npm run build`|
|Windows CLI 帮助|安装目录中运行 `.\cli.exe translate --help`|
|macOS CLI 帮助|主程序运行 `LinguaGacha --cli translate --help`|
|Linux CLI 帮助|`./LinguaGacha.AppImage --cli translate --help`|

- `npm run dev` 同时准备工作区依赖和 PDF 打印资源。
- `npm run build` 包含 TypeScript 检查，Windows 打包还需要 Go 工具链。
- CLI 命令按实际安装位置定位可执行文件，参数和资源扩展名以帮助为准。
- CLI 输出字段与退出码见上表对应实现和测试。

## ✅ 选择验证

- 按最终改动选择检查，命中多项时合并执行。
- 已有结果覆盖最终改动后即可交付。
- 新增修改、失败或未解决的影响范围再触发补充验证。

### 文档与资源

**长期工程文档**

- 核对 [AGENTS.md](../AGENTS.md) 声明的文档集合和设计意图归属。
- 检查相对链接、锚点和 diff。
- 入口变化时，检索 README、脚本、测试与技能中的引用。

**开发规则与技能**

- 正文变化：核对授权、任务范围、触发条件和完成条件。
- 结构变化：用代表任务走查读取路径与执行边界。
- 元数据或路由变化：检查 frontmatter、界面 YAML、资源引用和调用名称。

**产品 Agent 指令与技能**

- 核对加载入口、工具和数据契约。
- 按行为目标使用合成样例或已有评估入口。
- 真实模型质量使用有界样本运行记录验证。

**文案与视觉**

- 文案核对键和占位符。
- 视觉核对当前设计输入和既有界面证据。
- 执行适用静态检查，交互或机器行为变化时追加对应测试。

Markdown 与 YAML 使用文本或元数据检查，项目格式化脚本不处理这两类文件。

视觉验证入口独立于可选设计流程产物，当前任务和既有界面均可提供设计输入。

### 静态检查

|触发条件|命令|
|---|---|
|TypeScript 源码、类型、测试或解析配置变化|`npm run typecheck`|
|lint 覆盖的源码、测试、脚本或规则配置变化|`npm run lint`|
|受架构和错误规则检查的源码或规则实现变化|`npm run check`|
|格式化脚本支持的文件变化|`npm run format -- --check <文件路径...>`|

- 已运行 `npm run build` 时，使用其内置 TypeScript 检查结果。
- lint 包含前端 `react/only-export-components` 检查。
- `npm run check` 覆盖分层、迁移、错误、文案和样式边界。
- 格式修复使用 `npm run format -- <文件路径...>`，随后复查。

格式化支持范围见 [format-related-files.mjs](../buildtools/format-related-files.mjs)。有其它任务改动时，显式传入本任务路径；省略路径会收集全部变更文件。

### 行为测试

|改动|范围|
|---|---|
|单域行为或测试用例|对应的 `*.test.ts`、`*.test.tsx` 或 `*.test.mjs`|
|共享规则、状态写入口或公开契约|受影响的调用者、生产者和消费者|
|测试配置或广泛共享基础设施|受影响的测试项目|
|影响范围无法可靠界定|`npm test`|

[vitest.config.ts](../buildtools/vitest/vitest.config.ts) 划分两个项目：

- `node`：后端、CLI、共享逻辑、Electron main 和构建工具。
- `renderer`：前端与 preload 桥接，使用 `happy-dom` 和 renderer 初始化。

```powershell
npm test -- --project node <测试文件路径...>
npm test -- --project renderer <测试文件路径...>
```

省略文件路径会运行整个对应项目。

## 🧪 平台与运行环境验证

### GUI、宿主与文件清理

GUI、preload、native 或 Backend Runtime worker 变化时，先运行相关目标测试。

- 共享资源或生命周期变化：运行 `BackendResources` 与 `GuiBackendBootstrap` 的真实集成测试。
- 文件删除或清理变化：运行 `src/native/native-fs.test.ts` 与调用者测试。前者在 Windows 用真实 Electron 验证只读文件与目录删除。
- 加载、资源定位或跨进程启动契约变化：低层测试不足时，追加对应真实 Electron 集成或 smoke 验证。

端到端 UI 冒烟在用户明确要求，或存在具体高风险且低层验证不足时执行。真机应用通过 `npm run dev` 启动。

### Agent 工作区与图片

工作区或 Node runtime 变化时，运行 `workspace/`、`tools/` 及受影响的 Backend Runtime / main 测试。

加载、权限、文件边界、代理或流读取涉及真实环境时，使用 [bootstrap.test.ts](../src/backend/agent/workspace/runtime/bootstrap.test.ts)。它在仓库外通过生产构建和真实 Electron 验证执行环境。

上传、图片与宿主协议按影响选择：

- 上传行为：存储、消息准备和草稿测试。
- 工作区图片输出：工作区输出相关测试。
- 字节传输与关闭：真实 Gateway / Bootstrap 验证。
- 编解码或 IPC：`src/native/agent-image-host.test.ts` 与工作区 bootstrap 集成测试。

验证发行包入口或资源定位时，设置以下变量，再复用 bootstrap 测试：

|变量|目标|
|---|---|
|`LINGUAGACHA_TEST_ELECTRON`|发行包可执行文件|
|`LINGUAGACHA_TEST_WORKSPACE_RUNTIME`|发行包工作区运行目录|

### PDF

PDF 来源、页面写入、排版或导出变化时，按影响选择：

- `src/backend/file/pdf/` 中的目标测试。
- `agent-workspace-page-write` 与工作区 `service.test.ts`。
- 数据库和 `ProjectWriteStore` 的来源、事务测试。

[pdf-worker.test.ts](../src/backend/file/pdf/pdf-worker.test.ts) 验证独立部署线程的计算、打印回调、取消与重启。

[pdf-host.test.ts](../src/native/pdf-host.test.ts) 验证真实 Electron 打印与取消。执行前准备工作区依赖和打印资源：

```powershell
node buildtools/build-workspace.mjs
node buildtools/build-pdf-print.mjs
npm test -- --project node src/native/pdf-host.test.ts
```

- 已完成构建时，直接使用现有产物。
- `LINGUAGACHA_PDF_QA_DIR` 指定视觉检查产物目录。
- 验证发行包打印资源时，设置 `LINGUAGACHA_TEST_WORKSPACE_RUNTIME`，使用默认开发 Electron 执行测试脚本。

### 热更新与 Windows 工具

renderer 热更新或运行态刷新变化时执行：

```powershell
npm test -- --project node buildtools/vite/renderer-runtime-reload.test.mjs
```

该测试使用真实 Vite 与隐藏 Electron 窗口。

Windows 启动器或更新器变化时，在对应的 `win-cli` 或 `win-berserker` Go module 中执行 `go test ./...`。更新器进程测试须在 Windows 执行。

## 📦 构建与发布产物

构建、Vite、electron-builder、`afterPack` 或发布资产变化时，运行 `npm run build`。

按影响范围检查产物：

- 使用 `npm exec -- asar list <app.asar 路径>` 检查应用入口、前端资源及文件范围。用户数据、项目源码和原始应用依赖树应排除。
- Electron 语言资源与 `LOCALES` 一致。
- 内置资源随应用部署。
- 工作区包含实际依赖清单、标准 `node_modules`、内部包和运行资源。
- `runAsNode` fuse 保持开启，供工作区启动 Electron Node 子进程。
- Windows 启动器和更新器完成对应 Go module 的测试与构建。

根安装使用 `npm ci`，保证依赖来源可复现。

`afterPack` 中的测试、构建或复制失败都会终止打包。

部署相关测试按变化选择：

|变化|验证入口|
|---|---|
|工作区依赖部署|[workspace-dependencies.test.mjs](../buildtools/workspace-dependencies.test.mjs)|
|工作区入口定位|[workspace-runtime.test.ts](../src/native/workspace-runtime.test.ts)|
|应用入口与合并后的 SDK|[index.test.ts](../src/index.test.ts) 的仓库外 ASAR 集成测试|
|部署后的工作区执行|仓库外 Electron bootstrap 集成测试|
