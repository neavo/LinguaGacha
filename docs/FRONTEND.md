# LinguaGacha 前端权威边界

本文只回答 Electron / preload / renderer 接入、传输入口、共享运行态、页面 query、导航、session UI 状态和样式消费落点。后端共享协议归 [`BACKEND.md`](BACKEND.md)，产品 Agent 的跨层消费契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)；产品语义与视觉方向不在工程长期文档中定义。

## 1. 宿主与传输

- renderer 只能通过 `window.desktopApp` 的按用途窄接口接触宿主能力，不直接导入 Electron、Node、`src/native`、preload 或 backend 实现；原生路径选择在 preload / main 之间统一收口为单一判别联合 IPC，页面不传 Electron 对话框选项。renderer IPC 与 Backend Runtime 共用原生保存对话框；宿主只选择位置，文件写入归后端。
- renderer 通过无参数的 `requestUserAttention` 请求桌面注意力；是否播放系统提示音与闪烁窗口由 main 按所属窗口焦点决定，renderer 不传业务文案或任务字段。
- 主进程按 Chromium 编辑语义为主窗口和日志窗口提供原生文本菜单；renderer 不新增菜单 IPC 或页面私有实现。
- Agent Markdown 保留原始 HTML 与图片，URL 转换入口显式过滤协议；相对链接经 Backend API 激活工作区目标，外链交给宿主，页内锚点保留原生跳转，被过滤的目标显示文本。正文工具栏通过 Chromium 下载流程保存，工作区链接及其后端保存契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- 后端传输统一收口到 `src/frontend/app/desktop/desktop-api.ts`；页面和跨页面 feature 可以直接调用其 `api_fetch`，也可以在各自所有权目录建立领域适配器，但不直接创建后端 `fetch` 或 `EventSource`。
- Electron main 只在 Backend Runtime ready 后创建窗口，并将启动快照中的 API base URL 与应用版本通过窗口启动参数注入 preload；`window.desktopApp.appVersion` 是标题栏首帧与更新检查共用的固定版本，来源为后端 `AppMetadataService`。`desktop-api.ts` 直接使用该地址处理响应壳、SSE、本地网络错误、renderer 诊断、日志详情和 GitHub release 元数据请求。renderer 的 release 请求与 Electron main 的 release zip 下载都复用默认 session 的 Chromium 网络栈并随其当前系统代理，loopback Backend API 保持直连。
- Agent 页面只通过 Backend API 与 SSE 消费公开会话；工作区运行时属于 Agent 后端边界，其权限与生命周期归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `DesktopApiError` 是 API 与本地网络失败的统一错误，只承载 `code`、`details` 和可选 cause；用户可见文案键由稳定 `code` 推导并以 `details` 填参。页面只在确有恢复分支时按类型或 `code` 判断，不解析原始异常文本。
- 界面已呈现结果的操作静默成功，有额外结果信息时再通知。操作拥有者负责失败恢复和一次错误 Toast；持续不可用状态就地说明，共享 Toast 入口负责展示与可选恢复动作。
- renderer 诊断只上报实际异常摘要与 route / project / task / event 白名单上下文，不上报完整 items / files、页面自定义对象或原始路径 / URL。
- `useLogPages` 独占日志日期、跟随状态和单日期分页缓存；首次选择最新实际日期，目录刷新保留原选择。可见时串行补读，暂停跟随时只检查文件状态；隐藏暂停、恢复补读。滚动加载保留阅读锚点，失败 Toast 后由再次滚动重试。“回到顶部”仍读取所选日期。切换日期取消旧请求，外部编辑清空旧选择与详情，迟到响应不得污染新视图；搜索仅覆盖已加载摘要。普通页面、toast 和空状态不展示调用栈或原始异常。
- 应用语言元数据归 `src/shared/i18n/types.ts`，菜单与发行包共用该声明且不加载词典。`src/domain/app-language.ts` 保留合法持久化编码并投影为 renderer `Locale`；系统语言只用于显式缺省场景，Provider 消费已解析的 locale。主窗口的 `LocaleProvider` 从外层 `DesktopStateProvider` 读取语言，外层事件通知显式接收设置语言并调用共享文案解析器。
- 应用文案及源／目标语言展示名归 `src/shared/i18n`，菜单使用固定自称；领域语言模块只拥有语言码与字符规则。中文词典定义消息契约，其它语言保持键和占位符一致；提示词语言消费归 [`BACKEND.md`](BACKEND.md)。

- PDF 打印资源归 Electron 宿主。`buildtools/build-pdf-print.mjs` 生成内嵌 KaTeX 字体的样式，GUI 注入样式路径与共享字体目录。宿主首次打印读取界面字体并缓存内嵌样式，打印窗口只允许 `data:` 资源。

### 开发热更新与模块生命周期

- Context 与消费 Hook 归 `*-context.ts`，状态装配归 `*-provider.tsx`，实例类型通过类型导入引用。词典更新经 `LocaleProvider` 发布，沿用同一 `LocaleContext`。
- `desktop-toast.ts` 拥有进度快照、任务身份和关闭计时；`DesktopProgressToast` 统一展示通知与遮罩。展示更新保留任务状态，只有当前任务能更新或结束进度。
- `renderer_runtime_reload` 沿 Vite 导入图识别前端 `*-context.ts`、`app/state/` 与 `app/session/` 下的 `*-store.ts`、`app/feedback/desktop-toast.ts` 及其运行时依赖，变更时刷新连接的窗口并重建实例。组件、样式与词典资源正常热更新。类型导入不进入该图；保留的内存数据结构变化时需显式刷新，未持久化状态随刷新清空。

## 2. 主窗口运行态

- `DesktopStateProvider` 是主窗口项目身份、设置、事件流和写入编排入口；日志窗口不启动该运行态，只读取语言并查询日志文件。高频 batch translation、runtime 与项目变更信号各自由稳定外部 store 持有，不进入 `DesktopStateContext`，Provider 自身不订阅这些快照。
- `DesktopStateProvider.load_initial_state` 统一初始化与重试，读取后端现有会话的设置、项目、任务和运行态快照；请求世代隔离迟到响应，`initial_state_status` 为 `ready` 后挂载工作区会话与页面。
- 项目身份由 `path + epoch + phase` 守护；项目切换、同路径重新初始化、迟到事件和首刷期间暂存事件都经过同一身份闸门。
- `BatchTranslationSnapshotStore` 独占 renderer 当前批量翻译快照，HTTP 与 SSE 共用同形载荷并按 `revision` 丢弃旧帧；Hook 通过 `useBatchTranslationSnapshot` 直接消费，不保存或回写本地当前快照。metrics 随快照与显示时钟计算，输入、思考和输出 token 保持互斥累计口径。
- `RuntimeActivityStore` 缓存 `revision + owner` 并丢弃旧帧，消费方通过 `useRuntimeSnapshot` 订阅；入口互斥遵循 [`BACKEND.md`](BACKEND.md)。Agent owner 期间允许输入排队，Pi steer 使用 Agent snapshot 的 `canSendNow`；batch_translation / model_test owner 下暂停额外 Agent 执行命令。批量翻译活跃态由 status 派生。
- 模型目录共享状态保存更新标记，页面各自查询模型数据。首次 SSE 连接和重连补查目录快照，按后端实例和修订丢弃迟到结果，会话存储避免窗口重载后重复提示。目录更新触发模型页与选模组件刷新，正在编辑的草稿随目标模型切换才重置。
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
- `useSettingsEditor` 经 `commit_project_write` 提交涉及工程的设置命令并回灌 `changes`，同步与补偿归后端；失败优先恢复本次字段的权威值，保留其它字段的在途编辑。
- 预设菜单只缓存条目，默认标记由当前 settings 快照计算。工程写锁只限制应用预设和重置当前内容，预设文件的保存、重命名、删除及默认项设置保持可用。
- 模型页按后端快照的 `can_reset` 展示重置或删除，类型只用于分组；自定义分组最后一项保留，已下架预设可清空分组。模型配置编辑只随本地提交状态暂停；接口测试独立消费运行占用和本地测试状态；复制提示按回包的副本 ID 读取分类和名称。模型生命周期与复制契约归 [`BACKEND.md`](BACKEND.md)。
- `SCREEN_REGISTRY` 是页面组件、标题 key 与工作区布局模式的唯一入口；页面缺省消费 Shell 标准边距，Agent 使用占满 WorkspaceFrame 的 `edge-to-edge` 画布并在页面内部约束阅读区与操作区。
- `PageLeaveProvider` 保存当前页面唯一的异步离开前动作，路由选择与确认退出等待其成功。提示词编辑 Hook 拥有草稿、成功基线与串行保存，页面注册 `flush_prompt_change`；失败保留草稿供编辑或离页重试，Toast 可撤销到成功基线。重试与页面身份变化使恢复通知失效；卸载取消延迟任务并失效旧请求。
- 技能列表与详情共用 `skills` 导航项。详情用 LF 文本持有当前文件草稿，输入暂停后自动保存，组词期间等待。文件切换及离页等待保存和文件命令完成，失败保留草稿供重试或放弃。列表在返回时恢复滚动位置并重读快照。磁盘与技能改名契约归 [AGENT_RUNTIME](AGENT_RUNTIME.md)。
- 主文件编辑视图包含 `name`、`description` 和正文，复制得到可见文本。技能扩展负责头部保护和单行字段约束，字段无效时保留草稿并暂停保存。保存成功推进基线，编辑器保留选区和撤销历史。放弃修改重建编辑器并清除旧历史。共享运行快照的 `owner === "agent"` 使技能编辑只读并暂停自动保存，空闲后恢复草稿保存。
- 技能文件命令通过 Toast 报告失败，正文保存错误和版本冲突由编辑区提供恢复入口。命令前保存失败会阻止执行并保留草稿。移动成功后复用已保存正文与版本，更新文件和导航路径。创建或删除成功后若读取失败，页面保留新文件树并提供重载入口，避免重复执行已完成的命令。
- `AppEditor` 在挂载时安装调用方提供的业务扩展。相同受控值保留当前文档。外部值更新绕过输入过滤且不进入用户撤销历史。
- Agent、工作台与校对可在未加载工程时发起项目选择，并在 session ready 后恢复 pending route；其它项目功能页在工程未加载或 session 未 ready 时禁用。
- `features/model-selection` 持有页面级模型查询与写入命令。运行占用变化触发重查，保存设置使旧查询失效。配置加载和保存期间锁定控件，成功回包替换快照，失败保留原值。共用模型菜单支持直接选择模型并沿用其等级，悬停或右方向键展开可选等级，等级项目一次提交模型与等级。Agent 页面负责关闭思考的确认和批量跟随项。选模契约归 [`BACKEND.md`](BACKEND.md)，Agent 配置生效边界归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- Agent 模型入口从会话 `usage` 与 `context` 快照生成用量提示。累计输入包含缓存读取与写入，缓存命中率以累计输入为分母。上下文容量优先使用运行会话的 `limits`，空会话使用所选模型配置。
- `ProjectSessionUiStateProvider` 只保存当前项目内可跨路由恢复的轻量 UI 状态，项目切换或关闭时清空，不写入后端事实。
- `QualityRuleStatisticsProvider` 持有当前项目内跨规则页共享的后端质量统计结果窄投影；页面只缓存 `entry_ids`、`hits_by_entry_id` 和 `subset_parents_by_entry_id`，不保存后端依赖签名或重复 revision。项目切换时重置，项目事件按受影响规则失效并推进请求 token，旧项目或旧 token 的迟到结果不得写回。
- Agent 页面外层信息流默认跟随最新内容，用户向上滚离底部超过容差或点击“跟随最新”可退出跟随；内容伸缩与程序归底不改变跟随状态，再次点击或按当前平台快捷键（Ctrl+E / ⌘E）会归底并重新激活，同时重置当前活动思考视口；跟随按钮同步公开 `aria-keyshortcuts`。每个活动思考视口独立默认跟随流式内容，用户在该视口内上滚后取消自身跟随与完成后的自动收起，历史思考视口保留自己的阅读位置。
- `useAgentInputTransition` 拥有 Agent 底部占位、离场内容和焦点恢复；测量目标尺寸时固定外部占位，避免滚动视口夹取阅读位置。Composer 持续挂载，输入锁保持至离场结束，焦点归还等待编辑器恢复可编辑；工具栏 Portal 菜单同步关闭。共享编辑器提供正文与附件能力，提交权限由主 Composer 和原位编辑器各自决定。
- `AgentFileDropTarget` 管理文件拖入区域。主输入接收整页拖入，原位编辑只接收局部拖入。CodeMirror 在默认读取文件文本前消费文件事件，按当前权限交给所属 `AgentInputDraft`。外层冒泡入口接收其余区域，捕获阶段清除拖放反馈。普通文本拖放由编辑器处理。
- `AgentMessageAttachments` 共用草稿与已发送附件的展示，修改动作交还所属草稿。图片通过 API 读取原文件，组件持有并释放符合 CSP 的 Blob URL。上传与会话契约归 [AGENT_RUNTIME](AGENT_RUNTIME.md)。
- Agent renderer 由 `AgentSessionStore` 作为唯一会话镜像，按 timeline、controls、queue、todo、skills、input 与 countdown 切片订阅，各切片独立更新。entry upsert 只替换目标条目，正常命令通过事件更新状态。时间线 round 与 Markdown 组件按稳定 entry / 真实文本输入复用，发送按钮在 command 开始后立即以 `aria-busy` 表示受理中。页面拥有主 Composer 的宿主指令列表及其标题、描述、禁用态和动作，Composer 负责筛选与即时触发。Agent 会话恢复、用户决定与连接世代的跨层消费契约归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `AgentMarkdown` 将正文解析、高亮与图表交给 Streamdown 插件，接入桌面链接、图片预览和交互边界；Mermaid 配置消费应用主题令牌。图表容器的可用宽度由应用 CSS 提供，SVG 布局与自然尺寸由 Mermaid 决定。图表激活态由 DOM 焦点拥有，失焦或 Escape 后滚轮恢复页面滚动；图表文字和经过图表的选区不进入正文批注。
- Agent 工具详情在首次查看标签时生成阅读文档，按原始内容复用输入、输出各一份结果，只挂载当前查看器。输出逐块递归解释完整的内嵌 JSON，统一 LF 并裁剪首尾空白行，保留正文缩进与内部空行；空白块占一行，无输出生成空文档。会话保留原始块。格式化器在清理后生成文本和语义范围，`AppEditor` 在同一事务更新文档与范围，通过单个 CodeMirror 视口显示，不重新解析阅读文档。
- 校对以 `entry_id` 消费后端字段级术语结果；编辑窗只对对应译文字段重新求值，不重建术语身份。
- 校对以 `kind` 区分文本和页面，共用列表窗口与状态展示。文件选择的 `default` 跟随后端全部叶子，`selected` 保留显式叶子集合及空集，查询直接传递选择意图，筛选弹窗持有内容条件草稿。筛选弹窗内的候选搜索只影响显示，全选覆盖对应维度的全部候选，术语组包含「无术语缺失」。文件更新保留查询意图和阅读锚点，旧窗口失效后带锚点重查。工作台表头排序属于页面状态，拖动保存工程顺序。查询与计数口径归 [BACKEND](BACKEND.md)。
- 校对文件树按内部路径展开容器，无路径内容在混合容器中显示为「未分组」。目录与容器选择覆盖全部后代叶子，父级状态由后代计算。虚拟滚动只挂载展开分支的可见行，选择与计数读取完整树。展开身份包含节点种类及所属外层文件，状态随工程切换重建。文件身份及候选来源归 [BACKEND](BACKEND.md)。
- 文本编辑与页面预览共用详情布局，分别拥有编辑状态与预览请求。页面两栏独立加载，实际页码与图像一起发布；同页刷新保留画布，翻页只重置对应画布，来源替换重建预览。无图像响应显示空白禁用区，失败保留重试。批量写操作要求全部选择为文本，替换只消费文本译文，写入身份取自文本快照。
- 规则页通过一次性查找意图跳转校对并重置旧筛选，命中统计仍以共享质量统计结果为准。
- `features/media-preview` 拥有 Agent 与校对共用的画布、尺寸观测、缩放和平移，弹窗、数据请求与附加工具归调用方。调用方通过组件身份控制重置，同一实例在媒体或视口尺寸变化后保留倍率并约束平移。
- `src/frontend/pages/<page>` 只包含页面入口及该页面的私有实现；页面之间不互相导入，共用能力先迁入 `features`，`features` 不反向依赖 `pages`。
- `src/frontend/widgets/interactions` 只承接通用交互与快捷键，不依赖 app state、页面领域、桌面桥、后端 API 或 SSE。
- `widgets/interactions/use-reorder` 拥有表格、模型分类、技能和 Agent 队列的临时 ID 顺序与提交互斥；拖动中身份顺序或可操作状态变化即取消。页面拥有数据、持久化和一次错误反馈，`on_reorder` 的 resolve/reject 均表示保存与刷新处理结束，随后交回当前权威顺序；Agent 队列等待命令事件重放或快照恢复。React 拥有排序 DOM 和虚拟索引，dnd-kit 的 DOM 乐观排序插件保持禁用。
- `AppTable` 拥有选区裁决、行菜单与拖动手柄，手柄可使用独立拖动列或数据列的 `drag_handle` 嵌入，页面只声明位置并提供业务列、菜单项及重排限制。拖拽与菜单共用重排入口；拖动及等待保存期间按起始身份顺序显示序号，位置索引独立服务交互。原行、占位与浮层共用手柄布局，浮层显示时原行透明占位以保留测量与焦点，浮层使用不透明底色。
- 新业务能力代码按所有者进入 `app`、`features`、`pages`、`widgets`、`src/shared` 或 `src/domain`，不新建无主的顶层技术工具桶。

### 批量翻译与工程导出

- `BatchTranslationSessionProvider` 拥有历史、波形、动作确认与唯一详情侧栏；工程级 `TranslationExportProvider` 独立拥有跨页面导出流程和唯一导出弹窗。两者在应用 session 常驻，工程切换或关闭时清空对应交互；页面计算缓存、其它弹窗、导入和提交状态随页面挂载与卸载。
- 批量翻译终态反馈由会话 Hook 统一触发，仅独立任务发送 Toast。完成时按本轮 `run_progress.error_line` 区分成功与部分失败，主动停止使用中性提示。部分失败警告由用户手动关闭，Agent 子步骤由工具结果承接汇报。
- `BatchTranslationRecoveryToast` 在会话层订阅当前快照的 `request_recovery`，独立与 Agent 任务共用固定 ID、不可手动关闭的警告。前端按 `retry_at` 每秒重算倒计时，其余恢复情况显示正在重试。恢复信息清空时解除通知。恢复协议归 [`BACKEND.md`](BACKEND.md)。
- 独立全量翻译（`source: standalone`、`operation: translate`、`scope.kind: all`）从活跃态进入 `done` 时请求导出确认，包含部分失败的情况。页面与任务完成通知共用预检及确认流程，运行态不锁定导出。前往 Agent 时保留已有草稿，仅为空草稿填入审校请求。该请求复用 Agent 空态快捷入口的本地化文案及技能引用，两处都表达检查并校正的任务意图。
- `ProjectTranslationStatsProvider` 独占工程统计缓存，工作台、Agent 卡片和详情共享结果；仅工程就绪后及相关 `project` / `items` 变化时串行刷新。工程关闭、切换和同路径重载使旧请求与重试失效，读取失败保留有效值。统计口径归 [`BACKEND.md`](BACKEND.md)。
- `features/batch-translation` 提供共享摘要、详情、格式化与样式。速度、耗时、用量和剩余时间优先消费本轮 `run_progress`，工程重开后消费累计 `progress`；完成率显式消费共享工程统计。校对页按重翻目的与剩余 item 范围展示行级状态，详情侧栏的模型信息直接消费快照 `config`。Agent 在翻译活跃时显示摘要，终态恢复 Todo。

- 工程主页消费磁盘预览，创建与打开成功后的最近工程名称取当前 `.lg` 文件名。工程概览与工作台共用 `features/translation-progress`，只格式化后端统计，口径归 [`BACKEND.md`](BACKEND.md)。
- 工作台在 items 与 pdf section 变化时补读文件列表，PDF 正文不进入前端共享缓存。

## 4. 样式消费

- 本文不定义视觉风格，只记录工程消费落点；具体方向来自当前任务输入、既有界面证据和适用设计流程，不绑定固定文件名。
- `AppearanceProvider` 是各 renderer 窗口持久化主题 / 字体偏好、解析系统主题、同步根节点视觉状态与原生标题栏的唯一入口；宿主桥只接收已解析的 `light / dark`，不持有 `system` 等用户偏好。
- `src/frontend/index.css` 拥有全局 token 与主题样式，`src/frontend/shadcn` 拥有基础控件，`widgets`、`features` 与 `pages` 只消费外观运行态、token，并组合各自所有权内的界面。
- 信息胶囊外观归 `shadcn/badge`，组合控件通过 `badgeVariants` 复用；业务组件只映射状态并提供布局与交互。
- 提示框的箭头与触发器间距统一归 `shadcn/tooltip`，消费方按布局选择方向与对齐方式。
- Agent Markdown 的普通正文排版归 `agent-markdown.css`，通过 Streamdown 公开组件映射使用原生标签。
- 应用自绘界面的快捷键提示统一复用 `Kbd` 键帽，动作键位文案由 `ShortcutKbd` 提供。
- 下拉与右键菜单主、子定位层共用 `widgets/app-menu` 的鼠标命中样式，覆盖宿主透明容器经 Portal 继承的穿透规则。菜单与 Tooltip 通过 `useWindowDeactivation` 及 Base UI 公开入口响应失焦和页面隐藏；Tooltip 在新交互后恢复悬停，窗口切换保持触发器 DOM 身份。
- `npm run check` 是前端分层、可见文案与样式消费边界的机器门闩，验证选择见 [`WORKFLOW.md`](WORKFLOW.md)。
