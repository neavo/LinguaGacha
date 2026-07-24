# LinguaGacha 前端权威边界

本文只回答 Electron / preload / renderer 接入、传输入口、共享运行态、页面 query、导航、session UI 状态和样式消费落点。后端协议权威归 [`BACKEND.md`](BACKEND.md)；产品语义与视觉方向不在工程长期文档中定义。

## 1. 宿主与传输

- renderer 只能通过 `window.desktopApp` 接触宿主能力，不直接导入 Electron、Node、`src/native`、preload 或 backend 实现。
- 后端传输统一收口到 `src/frontend/app/desktop/desktop-api.ts`；页面可以直接调用其 `api_fetch`，也可以在页面目录建立领域适配器，但不直接创建后端 `fetch` 或 `EventSource`。
- `desktop-api.ts` 统一处理 API base URL、health probe、响应壳、SSE、本地网络错误、renderer 诊断、日志详情和 GitHub release 请求。
- `DesktopApiError` 是 API 与本地网络失败的统一错误；用户可见文案从稳定 `message_key` / `details` 解析，页面只在确有恢复分支时按稳定 `code` 判断，不解析原始异常文本。
- renderer 诊断只上报实际异常摘要与 route / project / task / event 白名单上下文，不上报完整 items / files、页面自定义对象或原始路径 / URL。
- 日志列表只保存 `log.appended` 轻量事件，选中后再读取当前进程详情；普通页面、toast 和空状态不展示调用栈或原始异常。
- 持久化 `AppLanguage` 只在 `src/domain/app-language.ts` 投影为 renderer `Locale`；可见文案从 `src/shared/i18n` 解析，React Provider 只消费已解析的 locale。

## 2. 主窗口运行态

- `DesktopStateProvider` 是主窗口项目身份、任务、设置、事件流和写入结果的共享状态入口；日志窗口不启动该运行态，只读取语言并消费日志流。
- 初始状态并行读取设置、项目 snapshot 与任务 snapshot；renderer 启动、热更新或整页重载不通过关闭工程重置后端会话。
- 项目身份由 `path + epoch + phase` 守护；项目切换、同路径重新初始化、迟到事件和首刷期间暂存事件都经过同一身份闸门。
- `TaskSnapshotStore` 只缓存后端完整 task snapshot，并用 `run_revision` 丢弃旧值；task 不进入项目 query 或页面计算缓存。
- settings 只由后端设置载荷同步，task 只由后端 snapshot 或命令 ack 同步，project identity 只由后端项目载荷同步。
- HTTP 写入结果与 `project.data_changed` SSE 共用同一事件入口、去重窗口和恢复策略；共享层只生成轻量 `ProjectChangeSignal`，页面根据目标 section 重新 query。
- `DesktopRefreshScheduler` 只合并可延迟的 task snapshot 和项目刷新信号；项目切换、设置刷新、写入结果和任务终态先冲刷窗口。
- flush、SSE 或写入处理失败进入 renderer 诊断，并通过可等待、可去重的权威 query 恢复；当前项目的有效事件不静默丢弃。

## 3. 页面、导航与 session 状态

- 前端实体和值对象从 `src/domain` 导入，跨运行时纯规则和协议词表从 `src/shared` 导入；最终项目事实计算只属于后端。
- 功能 query 归消费页面所有；页面状态保存 query 参数、结果窗口、缓存身份和交互态，需要全量事实的搜索、统计、排序和写入计算由后端 query / command 提供。
- query 顶层 `sectionRevisions` 是页面写入和任务命令的乐观锁来源；功能域局部 revision 只服务 cache 身份，不能替代操作 revision。
- 页面写入只提交用户意图、设置镜像、显式 operation 与 query 返回的 revision，不提交前端计算出的 canonical facts。
- `SCREEN_REGISTRY` 是页面注册与标题 key 的唯一入口。
- `ProjectSessionUiStateProvider` 只保存当前项目内可跨路由恢复的轻量 UI 状态，项目切换或关闭时清空，不写入后端事实。
- `WorkbenchTasksSessionProvider` 保存翻译 / 分析完成后的跨路由 follow-up；页面计算缓存、弹窗、导入和提交中状态默认随页面挂载与卸载。
- `src/frontend/widgets/interactions` 只承接通用交互与快捷键，不依赖 app state、页面领域、桌面桥、后端 API 或 SSE。
- 新代码按所有者进入 `app`、`pages`、`widgets`、`styling`、`src/shared` 或 `src/domain`，不新建无主的顶层技术工具桶。

## 4. 样式消费

- 本文不定义视觉风格，只记录工程消费落点；具体方向来自当前任务输入、既有界面证据和适用设计流程，不绑定固定文件名。
- `src/frontend/index.css` 拥有全局 token 与主题入口，`src/frontend/shadcn` 拥有基础控件，`widgets` 与 `pages` 只组合工作面和局部页面状态。
- `npm run check` 是前端分层、可见文案与样式消费边界的机器门闩，验证选择见 [`WORKFLOW.md`](WORKFLOW.md)。

## 5. 更新条件

宿主契约、传输入口、共享状态所有权与生命周期、事件恢复、页面 query / 写入边界、导航入口或样式消费落点变化时更新本文；后端协议更新 [`BACKEND.md`](BACKEND.md)，单纯视觉方向变化不触发本文更新。
