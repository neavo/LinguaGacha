# LinguaGacha 前端权威边界

本文只回答 Electron / preload / renderer 接入、传输入口、共享运行态、页面 query、导航、session UI 状态和样式消费落点。后端共享协议归 [`BACKEND.md`](BACKEND.md)，产品 Agent 的跨层消费契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)；产品语义与视觉方向不在工程长期文档中定义。

## 1. 宿主与传输

- renderer 只能通过 `window.desktopApp` 的按用途窄接口接触宿主能力，不直接导入 Electron、Node、`src/native`、preload 或 backend 实现；原生路径选择在 preload / main 之间统一收口为单一判别联合 IPC，页面不传 Electron 对话框选项。
- renderer 通过无参数的 `requestUserAttention` 请求桌面注意力；是否播放系统提示音与闪烁窗口由 main 按所属窗口焦点决定，renderer 不传业务文案或任务字段。
- 主进程按 Chromium 编辑语义为主窗口和日志窗口提供原生文本菜单；renderer 不新增菜单 IPC 或页面私有实现。
- Agent Markdown 直接渲染原始 HTML 与图片；链接点击统一交给宿主外部打开，URL 语义由 Markdown 渲染链和宿主处理。
- 后端传输统一收口到 `src/frontend/app/desktop/desktop-api.ts`；页面和跨页面 feature 可以直接调用其 `api_fetch`，也可以在各自所有权目录建立领域适配器，但不直接创建后端 `fetch` 或 `EventSource`。
- Electron main 只在 Backend Runtime ready 后创建窗口并注入本次运行的 API base URL；`desktop-api.ts` 直接使用该地址处理响应壳、SSE、本地网络错误、renderer 诊断、日志详情和 GitHub release 元数据请求，`/api/health` 只读取版本元数据，不作为其它请求的前置门禁。renderer 的 release 请求与 Electron main 的 release zip 下载都复用默认 session 的 Chromium 网络栈并随其当前系统代理，loopback Backend API 保持直连。
- Agent 页面只通过 Backend API 与 SSE 消费公开会话；工作区运行时属于 Agent 后端边界，其权限与生命周期归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `DesktopApiError` 是 API 与本地网络失败的统一错误，只承载 `code`、`details` 和可选 cause；用户可见文案键由稳定 `code` 推导并以 `details` 填参。页面只在确有恢复分支时按类型或 `code` 判断，不解析原始异常文本。
- renderer 诊断只上报实际异常摘要与 route / project / task / event 白名单上下文，不上报完整 items / files、页面自定义对象或原始路径 / URL。
- 日志列表只保存 `log.appended` 轻量事件，选中后由 `desktop-api.ts` 严格归一当前进程详情；普通页面、toast 和空状态不展示调用栈或原始异常。
- 持久化 `AppLanguage` 只在 `src/domain/app-language.ts` 投影为 renderer `Locale`，React Provider 只消费已解析的 locale。
- 应用自身的可见文案从 `src/shared/i18n` 解析。

## 2. 主窗口运行态

- `DesktopStateProvider` 是主窗口项目身份、设置、事件流和写入编排入口；日志窗口不启动该运行态，只读取语言并消费日志流。高频 batch translation、runtime 与项目变更信号各自由稳定外部 store 持有，不进入 `DesktopStateContext`，Provider 自身不订阅这些快照。
- 初始状态并行读取设置、项目 snapshot、任务 snapshot 与 runtime snapshot；renderer 启动、热更新或整页重载不通过关闭工程重置后端会话。
- 项目身份由 `path + epoch + phase` 守护；项目切换、同路径重新初始化、迟到事件和首刷期间暂存事件都经过同一身份闸门。
- `BatchTranslationSnapshotStore` 独占 renderer 当前批量翻译快照，HTTP 与 SSE 共用同形载荷并按 `revision` 丢弃旧帧；Hook 通过 `useBatchTranslationSnapshot` 直接消费，不保存或回写本地当前快照。metrics 随快照与显示时钟计算，输入、思考和输出 token 保持互斥累计口径。
- `RuntimeActivityStore` 只缓存 `revision + owner`，用 revision 丢弃 HTTP / SSE 乱序旧值；消费方通过 `useRuntimeSnapshot` 精确订阅。项目写入、设置、模型配置和任务启动统一按 `owner !== null` 锁定；Agent 页在 batch_translation owner 下同样锁定，但 Agent owner 期间允许当前会话内存输入排队，并仅按 Agent snapshot 的 `canSendNow` 开放 Pi steer。reset、round 修订和模型选择 / 思考档位仍要求共享运行时空闲。批量翻译活跃态由 status 派生。
- settings 只由后端设置载荷同步，task 只由后端 snapshot 或命令 ack 同步，project identity 只由后端项目载荷同步；Agent 普通命令 ack 只含 `revision`，公开会话事实由同 revision 的 Agent SSE 事件同步。
- HTTP 写入结果与 `project.data_changed` SSE 共用同一事件入口、去重窗口和恢复策略；共享层只向 `ProjectChangeSignalStore` 发布轻量信号，页面通过 `useProjectChangeSignal` 精确订阅并根据目标 section 重新 query。
- `DesktopRefreshScheduler` 只合并可延迟的 task snapshot 和项目刷新信号；项目切换、设置刷新、写入结果和任务终态先冲刷窗口。
- flush、SSE 或写入处理失败进入 renderer 诊断，并通过可等待、可去重的权威 query 恢复；EventSource 由浏览器负责重连，主窗口重连后刷新 settings、runtime、task 与当前项目状态，Agent 重连后恢复会话 snapshot，当前项目的有效事件不静默丢弃。

## 3. 页面、feature、导航与 session 状态

- 前端实体和值对象从 `src/domain` 导入，跨运行时纯规则和协议词表从 `src/shared` 导入；最终项目事实计算只属于后端。
- 功能 query 的参数、结果窗口和缓存身份归消费页面所有；被多个当前页面复用的领域交互、API 适配与纯规则进入 `src/frontend/features/<capability>`，需要全量事实的搜索、统计、排序和写入计算仍由后端 query / command 提供。
- query 顶层 `sectionRevisions` 是快照派生写入与预演提交的乐观锁来源；功能域局部 revision 只服务 cache 身份，不能替代操作 revision。任务启动和面向当前项目事实的 reset 只提交意图，不为它们预取或转发 revision。
- 页面写入只提交用户意图、必要的设置镜像、显式 operation，以及快照派生操作所依赖的 query revision，不提交前端计算出的 canonical facts。普通翻译启动以 Store 当前权威进度选择 new 或 continue，历史展示快照只服务显示。
- `SCREEN_REGISTRY` 是页面组件、标题 key 与工作区布局模式的唯一入口；页面缺省消费 Shell 标准边距，Agent 使用占满 WorkspaceFrame 的 `edge-to-edge` 画布并在页面内部约束阅读区与操作区。
- Agent、工作台与校对可在未加载工程时发起项目选择，并在 session ready 后恢复 pending route；其它项目功能页在工程未加载或 session 未 ready 时禁用。
- 跨页面模型选择与所选模型思考配置由 `features/model-selection` 归一窄协议并持有页面生命周期 query / command；后端为每个模型公开生效 Agent 容量和可用思考档位，renderer 不按 API 格式或模型名再次推断。档位控件只列后端确认的值；空集合保持控件位置但禁用并显示“默认”及不支持提示。模型数据不进入 `DesktopStateProvider`，也不通过 SSE 同步，写入消费共享 runtime 锁。
- `ProjectSessionUiStateProvider` 只保存当前项目内可跨路由恢复的轻量 UI 状态，项目切换或关闭时清空，不写入后端事实。
- `QualityRuleStatisticsProvider` 持有当前项目内跨规则页共享的后端质量统计结果窄投影；页面只缓存 `entry_ids`、`hits_by_entry_id` 和 `subset_parents_by_entry_id`，不保存后端依赖签名或重复 revision。项目切换时重置，项目事件按受影响规则失效并推进请求 token，旧项目或旧 token 的迟到结果不得写回。
- Agent 页面外层信息流默认跟随最新内容，用户向上滚离底部超过容差或点击“跟随最新”可退出跟随；内容伸缩与程序归底不改变跟随状态，再次点击或按当前平台快捷键（Ctrl+E / ⌘E）会归底并重新激活，同时重置当前活动思考视口；跟随按钮同步公开 `aria-keyshortcuts`。每个活动思考视口独立默认跟随流式内容，用户在该视口内上滚后取消自身跟随与完成后的自动收起，历史思考视口保留自己的阅读位置。
- Agent renderer 由 `AgentSessionStore` 作为唯一会话镜像，按 timeline、controls、queue、todo、skills 与 input 切片订阅；command、queue、todo、pending decision 和 transport 的变化不重建其它切片。entry upsert 只替换目标条目，正常命令不回传完整历史；时间线 round 与 Markdown 组件按稳定 entry / 真实文本输入复用，完整消息中的 Mermaid 由专用渲染器按当前主题令牌适配节点、连线与标签样式，发送按钮在 command 开始后立即以 `aria-busy` 表示受理中。页面拥有主 Composer 的宿主指令列表及其标题、描述、禁用态和动作，Composer 只负责筛选与即时触发；原位编辑器不提供指令。Agent 会话恢复、用户决定与连接世代的跨层消费契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- 校对以 `entry_id` 消费后端字段级术语结果；编辑窗只对对应译文字段重新求值，不重建术语身份。
- 规则页通过一次性查找意图跳转校对并重置旧筛选，命中统计仍以共享质量统计结果为准。
- `BatchTranslationSessionProvider` 拥有翻译历史展示、波形、完成提示抑制和跨路由 follow-up，并统一承接手动入口与翻译完成提示的译文导出确认；导出预检读取后端校对摘要，Agent 跳转覆盖普通 Composer 草稿。页面计算缓存、其它弹窗、导入和提交中状态默认随页面挂载与卸载。
- `src/frontend/pages/<page>` 只包含页面入口及该页面的私有实现；页面之间不互相导入，共用能力先迁入 `features`，`features` 不反向依赖 `pages`。
- `src/frontend/widgets/interactions` 只承接通用交互与快捷键，不依赖 app state、页面领域、桌面桥、后端 API 或 SSE。
- 新业务能力代码按所有者进入 `app`、`features`、`pages`、`widgets`、`src/shared` 或 `src/domain`，不新建无主的顶层技术工具桶。

## 4. 样式消费

- 本文不定义视觉风格，只记录工程消费落点；具体方向来自当前任务输入、既有界面证据和适用设计流程，不绑定固定文件名。
- `AppearanceProvider` 是各 renderer 窗口持久化主题 / 字体偏好、解析系统主题、同步根节点视觉状态与原生标题栏的唯一入口；宿主桥只接收已解析的 `light / dark`，不持有 `system` 等用户偏好。
- `src/frontend/index.css` 拥有全局 token 与主题样式，`src/frontend/shadcn` 拥有基础控件，`widgets`、`features` 与 `pages` 只消费外观运行态、token，并组合各自所有权内的界面。
- `npm run check` 是前端分层、可见文案与样式消费边界的机器门闩，验证选择见 [`WORKFLOW.md`](WORKFLOW.md)。
