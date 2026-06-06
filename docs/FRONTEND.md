# LinguaGacha 前端权威边界

本文只回答 Electron / preload / renderer、后端 API 接入、共享状态、页面 query、导航、诊断与样式消费边界。后端协议权威归 [`BACKEND.md`](BACKEND.md)，产品语义和视觉规范不在本文展开。

## 1. 桌面宿主与 API 接入

- renderer 只能通过 `window.desktopApp` 接触宿主能力，不得直接导入 Electron、Node、`src/native`、preload 实现或后端内部实现。
- 后端 API 访问收口到 `src/frontend/app/desktop/desktop-api.ts`，页面不直接 `fetch('/api/*')`，也不直接创建后端 `EventSource`。
- `desktop-api.ts` 负责 Backend API base URL 归一、`/api/health` 探测、POST 响应壳解析、SSE 打开、本地网络错误、renderer 诊断提交、日志详情读取和 GitHub release 检查。
- `DesktopApiError` 是前端消费后端 API 与本地网络失败的唯一错误类型，页面根据 code / status / action 决定刷新、重试、禁用或跳转，不解析后端原始异常文本。
- renderer 异常诊断只能通过 `/api/diagnostics/renderer-error` 写日志，只上报实际抛错摘要、route / project / task / event 轻量上下文和白名单字段，不上报完整 items/files payload、页面自定义对象或原始路径 / URL。
- 日志窗口只把 `log.appended` 的轻量事件放入列表，完整正文通过 `/api/logs/detail` 按选中行懒加载，不能进入列表筛选、排序或批量渲染路径。
- 日志窗口是 renderer 内唯一可展开结构化错误和调用栈的诊断视图，普通页面、toast 和空状态不得展示调用栈或原始异常文本。
- 可见文案从 `src/shared/i18n` 解析，React Provider 与富文本适配在 `src/frontend/app/locale`。

## 2. 主窗口运行态

- `DesktopStateProvider` 是主窗口项目、任务、设置、事件流和写入结果的唯一共享状态入口，日志窗口不启动该运行态，只轻量读取语言并消费日志流。
- 初始状态并行读取 `/api/settings/app`、`/api/session/project/snapshot`、`/api/tasks/snapshot`，renderer 启动、热更新或整页重载不得通过关闭工程来“重置”后端会话。
- 项目身份由 `path + epoch + phase` 守护，项目切换、同路径重新初始化 session、迟到事件和首刷期间事件队列都必须经过该身份闸门。
- `TaskSnapshotStore` 只缓存后端完整 task snapshot，并用 `run_revision` 丢弃旧 snapshot，task 不进入项目 query 或页面计算缓存。
- settings 只能由后端设置载荷同步，task 只能由后端 task 载荷或任务命令 ack 同步，project identity 只能由后端项目载荷同步。
- HTTP 写入结果与 `project.data_changed` SSE 共用同一项目事件入口、去重窗口和恢复策略，页面只消费轻量 `ProjectChangeSignal`，具体事实由自身 query 重新读取。
- 页面按 section 响应项目变更时统一使用 `app/state/project-change-signal` 判断，未命中目标 section 的信号不得推进页面 query 依赖序号。
- `DesktopRefreshScheduler` 只合并可延迟的 task snapshot 和项目刷新信号，项目切换、设置刷新、写入结果和任务终态必须先冲刷窗口。
- flush、SSE 和写入异常必须进入 renderer 诊断，并通过 recovery 触发可等待、可去重的后端权威 query 恢复，当前项目有效事件不能静默丢弃。

## 3. 页面 Query 与写入

- 前端消费的数据实体和值对象从 `src/domain` 导入，跨运行时纯规则和协议词表从 `src/shared` 导入，最终项目写入计算算法只属于后端，前端不导入或复刻。
- 页面读取项目事实只能通过本页面目录内 `*-api-client.ts` 包装的功能域 query API，页面状态只保存 query 参数、query 结果、窗口缓存和交互态。
- query response 顶层 `sectionRevisions` 是页面写入和任务命令的乐观锁来源，功能域返回的轻量运行态 revision 只服务局部 cache 身份，不能替代操作 revision。
- 页面写入只能提交用户意图、设置镜像、显式 `operation` 和后端 query 返回的 revision 依赖，不能把计算出的 items、task extras、prefilter config 或 analysis extras 当后端事实提交。
- 校对页搜索、筛选、排序、窗口、警告和 cache sync 由后端校对 query 提供，前端只保存参数、view id、窗口结果、选择和编辑态。
- 质量规则页面的规则事实读取只响应 `quality` section，`items` 变化留给统计和结果刷新路径消费。
- 质量规则统计的全量匹配计算由后端 query 提供，前端共享缓存只保存规则描述、调度阶段、已完成结果和订阅状态；统计失效按规则文本源判断，无法判定文本源范围时全量失效。
- 结果型页面的主列表快照只在显式搜索、筛选、替换、排序或刷新 action 时生成新 id 序列，项目事实刷新只更新快照内实体内容、状态、警告和统计，不自动重排当前 view。

## 4. 导航、Session 与页面 UI 状态

- `SCREEN_REGISTRY` 是页面注册和标题 key 的唯一入口，新增页面先进入注册表，再接入对应页面状态。
- `ProjectSessionProvider` 只提供项目 session ready、当前项目 UI 轻状态和文件操作等待，它不登记页面缓存 barrier，也不阻塞页面 query 刷新。
- `ProjectSessionUiStateProvider` 只保存当前项目 session 内可跨路由恢复的轻量页面 UI 状态，项目切换或关闭时清空，不写入后端事实。
- `WorkbenchTasksSessionProvider` 常驻项目 session 内，拥有翻译 / 分析任务完成后的生成译文、导入术语和确认意图，任务 follow-up 不属于工作台页面缓存，不能随工作台页面卸载而丢失。
- 页面计算缓存、弹窗、确认框、导入状态和提交中状态随页面挂载创建、随卸载释放，只有登记到 session UI state 的轻量状态可在当前项目 session 内跨路由保留。
- `src/frontend/widgets/interactions` 只承接通用 UI 交互行为和快捷键规则，不得依赖 app state、页面领域、桌面桥、后端 API 或 SSE。
- `src/frontend/hooks` 与 `src/frontend/lib` 不再作为前端顶层入口，新增代码按所有者归入 `app`、`pages`、`widgets`、`styling`、`src/shared` 或 `src/domain`。

## 5. 样式与设计消费

- 设计权威不在本文，涉及产品语义看 `PRODUCT.md`，涉及视觉和交互规范看 `DESIGN.md`。
- 全局 `--ui-*` token 的稳定落点是 `src/frontend/index.css`，页面和组件不得定义并行全局 token。
- app、pages、widgets 范围内的尺寸字面量优先使用 px，需要 rem 或新的长期视觉语义时，先回到 `DESIGN.md` 判定。
- shadcn 基础组件承载基础视觉边界，页面 CSS 只写页面布局和局部组合状态，不重新定义基础组件核心背景、边框、圆角、阴影等视觉。
- 前端静态检查会拦截可见中文硬编码、后端 API 直连、GUI 契约越界、共享状态内部写入口越权、废弃顶层入口、`widgets/interactions` 越权、`--ui-*` token 越界和 rem 尺寸字面量。

## 6. 更新触发条件

- 改 preload 暴露能力、`window.desktopApp` 类型、GUI 契约白名单、IPC、后端 API 或本地路径接入方式，更新本文。
- 改 `desktop-api.ts` 的 health probe、响应壳、错误、本地网络错误、SSE、日志、renderer 诊断或外部网络检查语义，更新本文。
- 改项目身份、session 初始化、写入结果、payload mode、revision 来源、事件去重或页面 query 恢复策略，更新本文并同步 [`BACKEND.md`](BACKEND.md)。
- 改 `app/state`、导航注册、session provider、页面计算缓存、项目 UI 状态、后端校对 query 消费方式或质量规则统计缓存，更新本文。
- 改 i18n、可见文案、样式 token、px-first、基础组件视觉边界或设计系统消费方式，更新本文，产品 / 设计权威仍回到 `PRODUCT.md` / `DESIGN.md`。
