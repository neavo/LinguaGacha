# LinguaGacha 前端权威边界

本文只回答 Electron / preload / renderer 接入、传输入口、共享运行态、页面 query、导航、session UI 状态和样式消费落点。后端共享协议归 [`BACKEND.md`](BACKEND.md)，产品 Agent 的跨层消费契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)；产品语义与视觉方向不在工程长期文档中定义。

## 1. 宿主与传输

- renderer 只能通过 `window.desktopApp` 的按用途窄接口接触宿主能力，不直接导入 Electron、Node、`src/native`、preload 或 backend 实现；原生路径选择在 preload / main 之间统一收口为单一判别联合 IPC，页面不传 Electron 对话框选项。
- renderer 通过无参数的 `requestUserAttention` 请求桌面注意力；是否播放系统提示音与闪烁窗口由 main 按所属窗口焦点决定，renderer 不传业务文案或任务字段。
- 主进程按 Chromium 编辑语义为主窗口和日志窗口提供原生文本菜单；renderer 不新增菜单 IPC 或页面私有实现。
- Agent Markdown 直接渲染原始 HTML 与图片；链接点击统一交给宿主外部打开，URL 语义由 Markdown 渲染链和宿主处理。
- 后端传输统一收口到 `src/frontend/app/desktop/desktop-api.ts`；页面和跨页面 feature 可以直接调用其 `api_fetch`，也可以在各自所有权目录建立领域适配器，但不直接创建后端 `fetch` 或 `EventSource`。
- Electron main 只在 Backend Runtime ready 后创建窗口，并将启动快照中的 API base URL 与应用版本通过窗口启动参数注入 preload；`window.desktopApp.appVersion` 是标题栏首帧与更新检查共用的固定版本，来源为后端 `AppMetadataService`。`desktop-api.ts` 直接使用该地址处理响应壳、SSE、本地网络错误、renderer 诊断、日志详情和 GitHub release 元数据请求。renderer 的 release 请求与 Electron main 的 release zip 下载都复用默认 session 的 Chromium 网络栈并随其当前系统代理，loopback Backend API 保持直连。
- Agent 页面只通过 Backend API 与 SSE 消费公开会话；工作区运行时属于 Agent 后端边界，其权限与生命周期归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `DesktopApiError` 是 API 与本地网络失败的统一错误，只承载 `code`、`details` 和可选 cause；用户可见文案键由稳定 `code` 推导并以 `details` 填参。页面只在确有恢复分支时按类型或 `code` 判断，不解析原始异常文本。
- 界面已呈现结果的操作静默成功，有额外结果信息时再通知。操作拥有者负责失败恢复和一次错误 Toast；持续不可用状态就地说明，共享 Toast 入口负责展示与可选恢复动作。
- renderer 诊断只上报实际异常摘要与 route / project / task / event 白名单上下文，不上报完整 items / files、页面自定义对象或原始路径 / URL。
- `useLogPages` 独占日志日期、跟随状态和单日期分页缓存；首次选择最新实际日期，目录刷新保留原选择。可见时串行补读，暂停跟随时只检查文件状态；隐藏暂停、恢复补读。滚动加载保留阅读锚点，失败 Toast 后由再次滚动重试。“回到顶部”仍读取所选日期。切换日期取消旧请求，外部编辑清空旧选择与详情，迟到响应不得污染新视图；搜索仅覆盖已加载摘要。普通页面、toast 和空状态不展示调用栈或原始异常。
- 应用语言元数据归 `src/shared/i18n/types.ts`，菜单与发行包共用该声明且不加载词典。`src/domain/app-language.ts` 保留合法持久化编码并投影为 renderer `Locale`；系统语言只用于显式缺省场景，Provider 消费已解析的 locale。
- 应用文案及源／目标语言展示名归 `src/shared/i18n`，菜单使用固定自称；领域语言模块只拥有语言码与字符规则。中文词典定义消息契约，其它语言保持键和占位符一致；提示词语言消费归 [`BACKEND.md`](BACKEND.md)。

## 2. 主窗口运行态

- `DesktopStateProvider` 是主窗口项目身份、设置、事件流和写入编排入口；日志窗口不启动该运行态，只读取语言并查询日志文件。高频 batch translation、runtime 与项目变更信号各自由稳定外部 store 持有，不进入 `DesktopStateContext`，Provider 自身不订阅这些快照。
- `DesktopStateProvider.load_initial_state` 统一初始化与重试，读取后端现有会话的设置、项目、任务和运行态快照；请求世代隔离迟到响应，`initial_state_status` 为 `ready` 后挂载工作区会话与页面。
- 项目身份由 `path + epoch + phase` 守护；项目切换、同路径重新初始化、迟到事件和首刷期间暂存事件都经过同一身份闸门。
- `BatchTranslationSnapshotStore` 独占 renderer 当前批量翻译快照，HTTP 与 SSE 共用同形载荷并按 `revision` 丢弃旧帧；Hook 通过 `useBatchTranslationSnapshot` 直接消费，不保存或回写本地当前快照。metrics 随快照与显示时钟计算，输入、思考和输出 token 保持互斥累计口径。
- `RuntimeActivityStore` 缓存 `revision + owner` 并丢弃旧帧，消费方通过 `useRuntimeSnapshot` 订阅；入口互斥遵循 [`BACKEND.md`](BACKEND.md)。Agent owner 期间允许输入排队，Pi steer 使用 Agent snapshot 的 `canSendNow`；batch_translation owner 下暂停 Agent 会话命令。批量翻译活跃态由 status 派生。
- settings 只由后端设置载荷同步，task 只由后端 snapshot 或命令 ack 同步，project identity 只由后端项目载荷同步；Agent 普通命令 ack 只含 `revision`，公开会话事实由同 revision 的 Agent SSE 事件同步。
- HTTP 写入结果与 `project.data_changed` SSE 共用同一事件入口、去重窗口和恢复策略；共享层只向 `ProjectChangeSignalStore` 发布轻量信号，页面通过 `useProjectChangeSignal` 精确订阅并根据目标 section 重新 query。
- `DesktopRefreshScheduler` 只合并可延迟的 task snapshot 和项目刷新信号；项目切换、设置刷新、写入结果和任务终态先冲刷窗口。
- flush、SSE 或写入处理失败进入 renderer 诊断，并通过可等待、可去重的权威 query 恢复；EventSource 由浏览器负责重连，主窗口重连后刷新 settings、runtime、task 与当前项目状态，Agent 重连后恢复会话 snapshot，当前项目的有效事件不静默丢弃。

## 3. 页面、feature、导航与 session 状态

- 前端实体和值对象从 `src/domain` 导入，跨运行时纯规则和协议词表从 `src/shared` 导入；最终项目事实计算只属于后端。
- 功能 query 的参数、结果窗口和缓存身份归消费页面所有；被多个当前页面复用的领域交互、API 适配与纯规则进入 `src/frontend/features/<capability>`，需要全量事实的搜索、统计、排序和写入计算仍由后端 query / command 提供。
- 首次查询失败由内容区提供重试；已有快照刷新失败时保留内容并通知。规则页共用 `useQualityRuleQuery` 的请求入口和项目隔离；`AppContentState` 负责展示。
- query 顶层 `sectionRevisions` 是快照派生写入与预演提交的乐观锁来源；功能域局部 revision 只服务 cache 身份，不能替代操作 revision。任务启动和面向当前项目事实的 reset 只提交意图，不为它们预取或转发 revision。
- 页面写入只提交用户意图、必要的设置镜像、显式 operation，以及快照派生操作所依赖的 query revision，不提交前端计算出的 canonical facts。普通翻译启动以 Store 当前权威进度选择 new 或 continue，历史展示快照只服务显示。
- 预设菜单只缓存条目，默认标记由当前 settings 快照计算。
- 模型页按后端快照的 `can_reset` 展示重置或删除，类型只用于分组；自定义分组最后一项保留，已下架预设可清空分组。内置目录与用户配置的生命周期归 [`BACKEND.md`](BACKEND.md)。
- `SCREEN_REGISTRY` 是页面组件、标题 key 与工作区布局模式的唯一入口；页面缺省消费 Shell 标准边距，Agent 使用占满 WorkspaceFrame 的 `edge-to-edge` 画布并在页面内部约束阅读区与操作区。
- `PageLeaveProvider` 保存当前页面唯一的异步离开前动作，路由选择与确认退出等待其成功。提示词编辑 Hook 拥有草稿、成功基线与串行保存，页面注册 `flush_prompt_change`；失败保留草稿供编辑或离页重试，Toast 可撤销到成功基线。重试与页面身份变化使恢复通知失效；卸载取消延迟任务并失效旧请求。
- Agent、工作台与校对可在未加载工程时发起项目选择，并在 session ready 后恢复 pending route；其它项目功能页在工程未加载或 session 未 ready 时禁用。
- `features/model-selection` 持有页面级模型 query / command，运行占用变化触发重查，保存设置使旧查询失效；数据不进入 `DesktopStateProvider` 或 SSE。配置加载和保存期间锁定控件，成功回包替换整份快照，失败保留原值。工作台与 Agent 批量入口一次提交模型及可选等级，重复判断同时比较两者；Agent 主模型直接选择，独立等级更新保留页面确认。共享选项只表达模型与等级，页面负责用途、跟随项及提交命令。选模契约归 [`BACKEND.md`](BACKEND.md)，Agent 配置生效边界归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `ProjectSessionUiStateProvider` 只保存当前项目内可跨路由恢复的轻量 UI 状态，项目切换或关闭时清空，不写入后端事实。
- `QualityRuleStatisticsProvider` 持有当前项目内跨规则页共享的后端质量统计结果窄投影；页面只缓存 `entry_ids`、`hits_by_entry_id` 和 `subset_parents_by_entry_id`，不保存后端依赖签名或重复 revision。项目切换时重置，项目事件按受影响规则失效并推进请求 token，旧项目或旧 token 的迟到结果不得写回。
- Agent 页面外层信息流默认跟随最新内容，用户向上滚离底部超过容差或点击“跟随最新”可退出跟随；内容伸缩与程序归底不改变跟随状态，再次点击或按当前平台快捷键（Ctrl+E / ⌘E）会归底并重新激活，同时重置当前活动思考视口；跟随按钮同步公开 `aria-keyshortcuts`。每个活动思考视口独立默认跟随流式内容，用户在该视口内上滚后取消自身跟随与完成后的自动收起，历史思考视口保留自己的阅读位置。
- `useAgentInputTransition` 拥有 Agent 底部占位、离场内容和焦点恢复；测量目标尺寸时固定外部占位，避免滚动视口夹取阅读位置。Composer 持续挂载，输入锁保持至离场结束，焦点归还等待编辑器恢复可编辑；工具栏 Portal 菜单同步关闭。共享编辑器提供正文与附件能力，提交权限由主 Composer 和原位编辑器各自决定。
- Agent renderer 由 `AgentSessionStore` 作为唯一会话镜像，按 timeline、controls、queue、todo、skills、input 与 countdown 切片订阅；command、queue、todo、pending decision 和 transport 的变化不重建其它切片。entry upsert 只替换目标条目，正常命令不回传完整历史；时间线 round 与 Markdown 组件按稳定 entry / 真实文本输入复用，完整消息中的 Mermaid 由专用渲染器按当前主题令牌适配节点、连线与标签样式，发送按钮在 command 开始后立即以 `aria-busy` 表示受理中。页面拥有主 Composer 的宿主指令列表及其标题、描述、禁用态和动作，Composer 只负责筛选与即时触发；原位编辑器不提供指令。Agent 会话恢复、用户决定与连接世代的跨层消费契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- 校对以 `entry_id` 消费后端字段级术语结果；编辑窗只对对应译文字段重新求值，不重建术语身份。
- 规则页通过一次性查找意图跳转校对并重置旧筛选，命中统计仍以共享质量统计结果为准。
- `src/frontend/pages/<page>` 只包含页面入口及该页面的私有实现；页面之间不互相导入，共用能力先迁入 `features`，`features` 不反向依赖 `pages`。
- `src/frontend/widgets/interactions` 只承接通用交互与快捷键，不依赖 app state、页面领域、桌面桥、后端 API 或 SSE。
- 新业务能力代码按所有者进入 `app`、`features`、`pages`、`widgets`、`src/shared` 或 `src/domain`，不新建无主的顶层技术工具桶。

### 批量翻译与工程导出

- `BatchTranslationSessionProvider` 拥有历史、波形、动作确认与唯一详情侧栏；工程级 `TranslationExportProvider` 独立拥有跨页面导出流程和唯一导出弹窗。两者在应用 session 常驻，工程切换或关闭时清空对应交互；页面计算缓存、其它弹窗、导入和提交状态随页面挂载与卸载。
- 独立全量翻译（`source: standalone`、`operation: translate`、`scope.kind: all`）从活跃态进入 `done` 时请求导出确认；Agent 批量结果由工具承接后续步骤。页面与任务完成通知共用预检及确认流程，运行态不锁定导出。前往 Agent 时保留已有草稿，仅为空草稿填入审校请求；该请求复用 Agent 空态快捷入口的本地化文案及技能引用，两处都表达检查并校正的任务意图。
- `features/batch-translation` 提供共享摘要、详情、格式化与样式。详情优先消费本轮 `run_progress`，工程重开后消费累计 `progress`；工作台统计消费工程事实，校对页按重翻目的与剩余 item 范围展示行级状态。详情侧栏的模型信息直接消费快照 `config`。Agent 在翻译活跃时显示摘要，终态恢复 Todo。

## 4. 样式消费

- 本文不定义视觉风格，只记录工程消费落点；具体方向来自当前任务输入、既有界面证据和适用设计流程，不绑定固定文件名。
- `AppearanceProvider` 是各 renderer 窗口持久化主题 / 字体偏好、解析系统主题、同步根节点视觉状态与原生标题栏的唯一入口；宿主桥只接收已解析的 `light / dark`，不持有 `system` 等用户偏好。
- `src/frontend/index.css` 拥有全局 token 与主题样式，`src/frontend/shadcn` 拥有基础控件，`widgets`、`features` 与 `pages` 只消费外观运行态、token，并组合各自所有权内的界面。
- 应用自绘界面的快捷键提示统一复用 `Kbd` 键帽，动作键位文案由 `ShortcutKbd` 提供。
- 下拉与右键菜单主、子定位层共用 `widgets/app-menu` 的鼠标命中样式，覆盖宿主透明容器经 Portal 继承的穿透规则。菜单与 Tooltip 通过 `useWindowDeactivation` 及 Base UI 公开入口响应失焦和页面隐藏；Tooltip 在新交互后恢复悬停，窗口切换保持触发器 DOM 身份。
- `npm run check` 是前端分层、可见文案与样式消费边界的机器门闩，验证选择见 [`WORKFLOW.md`](WORKFLOW.md)。
