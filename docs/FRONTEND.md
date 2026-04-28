# LinguaGacha 前端文档

## 一句话总览
`frontend/` 是 LinguaGacha 的 Electron + React 子工程。本文回答四个问题：`main / preload / shared / renderer` 的边界是什么，`window.desktopApp` 与 `desktop-api.ts` 为什么是唯一入口，`ProjectStore` 如何消费 bootstrap 与 `project.patch`，以及页面、widget、shadcn、样式与导航各该落在哪一层。

## `main / preload / shared / renderer` 边界

```mermaid
flowchart LR
    A["src/main"] --> B["src/preload"]
    A --> C["src/shared"]
    B --> D["window.desktopApp"]
    D --> E["src/renderer"]
    E --> F["api/"]
```

| 层 | 职责 | 不该做什么 |
| --- | --- | --- |
| `src/main` | Electron 宿主、窗口、标题栏、原生对话框、外链打开、开发态调试端口、Python Core 伴生进程生命周期 | 不持有页面状态，不组织页面业务 HTTP 请求，不写 React 逻辑 |
| `src/preload` | 通过 `contextBridge` 暴露 `window.desktopApp` | 不维护页面缓存，不承载 UI 状态 |
| `src/shared` | 跨端共享契约、桌面壳层常量、Core API 地址解析 | 不放页面语义或业务组件 |
| `src/renderer` | React 页面、导航、状态编排、组件与样式实现 | 不绕过 bridge 直接碰 Node / Electron |
| `src/test` | Vitest 测试装配 | 不承担运行时代码路径 |

稳定事实：
- `frontend/package.json` 是前端命令入口，稳定命令包括 `dev`、`build`、`format`、`format:check`、`lint`、`test`、`renderer:audit`。
- `electron.vite.config.ts` 固定 renderer root 为 `src/renderer`，开发态 host 固定为 `127.0.0.1`。
- `src/main/index.ts` 在开发态打开 Chromium remote debugging 端口 `9222`，方便 Electron 真机调试与自动化。
- `src/main/core-lifecycle/` 是 Python Core 伴生进程生命周期的唯一前端侧落点；Electron main 从启动根目录优先拉起平台 Core helper（Windows 为 `core.exe`，macOS / Linux 为 `core`），不存在时回退到 `uv run app.py`。
- `src/main/index.ts` 中用于查找 `dist/`、`public/` 的是前端 bundle 根，不是应用根；应用根语义只用于 `CoreLifecycleManager.appRoot` 和 Python Core 的 `APP_ROOT`。
- 打包产物把 PyInstaller 生成的 Core helper、`_internal/`、`resource/` 与 `version.txt` 放在应用根目录；Windows / Linux 应用根是 Electron 可执行文件所在目录，macOS 应用根是 `.app/Contents/MacOS`。

## `window.desktopApp` 与 `desktop-api.ts` 的唯一入口约束

### `window.desktopApp`
- `src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld("desktopApp", ...)` 暴露宿主能力。
- 对渲染层公开的稳定能力包括：
  - `shell`
  - `coreApi.baseUrl`
  - 文件 / 目录选择
  - 外链打开
  - 独立日志窗口打开 / 聚焦
  - 标题栏主题同步
  - 窗口关闭确认请求订阅
  - `getPathForFile()`

### Core API 地址来源
- 应用正常启动时，Electron main 的 `CoreLifecycleManager` 会先在高位端口范围内选择本机端口，再从启动根目录启动 Python Core，校验 `/api/health` 返回的实例 token，最后把实际地址写入 `LINGUAGACHA_CORE_API_BASE_URL`。
- `src/shared/core-api-base-url.ts` 按固定顺序解析 Core API 地址：
  1. 环境变量 `LINGUAGACHA_CORE_API_BASE_URL`
  2. 启动参数 `--core-api-base-url=...`
  3. 默认地址 `http://127.0.0.1:38191`
- 渲染层不会盲信这个地址；`desktop-api.ts` 仍会先请求 `/api/health` 做探活确认。
- 开发态应用根优先取 npm 保留的原始目录 `INIT_CWD`，不存在时回退到 Electron 主进程当前工作目录；打包态应用根固定为 Electron 可执行文件所在目录。`LINGUAGACHA_UV_BIN` 只在应用根没有平台 Core helper、回退到 `uv run app.py` 时覆盖 uv 路径，不暴露给 renderer 作为运行态状态。

### `desktop-api.ts`
- 它是渲染层访问 Core API 的唯一 HTTP / SSE 入口。
- 页面不要重新发明第二套 `fetch` 包装、`EventSource` 接入或健康检查逻辑。
- 如果你要改 HTTP 路径、bootstrap 事件、SSE topic 或 `ProjectMutationAck` 对齐逻辑，必须联读 [`API.md`](./API.md)。
- bootstrap 流消费者当前会监听 `stage_started`、`stage_payload`、`stage_completed`、`completed`，并为未来兼容预留 `failed` 监听。
- 独立日志窗口只通过 `desktop-api.ts` 的 `/api/logs/stream` 订阅 `log.appended`，不消费 `/api/events/stream`，也不把日志写进 `ProjectStore`。

## 独立日志窗口

- Electron main 通过 `window.desktopApp.openLogWindow()` 维护日志窗口单例；主窗口项目 warmup ready 后只在侧栏日志入口显示红点提醒，不自动打开日志窗口。侧栏日志入口在窗口隐藏时显示并聚焦，窗口已显示时关闭，点击入口会清除本次提醒，关闭日志窗口不关闭主窗口。
- 日志窗口复用同一个 renderer bundle，通过 `?window=logs` 进入日志模式；该模式不渲染主工作台 sidebar，也不注册为导航屏幕。
- 主窗口侧栏底部动作区提供日志入口；入口只调用 preload 暴露能力，不直接触碰 Electron / Node。
- 日志窗口主体复用 `widgets/app-table` 展示时间和消息摘要，级别以前缀形式并入消息列；选中行在详情区展示完整纯文本 `message`。
- 日志窗口的筛选、搜索、正则模式、自动滚动和详情区展开都是窗口本地状态，不属于项目运行态。

## 运行态消费与 `ProjectStore`

```mermaid
flowchart TD
    A["desktop-api.ts"] --> B["/api/project/bootstrap/stream"]
    B --> C["createProjectBootstrapLoader.bootstrap()"]
    C --> D["ProjectStore.applyBootstrapStage()"]
    E["/api/events/stream"] --> F["DesktopRuntimeContext"]
    F --> G["ProjectStore.applyProjectPatch()"]
    G --> H["workbench_change_signal / proofreading_change_signal"]
```

### `ProjectStore` 的职责
- `frontend/src/renderer/app/project/store/` 负责把 bootstrap 流与 `project.patch` 收口成渲染层可消费的最小项目运行态。
- 稳定 section 固定为：`project`、`files`、`items`、`quality`、`prompts`、`analysis`、`proofreading`、`task`。
- `revisions` 额外维护 `projectRevision` 与 `sections[stage]`。
- 质量规则统计常驻缓存不进入 `ProjectStore`；应用层的 `QualityStatisticsProvider` 会在 warmup ready 后预热四类统计，并由规则页通过 `useQualityStatistics(ruleType)` 消费。

### bootstrap 落地规则
- `files` 使用 `rel_path` 作为 key。
- `items` 使用 `item_id` 作为 key。
- `quality`、`prompts`、`analysis`、`proofreading`、`task` 以对象快照写入对应 section。
- bootstrap 完成时，`completed` 事件补回 revision 信息。

### 本地 patch 与服务器 patch
- `DesktopRuntimeContext` 通过 `commit_local_project_patch(...)` 暴露渲染层唯一的本地运行态写入口。
- 同步 mutation 的成功路径是“本地 patch -> HTTP 持久化 -> `align_project_runtime_ack(...)`”。
- 失败路径是“回滚 -> `refresh_project_runtime()`”。
- 服务器 `project.patch` 与本地 patch 共用 `ProjectStore.applyProjectPatch(...)` 后处理。
- 服务端高频 `project.patch` 先进入 `LiveRefreshScheduler`，flush 时按原顺序批量应用到 `ProjectStore`，再合并发出工作台与校对页 change signal；本地 `commit_local_project_patch(...)` 仍即时应用、即时回滚。

### 页面变更信号

| 信号 | 稳定载荷 / 模式 | 主要消费者 |
| --- | --- | --- |
| `workbench_change_signal` | 当前稳定发出 `global` / `file` | 工作台页 |
| `proofreading_change_signal` | 当前稳定发出 `full` / `delta` / `noop`，并携带 `updated_sections` 与 `item_ids` | 校对页 |

补充说明：
- `project.changed`、`task.*`、`settings.changed` 与 `project.patch` 都由 `DesktopRuntimeContext` 收口，再决定是否刷新页面派生状态。
- 若 `project.patch` 载荷不合法，当前实现会回退为 `refresh_project_runtime()`，而不是让页面直接猜测修复策略。
- 工作台与校对页在工程切换后都会先清空本地快照，再等待各自的 change signal 驱动首次有效刷新；不会在空 `ProjectStore` 上做 eager refresh。
- 实时 UI 刷新统一由前端 `LiveRefreshScheduler` 在入站侧合帧，频率由 `APP_LIVE_REFRESH_INTERVAL_MS` 控制；服务端 `project.patch`、任务进度、日志流与工作台任务波形共享这条节奏，本地同步 mutation、项目切换、非法 patch fallback 与任务终态仍走即时路径。
- `ProjectPagesProvider` 当前把 `project_warmup` 定义为“工作台首屏已基于本次 bootstrap 完成刷新”，`wait_for_barrier("project_warmup", { checkpoint })` 会要求工作台 `last_loaded_at` 晚于该 checkpoint；校对页缓存仍通过独立 barrier 维护。
- `ProjectPagesProvider` 只消费页面运行态 adapter 暴露的缓存状态和 barrier 字段；工作台、校对页自己的 hook 仍归页面侧维护，`app/runtime` 不直接导入页面私有 hook。
- 校对页只把 `project / items / quality` 视为后台派生真实输入；`prompts`、`analysis` 单独变化不会触发校对缓存失效，`proofreading / task` 仅在没有 item 载荷时发 `noop`。
- 校对页把 `ProjectStore` 原始状态同步到独立 worker cache：`hydrate_full` 负责项目级全量同步，`apply_item_delta` 只重算变更条目，`build_list_view` 生成 `view_id` 与 worker 内的有序 row id 索引，`read_list_window` 只回传当前表格窗口 rows，`read_row_ids_range` / `read_items_by_row_ids` 供跨窗口选择、批量操作和编辑弹窗按需取数；warnings、默认 filters、筛选 facets、排序结果与当前视图索引都由 worker 持有，主线程只保留窗口 rows、选区、游标、弹窗等轻状态。
- 工作台页收到 `merge_items` 合并后的 delta 时优先更新本地增量缓存；首次 bootstrap、项目 / 文件替换、分析摘要缺失或结构异常时回退全量重建。校对页同窗口 `full` 覆盖 `delta`，纯 `noop` 不触发列表与筛选面板查询。
- 校对页是否可交互只看自己的缓存状态，稳定语义是 `cache_status === "ready"` 且 `!is_refreshing`；其中 `proofreading_cache_refresh` 的 ready 定义是“当前列表查询已结算，且 `current_filters` 对应的筛选面板已预热完成”，可操作条件独立于 `project_warmup`。
- glossary / pre-replacement / post-replacement / text-preserve 四类质量统计由常驻 `QualityStatisticsProvider` 统一调度：项目 warmup ready 后先全预热，后续比较统计依赖签名（项目相关文本、规则 key 与 descriptor 依赖字段）决定是否后台刷新；规则页通过 provider 消费统计，不创建独立 worker 或维护统计刷新 effect。

## 页面 / widget / shadcn / 样式归属

| 路径 | 稳定职责 | 归属规则 |
| --- | --- | --- |
| `app/` | 应用层入口、导航、壳层组件、应用运行态、项目事实仓库、项目派生与质量统计 | 需要全局上下文、bridge 接缝、统一运行态或项目领域规则时留在这里；除导航注册表外，不直接依赖页面私有实现 |
| `app/runtime/` | 桌面运行态、项目页面 barrier、toast 运行态 | 只放应用生命周期、上下文和页面注册边界需要的窄接口，不承载项目事实派生规则 |
| `app/project/store/` | `ProjectStore`、bootstrap loader、项目条目文本采集 | 渲染层项目事实的权威仓库与 bootstrap 消费入口 |
| `app/project/derived/` | 项目 prefilter、翻译 / 分析重置、分析术语导入规划 | 只放基于项目事实生成 mutation 或派生计划的规则 |
| `app/project/quality/` | 质量规则运行态、统计 worker、统计缓存与 provider | 质量规则切片与统计缓存归这里，页面只消费 provider 或纯函数 |
| `pages/` | 页面入口、页面私有组件、页面 CSS、页面私有 hook 与辅助模块 | 每个页面目录以 `page.tsx` 为入口，不被其他页面反向依赖；页面派生视图与页面 mutation planner 留在对应页面目录 |
| `widgets/` | 跨页面复用的组合组件 | `app-table`、`command-bar`、`setting-card-row`、`app-dropdown-menu`、`app-context-menu` 等稳定组合层放这里；`app-table` 对外保留 `rows` 兼容入口，内部统一归一为 row model 消费数组与校对页远程窗口行来源 |
| `shadcn/` | shadcn CLI 管理的基础组件源码 | 业务组合组件与应用默认视觉不得混入；菜单类项目默认样式走 `widgets/app-*-menu` |
| `hooks/` | 跨页面复用的交互 hook | 不承载页面语义 |
| `i18n/` | 文案资源与翻译入口 | 长期文案不写进组件体内 |
| `lib/` | 无页面语义的纯逻辑工具 | 不承载 UI 或页面状态 |

样式边界：
- `index.css` 只承载全局 token、主题变量、浏览器重置和第三方运行时皮肤。
- 页面私有样式放在页面目录并由页面入口导入。
- widget 私有样式由 widget 自己维护，不把页面语义回写到全局。
- 渲染层执行 `px-first`：字面量长度优先 `px`，`line-height` 用无单位数值，`letter-spacing` 仅允许 `em`。
- `npm run renderer:audit` 通过 `frontend/scripts/check-renderer-design-system.mjs` 自动拦截可稳定判定的 token 越权、`rem` 尺寸字面量和已接入门闩的基础视觉越权；新增例外前先回到 [`DESIGN.md`](./DESIGN.md) 判断是否属于长期设计语义变化。

## 导航与页面映射中不显然的规则

导航权威来源固定为三处：
- `app/navigation/types.ts`
- `app/navigation/schema.ts`
- `app/navigation/screen-registry.ts`

补充规则：
- `screen-registry.ts` 是 `app/` 中唯一允许直接导入页面入口和页面运行态 adapter 的文件；其它 `app/` 模块如果需要页面缓存状态，只消费 `ProjectPagesProvider` 提供的窄接口。
- 工作台任务 UI 运行态只归 `pages/workbench-page/task-runtime/`，翻译 / 分析任务模型与波形工具不从 `app/` 或 `lib/` 暴露。

稳定但不显然的映射如下：

| 路由 / 节点 | 真实落点 | 维护含义 |
| --- | --- | --- |
| `project-home` | `pages/project-page/page.tsx` | 默认落地页，但不在侧边栏分组里显示 |
| `text-replacement` | 仅侧边栏父节点 | 没有独立屏幕 |
| `custom-prompt` | 仅侧边栏父节点 | 没有独立屏幕 |
| `pre-translation-replacement` / `post-translation-replacement` | 同一个 `TextReplacementPage`，靠 `variant` 区分 | 不要再建平行页面目录 |
| `translation-prompt` / `analysis-prompt` | 同一个 `CustomPromptPage`，靠 `variant` 区分 | 不要再建平行页面目录 |
| `toolbox` | `pages/toolbox-page/page.tsx` | 百宝箱一级入口页；工具二级页不在侧边栏注册 |
| `name-field-extraction` | `pages/name-field-extraction-page/page.tsx` | 从 `ProjectStore.items` 的 `name_src/src` 本地派生姓名表；单条 LLM 翻译只走 `desktop-api.ts` 调 `/api/tasks/translate-single`，导入术语表复用质量规则同步 mutation |
| `ts-conversion` | `pages/ts-conversion-page/page.tsx` | 从 `ProjectStore.items / quality.text_preserve` 本地派生转换结果；OpenCC 与文本保护分段在 TS 侧执行，Python Core 只提供预置保护规则读取与文件写出 |

## 前端与 API / DESIGN 的接缝

| 你在改什么 | 先联读哪份文档 |
| --- | --- |
| HTTP 路径、bootstrap、SSE topic、`ProjectMutationAck` | [`API.md`](./API.md) |
| 视觉 token、页面骨架、组件语义 | [`DESIGN.md`](./DESIGN.md) |
| Python Core 状态拥有者、同步 mutation 的真实持久化落点 | [`DATA.md`](./DATA.md) |

## 什么时候必须更新本文

- `main / preload / shared / renderer` 分层边界变化
- `window.desktopApp` 暴露能力或 `desktop-api.ts` 唯一入口约束变化
- `ProjectStore` section、本地 patch 提交流程、页面变更信号规则变化
- 导航结构、页面映射、目录职责或样式归属边界变化
