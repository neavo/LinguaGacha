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
|PDF 来源、页面与文件生成|[PDF](../src/backend/file/pdf/)、[页面写入](../src/backend/project/agent-workspace-page-write.ts)、[打印宿主](../src/native/pdf-host.ts)|

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
|Windows 入口|[CLI 启动器](../buildtools/builder/cli/)、[更新器](../buildtools/builder/berserker/)|

## 🛠️ 开发与命令帮助

开发环境使用与 [构建工作流](../.github/workflows/build.yml) 中 `node-version` 一致的 Node 主版本。

应用与工作区使用 Electron 内置的 Node，工作区构建目标和 Node 类型跟随 Electron 的运行环境。

|操作|命令|
|---|---|
|启动开发应用|`npm run dev`|
|构建发行包|`npm run build`|
|Windows CLI 帮助|安装目录中运行 `.\cli.exe translate --help`|
|macOS CLI 帮助|主程序运行 `LinguaGacha --cli translate --help`|
|Linux CLI 帮助|`./LinguaGacha.AppImage --cli translate --help`|

- `npm run dev` 按输入变化准备静态依赖与宿主平台工具，每次重新打包工作区代码。首次构建可能下载依赖、uv 归档与 aria2 平台包。
- 开发准备与发行构建要求系统 `tar` 位于 `PATH` 中。
- 开发与发行产物使用独立目录，支持调试期间构建发行包。构建期间修改共享源码仍可能影响发行输入。
- 需要强制重新准备时，删除开发缓存 `build/dev/resources/.development-cache` 或 `build/dev/resources/`。
- 资源构建按输出目录互斥。`npm run build` 始终重新准备资源，发行构建不复用开发缓存。
- `npm run build` 包含 TypeScript 检查和静态资源生成，`afterPack` 再按实际目标部署原生工具。开发与发行的原生工具准备均需要 Go 工具链。
- CLI 命令按实际安装位置定位可执行文件，参数和资源扩展名以帮助为准。
- CLI 输出字段与退出码见上表对应实现和测试。
- Windows 更新日志位于安装目录的 `log/update.log`，每次运行覆盖旧日志，可与应用日志一起收集。

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

### 静态检查

|触发条件|命令|
|---|---|
|TypeScript 源码、类型、测试或解析配置变化|`npm run typecheck`|
|lint 覆盖的源码、测试、脚本或规则配置变化|`npm run lint`|
|受架构和错误规则检查的源码或规则实现变化|`npm run check`|
|格式化脚本支持的文件变化|`npm run format -- --check <文件路径...>`|

- 已运行 `npm run build` 时，使用其内置 TypeScript 检查结果。
- `npm run typecheck` 使用 `tsrs`，通过 `-b` 检查 renderer、node 和 test 三个项目，并复用各自的增量缓存。显式关闭 `--fast`，保持默认检查行为。声明契约测试使用同一编译器。
- 升级 `tsrs` 时，对照其对应 TypeScript 版本的全量诊断，并验证增量检查、声明契约测试和构建。
- `tsrs` 当前提供 Windows x64 命令行包，尚不支持 Windows `--watch` 和项目本地编辑器 SDK。编辑器继续使用其现有 TypeScript 服务。
- lint 包含前端 `react/only-export-components` 检查。
- `npm run check` 覆盖分层、迁移、错误、文案和样式边界。
- 格式修复使用 `npm run format -- <文件路径...>`，随后复查。

格式化支持范围见 [format-related-files.mjs](../buildtools/format-related-files.mjs)。有其它任务改动时，显式传入本任务路径。省略路径会收集全部变更文件。

### 行为测试

|改动|范围|
|---|---|
|单域行为或测试用例|对应的 `*.test.ts` 或 `*.test.tsx`|
|共享规则、状态写入口或公开契约|受影响的调用者、生产者和消费者|
|测试配置或广泛共享基础设施|受影响的测试项目|
|影响范围无法可靠界定|`npm test`|

[vitest.config.ts](../buildtools/vitest/vitest.config.ts) 划分三个项目：

- `node`：后端、CLI、共享逻辑和 Electron main。
- `integration`：消费完整部署工作区或启动真实 Electron 宿主的测试，文件清单由 Vitest 配置维护。
- `renderer`：前端与 preload 桥接，使用 `jsdom` 和 renderer 初始化。

测试入口自动准备所需资源。`integration` 在普通测试完成后并发运行。

```powershell
npm test -- --project node <测试文件路径...>
npm test -- --project integration <测试文件路径...>
npm test -- --project renderer <测试文件路径...>
```

省略文件路径会运行整个对应项目。

## 🧪 平台与运行环境验证

### GUI、宿主与文件清理

GUI、preload、native 或 Backend Runtime worker 变化时，先运行相关目标测试。

- 应用代理变化：运行 [app-proxy.test.ts](../src/native/app-proxy.test.ts)。它用真实 Electron 与本地代理验证 Chromium 和 Undici 的路由及传输。
- 语言资源或启动语言变化：运行 [app-locale.test.ts](../src/native/app-locale.test.ts) 的真实 Electron 测试。
- 共享资源或生命周期变化：运行 `BackendResources` 与 `GuiBackendBootstrap` 的真实集成测试。
- 文件删除或清理变化：运行 `src/native/native-fs.test.ts` 与调用者测试。前者在 Windows 用真实 Electron 验证只读文件与目录删除。
- 用户文件语义变化：运行 `src/native/native-fs.test.ts`。它在 Electron 主进程、后端线程与 `ELECTRON_RUN_AS_NODE` 中验证 ASAR 档案按普通文件处理。普通 Node 测试不识别 ASAR。
- 加载、资源定位或跨进程启动契约变化：低层测试不足时，追加对应真实 Electron 集成或 smoke 验证。

端到端 UI 冒烟在用户明确要求，或存在具体高风险且低层验证不足时执行。真机应用通过 `npm run dev` 启动。

### Agent 工作区与图片

工作区或共享执行运行时变化时，运行 `workspace/`、`tools/` 及受影响的 Backend Runtime / main 测试。

加载、子进程、代理或流读取涉及真实环境时，使用 [bootstrap.test.ts](../src/backend/agent/workspace/runtime/bootstrap.test.ts)。它在仓库外通过生产构建和真实 Electron 验证执行环境。

上传、图片与宿主协议按影响选择：

- 上传行为：存储、消息准备和草稿测试。
- 工作区图片输出：工作区输出相关测试。
- 字节传输与关闭：真实 Gateway / Bootstrap 验证。
- 编解码或 IPC：`src/native/agent-image-host.test.ts` 与工作区 bootstrap 集成测试。

发行包入口或资源定位见 [发行包运行验证](#发行包运行验证)。

#### 漫画图片

图片工程契约变化运行 `file/image/image-format.test.ts`、`project-content-service.test.ts`、工作区文件变更与生成服务测试。SDK 状态、缓存和发布变化运行 `agent/image/index.test.ts`。

像素边界使用已经准备的共享 Python 环境，无需模型：

```powershell
uv run --project '<共享 Python 工程目录>' python -I -X utf8 src/backend/agent/image/image.test.py src/backend/agent/image
```

部署验证可把最后一个参数改为部署后的 `runtime` 目录。排版宿主变化运行 `npm test -- --project integration src/native/image-host.test.ts`，覆盖真实字体、横竖排、空译文、分块和取消收尾。共享推理变化还需运行下方媒体回归与 `inference/models.test.ts`，工作区请求变化追加 `workspace/runtime/bootstrap.test.ts`。

真实漫画和容量验收使用独立工作目录。分别记录模型摘要、原稿字节往返、组恢复、当前生成快照、发布重试及峰值资源。视觉与语义接受必须单独记录，不能从程序检查通过推断。

#### 媒体推理

Python 媒体行为可通过 `media.test.py` 独立验证，无需模型或视频。使用已准备的媒体 Python 项目。共享推理版本见 `src/backend/agent/inference/environment.ts`，媒体专属依赖见 `builtin/skills/media/scripts/media.mjs` 的 `DEPENDENCIES`：

```powershell
$mediaPythonProject = '<已准备媒体环境的 Python 项目目录，含 pyproject.toml>'
$mediaTestFile = (Resolve-Path 'src/backend/agent/media/media.test.py').Path
$mediaSourceDirectory = (Resolve-Path 'src/backend/agent/media').Path
uv run --project $mediaPythonProject python -I -X utf8 $mediaTestFile $mediaSourceDirectory
```

验证部署产物时，将最后一个参数替换为其 `runtime` 目录。Windows 路径问题须在 Windows 验证。

npm、uv 默认包源变化运行 `package-source.test.ts`、`uv/index.test.ts`、工作区 `service.test.ts`，以及集成测试 `npm/index.test.ts` 和工作区 `bootstrap.test.ts`。它们使用替身判定和关闭的代理端口，不访问地区接口。

媒体路由和配置变化运行 `media/probe.test.ts`、`media/inference-engine.test.ts`、`media/engine.test.ts` 及受影响的 `media/preparation`、`inference/channel`、`inference/helper`、`inference/runtime`、`media/speech` 测试。Worker 变化运行集成测试 `media/worker.test.ts`；公开探查和资源检查契约同时运行工作区 `bootstrap.test.ts`。这些集成测试使用测试资源，不下载权重。

真实媒体验收由 `media/index.test.ts` 显式启用。它验证 GPU 探查、识别、画面处理、显式设备选择与取消后重跑。脚本先经 `@lg/npm`、`@lg/uv` 显式安装技能固定的依赖，再调用 `prepare_models()` 下载权重，默认包源使用真实地区判定。报告目录保留模型缓存、原始日志和 `workspace/work/result.json`。

```powershell
$env:LINGUAGACHA_MEDIA_SOURCE = '素材的绝对路径'
$env:LINGUAGACHA_MEDIA_REPORT = '独立验收目录的绝对路径'
$env:LINGUAGACHA_MEDIA_LANGUAGE = 'JA'
npm test -- --project integration src/backend/agent/media/index.test.ts
```

`LINGUAGACHA_MEDIA_LANGUAGE` 使用工程语言枚举，默认 `JA`。再次执行会复用准备缓存。验证 ORT 降级时，复用装有高版本的验收环境，并核对 `result.json` 的 `ort` 字段。GPU 质量与自然退出须在每台目标设备上用相同素材和命令各自验收。画面流程变化时分别验收 CPU 双 small 和 GPU 双 medium。

可视化验收只显式安装 FFmpeg 与 Python 包，不准备识别模型，同时证明成片不受模型缺失影响。报告目录应位于仓库外，保留独立环境与运行日志：

```powershell
$env:LINGUAGACHA_VISUALIZE_REPORT = '<仓库外验收目录绝对路径>'
npm test -- --project integration src/backend/agent/media/visualize.test.ts
```

该入口在部署环境执行 `visualize.test.py`。正式资源还需用当前技能脚本生成字幕并做视觉检查。长音频验收记录实际耗时、进程峰值内存和临时空间，并完整解码检查成片。

界面、PDF 与字幕烧录共用 `public/fonts/` 中的 TTF 字体。更新字体资源后，验证字体加载及中日韩、拉丁文、等宽文字和 emoji 显示。

### 原生游戏

格式目录位于 `src/backend/file/`，按变化选择测试：

|变化|测试|
|---|---|
|格式、来源发现或默认排除|对应的 `rpgmaker-mv-mz/`、`rpgmaker-rgss/`、`wolfrpg/`、`godot/`、`renpy/` 或 `tyrano/` 测试，以及 `project-content-service.test.ts`|
|引擎登记表与共享容器|各原生格式的测试、来源发现、校对缓存、Agent 工作区原稿，以及 `shared/game/` 下的对应测试|
|文件身份与迁移|数据库迁移、工程打开迁移、解析流水线和译文生成测试|
|文本规则计算|`text-rule-type.test.ts`、翻译译前流程和校对评估|
|来源或失败边界|`source-discovery.test.ts`、解析流水线、新建与追加导入测试|
|准备、归档与游戏资产输出提交|对应引擎的准备或导出测试，以及 [目录事务](../src/backend/file/shared/game/directory.test.ts)、`shared/` 下受影响的协议与 IO 测试|
|准备线程|`shared/game/prepare-worker.test.ts`，它使用正式构建入口验证退出与句柄释放|
|字体工具与引擎字体能力|`game-font-service.test.ts`、`shared/game/font-replace.test.ts`、`shared/game/engines.test.ts` 和对应引擎的字体测试|
|取消或关闭顺序|`runtime-operation-gate.test.ts` 与 `gui-backend-bootstrap.test.ts`|
|脚本解析器或准备 worker 的部署|[发行包运行验证](#发行包运行验证)|

#### 真实样本验收

真实样本使用独立副本与输出目录，WOLF 样本在仓库外验收。外部研究探针和样本不作为构建或自动化测试依赖。

- 对照原稿哈希检查提取、解密、重复导入和失败恢复。
- RGSS 同时覆盖保留与移除散装数据的情况。定位变化后从原稿重建条目，再验证译文生成。
- WOLF 核对解包哈希、原稿字节和独立 LZ4 解码。游戏运行覆盖中文、选项分支、数据库显示及保留主标题时的存档身份。
- Godot 核对外置与内嵌 PCK 展开、PE 修正、启动 PCK 移除和重复导入，再将产品导出的译文拷回启动。运行时验收覆盖语言表 `fallback`、控件中文、脚本加载、系统字体回退、补丁副作用和资源目录枚举。禁用 `--path` 的样本从副本游戏目录直接启动。
- Godot 字体工具按换字体与拷回译文的两种先后顺序验收，启动后核对资产字体控件与未指定字体的控件都取得所选字体。
- Ren’Py 准备变化使用 `input/renpy_01` 至 `input/renpy_04` 的独立副本与隔离存档，通过 `prepare_game_source` 验证准备和重复准备。记录版本与启动日志，保留 6.x 启动证据。核对 `renpy_03` 场景笔记的原字节和 `renpy_04` 业务对象加载。验收探针只加入副本，每个样本独立记录失败归因。
- Ren’Py 字体与译文变化通过 `GameFontService.inspect/apply` 和格式导出入口验证两种覆盖顺序。核对原路径字体与默认正文字体的哈希。启动后检查文本、语句身份、中文渲染、语言初始化和语言切换后的断行设置。比较启动前后的编译文件哈希，确认生成资源未进入原稿。
- Ren’Py 引擎兼容性由真实游戏验收，另查 `lock.txt` 与只读目录中的生成资源首次编译。文本保护变化运行 `renpy-boundaries.test.ts`、`text-preserve-rules.test.ts` 和 `renpy-rpy/` 格式测试。
- TyranoScript 解析变化用游戏自带 `kag.parser.js` 对照扫描结果。通过产品入口验证导入、导出和拷回重导入。准备覆盖散装与 `app.asar` 两种布局。启动后核对正文、选项、姓名框和字体工具覆盖的文字控件。
- 协议测试与游戏启动分别验收。Windows 启动须确认所选入口读取外部数据和明文素材。

交付时注明未验证的布局、游戏流程和宿主平台。

### PDF

PDF 来源、页面写入、排版或译文生成变化时，按影响选择：

- `src/backend/file/pdf/` 中的目标测试。
- `agent-workspace-page-write` 与工作区 `service.test.ts`。
- 数据库和 `ProjectWriteStore` 的来源、事务测试。

[pdf-worker.test.ts](../src/backend/file/pdf/pdf-worker.test.ts) 验证独立部署线程的计算、打印回调、取消与重启。

[pdf-host.test.ts](../src/native/pdf-host.test.ts) 验证真实 Electron 打印与取消。集成测试入口自动准备工作区依赖和打印资源：

```powershell
npm test -- --project integration src/native/pdf-host.test.ts
```

- 验证发行资源时，通过 `LINGUAGACHA_TEST_WORKSPACE_RUNTIME` 指定工作区目录。
- `LINGUAGACHA_PDF_QA_DIR` 指定视觉检查产物目录。
- 发行包打印资源见 [发行包运行验证](#发行包运行验证)。

### 热更新与 Windows 工具

renderer 热更新或运行态刷新变化时，运行 `npm run dev`。保存文案和 React 组件后检查内容更新与交互状态保留，保存共享运行态模块后检查整页重载与状态重建。

Windows 启动器或更新器变化时，在对应的 `cli` 或 `berserker` Go module 中执行 `go test ./...`。更新器进程测试须在 Windows 执行。

## 📦 构建与发布产物

构建、Vite、electron-builder、`afterPack` 或发布资产变化时，运行 `npm run build`。

- 统一资源入口：`node buildtools/resources/build.mjs [输出根目录] [--development]`。发行资源默认生成到 `build/resources/`。`--development` 默认生成到 `build/dev/resources/`。自定义输出放在仓库外。
- 开发和仓库外集成测试使用 `--development` 准备宿主原生工具。发行构建由 `afterPack` 部署目标架构的工具。
- 资源规则和构建边界通过上述资源入口与 `npm run build` 验证，并检查下列产物与消费入口。

按影响范围检查产物：

- 使用 `npm exec -- asar list <app.asar 路径>` 检查应用入口、前端资源及文件范围。用户数据、项目源码和原始应用依赖树应排除。
- Electron 语言资源与 `LOCALES` 一致。
- `builtin/`、`fonts/`、`workspace/` 和 `pdf-print.css` 位于发行 `resources/`。`app.asar` 不含 `builtin/` 和字体。
- 工作区包含应用依赖清单、标准 `node_modules`、公开 `@lg/*`、共享 `chunks/` 和私有 `runtime/`。应用包不导出 bootstrap、准备程序或 PDF worker。
- `seed/` 只包含用户第三方依赖，清单、锁文件和安装树中均不包含 `@lg/*`、`mupdf` 或应用包归档。工作区只部署一份应用使用的 MuPDF 包与 WASM。
- `runAsNode` fuse 保持开启，供工作区启动 Electron Node 子进程。
- Windows 启动器和更新器完成对应 Go module 的测试与构建。

Ren’Py 解析测试自动准备所需资源。发行解析资源使用下方 `prepare-worker.test.ts` 入口验证。

根安装使用 `npm ci`，保证依赖来源可复现。

npm 直接依赖使用 `^` 范围，Pi 同仓库包使用精确版本。其它精确版本须有具体兼容理由。

安装时保留 optional dependencies，`tsrs` 需要其中与构建宿主匹配的原生包。选择原生包依据宿主 Node 架构，与 Electron 的打包目标架构无关。

`afterPack` 中的测试、构建或复制失败都会终止打包。

部署相关测试按变化选择：

|变化|验证入口|
|---|---|
|工作区依赖部署|统一资源入口，以及 [npm SDK](../src/backend/agent/npm/index.test.ts) 与 [bootstrap](../src/backend/agent/workspace/runtime/bootstrap.test.ts) 的仓库外集成测试|
|工作区入口定位|[workspace-runtime.test.ts](../src/native/workspace-runtime.test.ts)|
|应用入口与合并后的 SDK|[index.test.ts](../src/index.test.ts) 的仓库外 ASAR 集成测试|
|部署后的工作区执行|仓库外 Electron bootstrap 集成测试|

### 发行包运行验证

先执行 `npm run build`，再用环境变量把真实 Electron 集成测试指向发行产物：

|变量|指向|使用的测试|
|---|---|---|
|`LINGUAGACHA_TEST_RESOURCES`|发行包 `resources` 目录|`app-resources.test.ts`|
|`LINGUAGACHA_TEST_ELECTRON`|发行包可执行文件|`bootstrap.test.ts`、`javascript.test.ts`、`ruby.test.ts`、`prepare-worker.test.ts`|
|`LINGUAGACHA_TEST_WORKSPACE_RUNTIME`|发行包工作区运行目录|`bootstrap.test.ts`、`javascript.test.ts`、`ruby.test.ts`、`pdf-host.test.ts`、`prepare-worker.test.ts`|
|`LINGUAGACHA_TEST_GAME_WORKER`|发行 ASAR 内的 `build/dist-electron/game-prepare-worker-entry.js`|`prepare-worker.test.ts`|

- `pdf-host.test.ts` 只设置工作区运行目录，使用默认开发 Electron。
- 资源部署或字体路径变化时，按上表指向发行包运行 `app-resources.test.ts` 与 `pdf-host.test.ts`。两者分别验证界面与 PDF 加载同一份字体。
- 脚本解析器部署还须核对发行工作区中的 `oxc-parser` 平台绑定与 `@ruby/prism` WASM，以及 `web-tree-sitter` 和 `python/tree-sitter-python.wasm`。Python 语法包的原生 addon 不部署。

### Agent 共享执行环境

- 环境准备、执行时限与错误回执：`npm test -- src/backend/agent/execution src/backend/agent/node`。
- npm SDK 与模型声明：`npm test -- src/backend/agent/npm`。
- uv SDK 与模型声明：`npm test -- src/backend/agent/uv src/backend/agent/workspace/runtime/command.test.ts`。
- SDK 加载、原生 IPC 与 uv 发布链：`npm test -- src/backend/agent/workspace/runtime/bootstrap.test.ts`。Python 验收自动准备并缓存解释器，首次运行需要联网。用例使用本地 wheel 验证环境搬移和后代进程取消。
- MuPDF 实例与字节边界：`npm test -- src/backend/file/pdf/pdf-document.test.ts`。
- 默认代理与连接关闭：`npm test -- src/backend/network/workspace-proxy.test.ts`。
- 进程监管器 `supervisor`：在 `buildtools/builder/supervisor/` 执行 `go test ./...`，Windows 覆盖租约、正常退出后的后代回收和保留旧 Job 句柄的接管。
- Windows Node 启动器：在 `buildtools/builder/node/` 执行 `go test ./...`，验证 Unicode、空参数、stdio 和退出码。
- 构建变化执行 `npm run build`，再设置上表的发行可执行文件与工作区目录，运行 `npm/index.test.ts` 和 `bootstrap.test.ts`。检查 npm 运行文件、可搬移种子及目标架构的辅助程序。
- uv 部署通过资源构建与上述 uv 集成测试验证。发行工作区 `bin/<platform>-<arch>/uv[.exe] --version` 应与 `workspaceRuntimeTools.uv` 一致。Windows 发行验收运行上述工作区集成测试。
- aria2 部署通过资源构建验证，运行时同步使用 `npm test -- src/backend/agent/execution` 验证。`bootstrap.test.ts` 验证命令与应用代理的接入。发行验收通过工作区执行 `aria2c --version`，版本应与 `workspaceRuntimeTools.aria2` 一致。
- macOS/Linux 须在对应平台验收共享锁描述符、进程组启动门、正常收尾、停止及监管程序退出。跨平台编译只能证明代码可构建，不能替代平台生命周期实测。
