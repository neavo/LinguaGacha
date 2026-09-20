# LinguaGacha 产品 Agent 工程边界

本文统一承载产品 Agent 的公开会话协议、运行态所有权、模型会话、启动资源、skill 与工具、宿主能力和前端消费。共享 Gateway、项目事务、模型请求与前端运行态分别归 [`BACKEND.md`](BACKEND.md) 和 [`FRONTEND.md`](FRONTEND.md)，进程拓扑归 [`ARCHITECTURE.md`](ARCHITECTURE.md)；字段级 schema、局部算法和产品语义留在代码、测试与当前产品设计中。

## 1. 公开会话协议

- Agent 公开入口提供 snapshot、message、写入请求审批模式 update、普通问题 resolve、写入授权 resolve、continue、输入队列 update / delete / reorder / send、最新轮次 revise、手动上下文压缩、stop 与 reset。message 请求和公开 user 条目携带规范化后的 `text` 与有序 `attachments`，附件只包含后端归一的 WebP base64 图片或用户确认的回复批注，正文与附件不能同时为空。批注冻结所选助手正文与允许为空的用户评论，不追踪来源消息；后端只把选文和评论投影为模型可读的引用上下文，图片仍通过模型图片通道传递。
- 空闲且没有暂停队列时，message 建立新的公开轮次；运行时 message 进入当前会话最多保留 5 条的有界内存输入队列，达到上限后 renderer 禁止新增入队，AgentService 仍以共享上限拒绝越界请求。正常轮次成功后在同一运行 lease 内按 FIFO 续取，stop 或模型失败保留并暂停剩余队列。continue 原子追加可选消息、解除暂停，并按需恢复失败 round 或启动队首；空 continue 只表达继续意图。立即发送在空闲时启动选中 round，在运行时经 Pi `steer` 发送，并仅在对应 user `message_start` 后从 `sending` 提交为成功的 `delivery: steer` 条目；提交前失败、停止或取消恢复为 `queued`。普通 user 使用 `delivery: round`；只有 round 建立 SDK history checkpoint 和轮次终态，因而可作为 revise（包括以原输入重新运行）与失败 continue 的目标。
- revise 目标为最新 round user 时删除整轮旧尝试并以完整替换消息重新调用模型，替换为原输入即表示重试；目标为该轮最终可见 assistant 时保留此前 user 与工具历史、写入零 usage 的纯文本 assistant 而不调用模型。continue 以隐藏“继续”消息续跑失败的原 user 轮次。两种操作都要求会话空闲，revision 另校验最新 round 输入或最终输出身份；更早轮次、steer 输入和同轮中间 assistant 不可修订。会话状态只区分 `idle | running`；round user、assistant 与 tool 条目携带 `running | success | error | stopped` 状态，steer user 只在成功提交后公开，上下文压缩条目只使用 `running | success | error`。
- `AgentSessionSnapshot` 与所有 `agent.session_event` 都携带同一会话内单调 `revision`；`snapshot_seed` 先分配 revision，再用同值构造事件顶层和嵌套快照。普通 message、continue、队列、用户决定、审批模式、revise、手动压缩、stop 与 reset 命令只返回 `{ revision }` 的 `AgentCommandAck`，公开事实必须由增量事件表达；手动压缩在 `context_compaction` running 条目发布后返回 ack，最终 success / error 由后续增量事件结算。完整 snapshot 只用于首次加载、重连、revision 缺口和 reset 恢复。renderer 对旧 / 重复事件丢弃，对缺口暂停应用并重新 GET 快照。
- 时间线由 snapshot 与 revisioned `agent.session_event` 共同恢复本次 reset 以来的内存历史；连续的压缩尝试复用最近一次失败 entry。公开 assistant 条目只保留非空白的 text / thinking parts、合并相邻同类且至少包含一项；空投影不产生条目。公开 `context` 同时携带模型可见历史的估算 token 与后端判定的 `compactable`；模型失败只写入对应条目和轮次，不发布第二套失败事件。公开工具条目冻结规范化后的完整输入，并只在 SDK 工具终帧后以字符串数组按顺序保留模型实际收到的文本块原文；终态空数组表示没有文本块，运行与停止状态使用 null，块间排版归前端；公开协议不承载 SDK 原始参数引用、结构化 details、压缩诊断、供应商连续性元数据或脱敏思考。
- 工具 `running` 条目在执行体开始前发布；所有产品工具在统一注册边界先让出一次事件循环，为本地 SSE 首帧提供独立发送轮次。

## 2. 状态与生命周期

|状态|拥有者|唯一入口|
|---|---|---|
|公开状态、完整 UI 时间线、会话生命周期与启动期资源|`AgentService`|Agent API、`agent.session_event`|
|模型可见历史、工具循环、上下文压缩、中断与 settle|内存 `AgentSession`|`AgentService` 调用 SDK 的 prompt、模型切换与关闭 API|
|用户输入队列与暂停 / 发送状态|`AgentService`|Agent message、continue 与 queue API|
|模型对话级有序 Todo|`AgentService`|`ws.todo`、Agent API 与 `agent.session_event`|
|当前唯一用户决定、取消与一次性裁决|`AgentDecisionCoordinator`|各类用户决定 resolve API 与 `agent.session_event`|
|当前决定的自动选择倒计时|renderer `AgentSessionStore` 持有的 `AgentDecisionCountdown`|已确认决定、连接与命令状态、自定义输入焦点|
|工程写入审批模式|`AgentService`|approval mode API 与 `workspace_apply` 成功结果|
|当前对话工作材料 `work`、数据快照与显式变更清单准备|`AgentWorkspaceService`|`workspace_run`、`workspace_apply`|

### 用户决定与会话配置

- 当前回合至多建立一个 `pendingDecision`，由 `AgentDecisionCoordinator` 持有普通问题与写入授权的待回答状态、取消和一次性裁决，各自使用窄 resolve API。后端等待宿主提交答案，公开决定不携带期限；裁决先清除 pending，再在下一事件循环恢复工具。reset、工程切换和 dispose 取消当前等待。
- 自动选择由前端会话时钟拥有，通过现有 resolve API 提交默认答案；后端只等待宿主裁决。同一决定的快照恢复与切页保留剩余时间，前端重载重新计时；输入聚焦、断线、快照恢复或命令占用期间冻结，条件解除后续计，卸载输入框释放聚焦。提交受理后停止计时，失败通知一次并保留问题供手动重试。逐秒变化通过独立 countdown 订阅发布。
- Agent 批量翻译模型偏好属于应用设置 `model_selection.agent_batch_translation`，默认 `null` 表示跟随，显式模型 ID 表示固定选择，跨会话与工程保留；由 `ModelService` 校验并保存，运行中允许修改，删除被引用的模型或修复失效配置时恢复跟随。`run_batch_item_translation` 调用时同步解析偏好：跟随使用成功建会话或换模后保存的 Agent 生效配置与思考档位，固定选择使用该模型自身保存配置，即使其 ID 等于当前 Agent 模型也保持固定语义。批量入口选择模型及等级通过统一选模命令保存，等级仍属于模型全局配置，引用同一模型的入口共享该值；跟随项不编辑等级。每次批量翻译调用冻结所用配置，运行中修改偏好影响后续调用。
- Agent 模型与思考档位属于应用设置，运行中保存后在下一次普通轮次、失败继续或手动压缩开始前采用。普通命令在受理前完成模型预检；FIFO 自动轮次在实际执行时通过同一模型同步方法预检，失败记入该轮并暂停剩余队列。轮内工具循环与 steer 使用当前轮次配置。公开 context 携带当前会话的历史 tokens 与实际 limits。
- 写入请求审批模式默认 `manual`，`auto` 直接提交工程数据变更，`manual` 为每个实际提交批次建立写入授权。待决状态使用同一份已准备差异生成按业务种类聚合的受影响对象数量，所有数量字段必填，无变化时为 0；`pages` 按实际变化的对象数计数；允许后续写入在当前批次成功且用户未更新模式时切换为 `auto`；允许本次写入、拒绝或提交失败沿用当前模式。reset、工程切换和应用重启恢复为 `manual`。运行中可切换模式，每批开始时确定审批方式，已展示的审批继续等待原裁决。

### 运行控制与恢复

- Agent 的公开会话与模型历史完全内存化，持久化日志不参与会话恢复。消息受理到当前 round 及自动 FIFO 链最终 settle 期间持有同一 [`RuntimeOperationGate`](BACKEND.md) lease，等待用户决定也不释放；Pi 在 SDK run 内拥有工具循环、自动压缩和压缩后的续跑。
- Agent runtime 冻结初始 SDK 会话 UUID 作为产品对话请求身份，跨轮次、修订、换模和压缩复用，随 runtime 重建更换。SDK 修订与压缩可能分配新 ID，因此发送边界使用冻结身份；请求头策略归 [`BACKEND.md`](BACKEND.md)。
- 手动压缩只在稳定空闲且有可压缩旧段时受理，以独立 Agent lease 更新模型配置、发布 running 条目并后台调用同一压缩入口，不建立公开 round。ack 返回后仍持有 lease，关闭屏障等待 settlement 退出。
- Pi `agent_start / agent_end`、压缩事件和 `pendingDecision` 共同决定 `canSendNow`，使异步预检、用户决定、压缩与结算窗口中的 steer 受同一条件约束。
- continue 在同一 lease 内恢复失败 round 或启动队首；失败 user 原位保留历史，不追加公开“继续”user，恢复失败时重新暂停队列。stop 同步封口 round 并异步取消 SDK，到最终 settle 才释放 lease；压缩和 `workspace_apply` 不可 stop。
- 输入队列与 Todo 跨普通回合、stop、continue、模型失败和压缩保留，reset、工程切换和 dispose 时清理。round user 与最终 assistant 修订按各自 SDK history checkpoint 裁剪活动路径，不回滚已发生的外部副作用。
- 显式 reset 与 `ProjectSessionState.mark_loaded` / `clear` 会立即隔离公开会话并等待旧运行时清理；同一工程内的项目事实变化不重置公开时间线或模型历史，已失效运行时的迟到阶段不得改写条目、发布终态或启动模型请求。

### 对话与执行日志

- `AgentSessionLog` 随 SDK runtime 冻结日志会话身份，round 复用公开用户轮次身份，continue 分配新执行身份。停止请求与实际结束分开记录；reset、工程切换和 dispose 隔离公开状态后，日志订阅仍保留到 SDK abort 结算，迟到终帧归入旧会话。未观察到结束的工具保留开始事实。
- 日志保留实际进入模型会话的用户文本，助手正文与时间线共用可见性规则，停止结算保留部分正文，图片只存类型摘要。工具 JSON 不经诊断裁剪，仅合并能逐字重建的文本与 details 副本。记录进入日志窗口，终端沿用普通诊断输出；存储与轮转归 [BACKEND](BACKEND.md)。

### 工作区投影

- GUI Agent 在 `userdata/agent/workspace` 持有固定物理工作区：数据快照、`changes`、`work` 与 `sources` 都使用真实相对路径。work 绑定当前 Agent 对话、工程 epoch 与权威语言；这些目录都是 Agent 工作资产，公开会话和项目事实分别由 `AgentService` 与项目读写边界拥有。
- 工程加载从 `.lg` 原始资产生成 `sources`；同一工程 `epoch` 与文件修订号复用同一投影，文件修订号变化时完整重建。`workspace_run` 在普通 section revision 后刷新数据快照与空变更清单，保留相容的 `work`；reset 清除快照和 work 并保留相容 sources，工程切换与应用启动清除旧工作区。`sources` 生成和目录清理故障进入诊断，项目加载与提交事实保持其权威结果。
- 普通文本映射为单文件，EPUB / XLSX 按容器内部路径展开文本成员。PDF 投影保留原始二进制，`project_meta.files` 公开 source_binary_path；`pages` 基线随数据快照逐页投影到 `pages/entries.jsonl`。
- 工作区链接使用相对根目录的 URL 编码路径；`POST /api/agent/workspace/activate-path` 接收 `{ path }`，由 `AgentWorkspaceService` 校验工作区相对入口，文件访问自然跟随目录链接，允许目标位于工作区外；来源失效范围按 work、sources 或快照入口确定。目录经宿主打开；文件经宿主选择保存路径，由工作区服务复制，返回 `{ status: "saved" | "opened" | "cancelled" }`。
- 文件保存采用确认时的当前内容，不建立点击时副本。对话框等待期间释放工作区互斥；会话清理开始立即使待决链接失效，work、sources 与数据快照按各自清理生命周期失效。确认后重新检查来源与脚本互斥，拒绝向工作区内部保存；同目录临时文件完整复制后才替换目标，保留工作原件与失败前的已有目标。
- 脚本成功、失败、超时或停止后已经完成的文件写入均保留；后续调用按需要重新读取并修复或覆盖，不建立工作文件事务或回滚。

## 3. 模型、资源与 skill

- Agent 与 OneShot 共用 [`BACKEND.md`](BACKEND.md) 定义的唯一模型能力解析和请求覆盖边界。模型配置中的 `agent.context_window` 与 `agent.max_output_tokens` 各自以 `0` 表示自动：自动上下文采用统一能力解析器提供的模型窗口；自动输出先取模型最大输出与产品档位的较小值，模型最大窗口低于 500K 时产品档位为 32K，否则为 64K。用户非零值优先，最终输出仍不得超过 `context_window - 32K`；格式损坏或无法容纳固定预留时整组恢复 `0/0`。每次 Agent 模型操作前把生效容量与已经确认可用的思考等级同步到既有 `AgentSession`，请求期保持该档位稳定。页面从 `context_window - max_output_tokens - 32K` 起预警；设置作用于同一对话的下一次模型操作，不重建或清空模型历史。模型页 generation 和 threshold 输入 / 输出 token 设置只作用于 OneShot。隐藏“继续”消息在操作发起时按当前 `app_language` 解析。
- Agent 模型在 Pi 请求边界固定声明 text / image 输入；消息附件中的批注先进入 text prompt，规范 WebP 则直接交给当前供应商，OneShot 仍只声明 text。产品不探测或配置具体模型的视觉能力，不自动删图、降级或回退 JPEG，供应商拒绝图片时沿用普通模型失败语义。
- 模型可见上下文超过 `context_window - 32K` 时，`AgentSession` 在新用户请求前、自然结束后，以及完整工具批次与下一次 assistant 请求之间统一自动压缩；空闲会话也可由公开手动入口立即压缩。历史切点完全交给 SDK，保留侧不拆分 assistant 工具调用与其结果；`AgentService` 只把 SDK 压缩事件投影到公开时间线，成功后 `context` 采用 SDK 对新模型历史的估算并重新计算可压缩性，失败保留原上下文快照并沿用 SDK 后续请求语义。
- Workspace 是 `AgentService` 的构造依赖、初始化前置和恒定工具面，初始化失败会阻止 Agent 启动资源完成加载。Agent 启动期原子加载必需的 `builtin/agent/system_prompt.md` 与 `builtin/agent/session_seed.json`；会话种子由零个或多个顺序任意的 user / assistant 消息组成，文本裁剪后允许为空，按资源顺序进入每个新会话的模型历史但不进入公开时间线，任一资源缺失或结构无效都会阻止启动。GUI Backend 的完整装配与启动顺序归 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
- coding-agent 的默认工具与项目资源发现全部关闭，SDK 不发现项目 `AGENTS.md`、`.pi` 或其它运行期资源。产品在初始会话及每次 reset 或工程切换时按用户目录、当前版本内置目录的优先级依次扫描，同名 skill 取首个有效定义，坏 skill 只记录诊断；安装根的历史资源目录不参与发现。形成的会话 catalog 同时拥有 System Prompt 能力清单、公开 mention、用户 marker 注入和名称到获胜 skill 包的内部绑定，并在当前对话内冻结。模型能力清单只公开名称与描述；`SKILL.md` 描述同时作为模型描述和 `ui.json` 展示描述缺失时的回退。
- `agent-charter` 是隐藏但保留在模型能力清单中的最高层任务宪章；其短正文与 System Prompt 的“任务与准则”有意重复。模型负责确保它在任务前已经加载；后端不注入任务阶段副本，也不跟踪加载状态。
- `ui.json` 的 `visible` 只控制公开列表和用户 marker：隐藏 skill 不进入公开快照，用户输入的同名 marker 不展开，但不影响模型能力清单或文件读取；`disableModelInvocation` 只排除模型能力清单，因此可见且禁用模型调用的 skill 仍能由用户 marker 显式注入。`@skill(name)` 是用户消息中的显式技能 marker，已知且公开时由宿主直接展开为完整技能块；它不调用 `read_skill`，也不表示 skill 依赖。未展开或未知的 `@skill(...)` 与裸 `@name` 按普通文本处理。`displayDescriptions` 面向用户解释能力，技能触发依据 `SKILL.md` 的描述，UI 配置不进入模型上下文。
- `read_skill` 独立于 Workspace Service，按 `name` 和可选包内相对 `path` 读取文件，默认 `SKILL.md`；路径必须规范且真实目标位于获胜包内，同名包不合并或回退。返回 `{ name, path, content, base_url }`。`base_url` 与显式 marker 注入共用宿主生成的原包根目录 file: URL，始终以 / 结尾，不随被读文件改变。脚本可直接执行，无需先读取技能。
- 同名覆盖在下一会话生效；catalog 外的新名称在 `read_skill` 时按同一优先级发现，不加入当前能力清单、mention 或 marker。包内文件在读取或后续 run 时消费当前磁盘内容，删除后正常失败；上下文中已有正文需显式重读才会更新。apply、快照刷新、对话重置和工程切换均不处理技能原文件。
- System Prompt 从静态 Markdown 加载，会话技能目录附加在正文之后。系统提示规定人格、任务边界、技能选择、CodeAct、业务单元与提交、协作恢复和完成要求。
- CodeAct 规定模型判断与程序执行的循环。程序连续完成已知步骤，模型读取必要材料并作出新判断，两者分别记录扫描与语义判断的范围。系统提示用业务单元安排共同判断与检查，用提交批次安排工程写入，并规定默认规模、逐单元或统一提交的条件、提交简报和回执核对要求。
- 模型遵守任务类型 `report / apply`，后端不持有任务类型状态机。`report` 允许分析和准备工作材料，工程写入及依赖写入结果的检查属于 `apply`，包括直接写入工具的操作。工具说明规定运行环境与权限，工具 Schema 和 `ws.contract` 定义参数、回执及快照恢复方式。
- 技能入口根据用户意图选择任务文件或判据。任务文件说明业务单元包含哪些对象、怎样计数，以及默认范围、取证方法、后续调查、提交条件、验收要求和成果。领域流程在使用处完整定义，并在关键步骤重申相关全局要求，让模型沿当前任务执行。各任务按需读取专业判据。
- 提取、系统整理和审校通过明确的入口进入对应任务文件。普通阅读理解、解释和判断按需使用领域判据，由模型围绕用户问题组织处理。包内判据提供对象资格、字段、安全与覆盖要求，指定修改按相关判据核验影响，并遵循通用写入契约。
- 格式与文本质量参考提供专业知识，各资源在使用位置注明所需判据、参考和脚本说明。
- 采用自启发调查的领域流程，在各自文件中完整描述冷启动、种子发现思路、反馈推进和结束条件。模型按流程维护种子列表，每个种子只记录模式和是否消耗，并在业务工作材料中保存证据、对象结论和未决事项。
- 所属技能入口驱动 `writing-guide-` 前缀扩展的加载，宿主不维护依赖图。
- 领域证据、关系图、方案与覆盖记录由模型按任务规模保存在工作资产中，工程事实以有效快照与实际回执为准；技能加载器和后端不维护领域流程状态。完整 `items` 决定条目范围，`warnings` 仅提供关联证据；`pages` 以来源页追踪内容，视觉核验定位到渲染后的输出页。Agent 页面消费 Markdown、Mermaid 和结构化决策状态，不从标题或表情符号推断领域状态。

## 4. 产品工具与宿主能力

- `AgentImageService` 由 GUI Backend 组合根创建，附件和 Workspace 共用实例，AgentService 拥有其会话清理，组合根关闭 Gateway 前取消在途图片准备以排空上传请求。后端按单次图片参数确定尺寸，与统一格式和字节额度组成不可变策略，Electron 图片宿主按该策略执行 Chromium 解码与 WebP 编码，符合规范的 WebP 复用原字节。SDK 关闭工具图片的额外自动缩放，模型消费固定结果。PDF 渲染资产仍按文件生命周期供预览与导出使用，模型图片是独立处理结果。
- 图片缓存只保存成功结果，以单次最长边上限与输入、规范输出字节摘要关联不可变图片，按内存预算淘汰。草稿和历史直接持有图片，淘汰不影响既有消息。缓存不落盘，重置、工程切换和 dispose 清空并取消旧转换，迟到结果不能回填。图片准备失败沿公开错误返回，base64 不进入诊断。

- `ws.emitImage(path, options?)` 的单次尺寸选项由父进程按 Schema 校验，模型声明使用同一 Schema。工作区在执行互斥内固定图片内容，按请求顺序收集。数量与累计编码额度按每次 `workspace_run` 独立计算，拒绝的请求释放占位且不计入累计大小。程序成功时返回已接收图片，整体失败时只返回路径和尺寸摘要，后续调用可从现有文件重新输出。公开工具结果与日志只保留摘要。
- PDF 调查使用 `mupdf`，`@lg/pdf` 提供渲染与正式文档生成。`ws.host` 按 Schema 桥接静态 HTML 打印，产物进入 `work/`。技能预览通过 `@lg/workspace/page-updates` 共用正式记录解析与页级判定，再覆盖快照副本并调用正式生成入口。目标更新被拒绝时预览停止，提交仍按最新事实判定并返回逐页回执。预览交付规则归 PDF 技能，正式 PDF 由用户通过应用导出。
- 翻译对象统一使用 `items/pages`，单个对象使用 `item/page`。`items` 以 `item_id` 为身份，正文与姓名属于同一对象；`pages` 以 `(file_path, page)` 为身份，对应原稿页，与渲染后的输出页分别计数。`project_meta.counts.items` 和 `project_meta.counts.pages` 分别从对应快照的同一份事实计算。
- `datasets.pages` 与 `changes.pages.updates` 分别公开页面快照和完整可修改载荷，路径为 `pages/entries.jsonl` 与 `changes/pages/updates.jsonl`。页面提交、拒绝 scope、实际写入回执及审批计数统一使用 `pages`。工作区 Schema 复用 PDF 内容结构；提交意图、指纹和更新解析归工程写入层。预演以对象身份查快照指纹，区分输入错误与外部漂移；提交刷新快照并保留相容 `work/`。PDF 来源与导出规则归 [BACKEND](BACKEND.md)。

- GUI 的 `WebSearchService` 拥有应用级供应商连接与成功来源偏好，工程切换不重置；工具按顺序调用，组合根先等待 Agent 释放，再关闭搜索连接。MCP 使用 [`BACKEND.md`](BACKEND.md) 的共用 HTTP transport；单家连接、调用与会话重建共用一次预算。取消或超时必须关闭本地连接，以终止旧协议取消通知之外仍可能存活的 HTTP。

- `run_batch_item_translation` 是处理 `items` 的顺序工具，接收全部条目或明确 `item_id` 范围及是否纳入失败条目的决定。工具以当前轮次的 Agent lease 调用共享 `BatchTranslationService`，批量引擎在运行中自行提交译文，等待提交与收尾后返回终态、本轮条目进度和工程条目累计进度。范围、失败条目决定与执行分流归 Agent 工作流。工具取消单向传给翻译，Agent lease 在 SDK settle 后释放，后续工作区操作重新加载工程快照。`stop_source: user` 或 `reason: keys_exhausted` 使 AgentService 缓存停止结果并暂停同轮翻译调用，重复调用返回缓存结果。用户取消后的收尾失败也保留停止事实与诊断。自动工具循环和压缩沿用暂停，新用户 round、显式 continue、重新运行、reset 与工程切换清理缓存。共享运行态与提交协议归 [`BACKEND.md`](BACKEND.md)。

- System Prompt 拥有通用决策规则，skill 拥有领域流程，工具说明提供调用与恢复语义。参数约束归 Schema，`workspace_run` 的限制与包名来自运行策略和依赖清单，`workspace_apply` 从 contract 投影提交与回执语义。
- 模型 FC 的 JSON 结果统一由 `model-tools/definition` 生成同源的模型正文与 `details`；FC 的 TypeBox Schema 独占模型参数，并统一使用跨供应商稳定的普通 `object` 根，条件字段组合由工具执行入口收窄。注册边界在模型请求前拒绝非 `object` 根和根级联合，且不按供应商改写 Schema。受控 `AppError` 只投影稳定 `code` 与公开字段，未知执行异常对模型固定为 `{ "code": "tool_failed" }`，原始异常只进入本地诊断。SDK 的 `tool_execution_start/end` 仍是完整持久化调用记录的唯一来源，覆盖参数校验失败、未知工具、成功和执行异常。
- `ask_user` 始终注册，承接任务开始前或执行中的单个有界决定，适用于可通过二至三个选项表达的范围、处理策略或偏好。`prompt`、`description` 与选项 `label` 均受 shared Agent 问题文本上限约束，分别承担简短问题、共用背景和短行动或结果；证据与长篇说明留在正文或工作资产中。通用交互原则归 System Prompt，领域技能拥有具体触发条件，调用、返回、到期与取消语义归工具说明。工具参数包含一个 `prompt`、可选的问题级 `description` 和二至三个身份唯一、按推荐顺序排列的固定选项；宿主提供自定义答案与取消。宿主提交固定选择时返回 `selected` 与其 `optionId`，自定义答案同样返回原工具轮次，显式取消返回 `cancelled`，模型暂停依赖该决定的动作。所有结果均返回原工具轮次，不追加公开 user 消息。完成后沿用普通工具条目与详情。工程写入授权使用独立权限入口，`allow_once` 仅允许当前批次写入。
- 当前对话只持有一份由短阶段标签组成的有界有序 Todo，不保存领域事实、工程证据或完成历史。每次 `workspace_run` 以当前 Todo 初始化 `ws.todo`；同步 `read()` 返回不可变副本，`write(todos)` 替换本次程序副本并通过 IPC 发送独立快照。runner 暂存最后有效值，进程成功退出且调用未取消时由 `AgentService` 原子提交；失败、停止或超时保留调用前状态。公开 Agent snapshot 与 SSE 使用 `todos` 投影完整数组，空数组表示不展示。
- `ws` 只提供当前契约、Todo、图片输出与宿主请求。领域程序按技能 `base_url` 从原包导入普通脚本，输入与返回值留在 Node 进程内，由程序保存工作资产并选择模型输出。技能的领域算法及调用说明随包维护；全局接口声明只描述运行时应用边界。
- `@lg/workspace/item-contexts` 提供条目邻近语境查询，调用约定归导出函数注释，随可读模块一起部署。调用方使用 Node 标准文件 API 读取数据，领域扫描接收条目数组或异步流。JSONL 记录按 LF 分行，正文中的 Unicode 分隔符属于字段内容。`@lg/text` 从正式字面匹配源码导出规范化与匹配能力，技能和应用共用 Unicode、大小写与原文坐标语义。领域扫描负责范围、完整计数与证据收集量，完整性由扫描结果表达；stdout/stderr 限额只限制输出，不改变内部计算。
- `ws.contract` 的类型外壳、磁盘索引和模型声明共用同一 Schema，索引只承载数据集与变更路径、`reference` 入口和通用 `apply` 契约。`workspace/schema` 拥有快照与变更记录结构，`contract` 关联路径、Schema 和对象语义，并生成轻量索引与按业务主题聚合的只读 `reference/*.md`。参考文档与工具 API 说明共用 `schema-description`，从原 Schema 生成字段和约束；对象特有副作用、排序与批次建议随主题提供。参考文档随快照创建、失败清理和刷新，模型使用 Node 文件 API 按需读取。
- `changes` 按相同记录 Schema 校验 JSONL 后转换为领域意图，缺失或空清单表示该类意图为空。纯指纹格式常量与业务字段词表位于无宿主依赖的 `shared/project/agent-workspace`，项目写入器负责事实、冲突与领域规则，`warnings` 直接使用 shared 校对词表和证据字段。运行时注入的冻结 `ws` 由 contract、Todo、emitImage 与 host 请求入口组成；运行时初始化按外壳 Schema 校验磁盘契约，再冻结独立副本。
- `items`、`pages`、quality entry 与 prompt 对象携带基于数据对象事实计算的指纹 `fp`，用于 `workspace_apply` 时校验该对象自工作区快照后是否仍保持一致；quality 额外携带零基 `sort`。显式变更清单按对象类型及其支持的操作分开，记录形状由源码 Schema 唯一定义，模型通过索引中的 `reference` 读取生成说明。
- `AgentWorkspaceService` 为每次执行保存同标识的程序与两路日志到 `work/runs/`，沿用 work 生命周期。runner 复用 Electron Node 模式，以 `--import` 预加载 ws 和系统代理 fetch，程序按事件循环自然退出。宿主先解析工作区与运行目录的真实路径，以运行目录为基准解析 `@lg/workspace/bootstrap` 包入口，并以整个运行目录授予只读权限。每次 run 从与 catalog 共用的 AppPathService 取得两个技能根，授予逻辑入口与真实路径只读权限；授权独立于同名选择，缺失目录不阻断执行，后续 run 重新解析。`--preserve-symlinks` 和 `--preserve-symlinks-main` 保留模块的工作区入口，使挂载的 work 仍能发现预装依赖，不同导入路径可形成独立模块实例。
- 子进程直接写入 stdout/stderr 文件，close 后两路独立按额度返回完整 content 或文件补读提示，JSON 对象与数组优先结构化。成功、非零退出和超时共用执行记录，取消保留已写文件。IPC 传初始化、Todo、图片输出与具名宿主请求。代理查询和宿主操作共用请求关联、取消和保活通道，空闲不保活。停止、超时或父通道断开时回收进程并取消待决请求；父进程等待宿主操作实际结算及进程、文件句柄收尾后才释放工作区互斥。运行中的宿主调用使用本次执行绑定的内部端口，不重新进入工作区公开互斥入口。
- 根 `package.json` 与锁文件拥有依赖版本，`workspacePackages` 只声明预装包名并供工具说明读取。`buildtools/build-workspace.mjs` 共用于开发、测试和发布，整体重建 `build/resources/workspace`。依赖部署通过 npm query 查询根安装树中的预装包及其间接依赖，保留安装相对位置和完整包资源，生成记录实际版本的 package.json；发布构建以前置根 npm ci 保证安装来源可复现。同一构建从 public/fonts 与 KaTeX 包生成工作区根目录的 pdf-print.css，字体内嵌且只由打印宿主加载。应用源码构建为 `@lg/workspace`、`@lg/text` 与 `@lg/pdf` 内部包，清单通过 exports 声明 `@lg/workspace/bootstrap`、`@lg/workspace/item-contexts`、`@lg/workspace/page-updates`、`@lg/text`、`@lg/pdf` 和 `@lg/pdf/worker` 入口；宿主通过 `src/native/workspace-runtime.ts` 从注入的运行目录解析入口，解析阶段不执行模块。PDF 库与 worker 共用一次多入口构建及包内 chunk，MuPDF JS/WASM 只部署一份，worker 和工作区均从此处解析。extraResources 从 build/resources 根复制整棵 workspace，以避开 builder 对复制源直属 node_modules 的过滤。GUI 与 CLI 共用运行目录定位，GUI 跨线程仅传 `workspaceRuntimeDirectory`，runAsNode fuse 保持开启。
- bootstrap 通过同步 resolve hook 将技能脚本的 npm 导入基准设为自身 URL，复用部署依赖树；内置模块、文件 URL、相对路径和依赖内部导入沿用 Node 默认规则及 exports 语义。内置技能保留在 app.asar，Electron Node 模式配合现有 preserve-symlinks 参数直接读取脚本与资源。
- 初始化复制生成的部署清单，并链接真实 node_modules（Windows 使用 junction）。这些环境文件跨快照与对话重置保留，清理只删除链接入口。work、changes 同时授权入口与实际目标，内部链接沿入口权限使用。工作区初始化与技能程序直接调用 Node 文件 API，主应用 IO 归 NativeFs。

## 5. 前端消费

- 后端按 `ui.json` 过滤、排序并补全 Agent skill snapshot；页面保持该顺序并按当前 locale 选择描述，不另建排序或翻译表。
- `AgentSessionStore` 跨路由持有经过 revision 校验的 snapshot / SSE 镜像、独立 transport、当前 command、`inputQueue`、审批模式、`pendingDecision`、模型可见历史 `context`、`todos`、普通 Composer 草稿与 renderer 全局纯文本输入历史；这些会话事实不进入 `DesktopStateProvider` 或项目 session UI 缓存。Store 通过 `useSyncExternalStore` 暴露 timeline、controls、queue、todo、skills 与 input 切片，actions 在 Store 生命周期内保持稳定；恢复时先拿到并订阅 EventSource 再读取 snapshot，连接断开是可逆的，旧连接世代的异步结果不得写回当前 Store。历史消息与队列项的修订草稿由页面原位编辑器短暂拥有，不覆盖普通 Composer 草稿。草稿与队列附件不写入 localStorage、项目资源、`.lg` 或 Agent 磁盘工作区；公开时间线、输入队列与模型历史中的附件随内存会话在 reset、工程切换或 dispose 时清理。
- `AgentCompletionAttention` 在跨路由会话镜像中观察一次运行从 `running` 收束到最终 round `success | error` 的转换，并忽略 `stopped`、reset 与自动队列中间轮次；确认后只请求宿主注意力，不新增 Agent SSE 事件或通知正文。
- 图片选择、拖入与粘贴只提交原始图片 base64 到 `POST /api/agent/image/prepare`，返回规范图片供草稿预览。消息发送、队列修改、修订与继续在受理前经过同一后端图片入口，异步准备结果不能跨 stop、reset 或工程切换提交。
- 恢复失败与已恢复会话断线由 transport 提供持续恢复路径；所有命令复用轻量 ack 与命令期 SSE revision 重放，删除、重排和立即发送的受理失败由页面解析为安全 Toast，队列原位编辑失败保留在编辑器旁，不写入共享会话状态。合法 message ack 与携带消息的 continue ack 都把非空文本更新到输入历史并原子清空普通 Composer 草稿，空 continue 不改写草稿或历史；队列项与时间线条目各自在目标位置展开独立编辑器，成功后由页面显式替换 user 输入历史，assistant 修改不改写输入历史。
- 页面持有活动原生选区与当前原位编辑目标；这些页面局部事实不进入 Agent snapshot、历史或发送协议。
- 每轮最后一个成功 assistant 正文允许把单一原生选区和可选评论确认到当前消息草稿，不建立来源定位或第二套批注状态。页面在状态区固定展示 Todo 队首与最多 5 条输入队列；Todo 完整列表在提示浮层中展示，并在超出可用高度时内部滚动，列表支持键盘聚焦；输入队列不使用内部滚动，输入队列达到上限时发送按钮显示容量提示并保持禁用，空数组不占位。
- 消息级“复制”与“编辑”共用当前可修订消息的操作区；复制仅对其中有正文的 user / assistant 开放且不改变会话状态，输入消息的保存并重试会重新运行最新 round。历史 user、assistant 与队列项各自在目标位置展开独立编辑器，失败时保留编辑内容。assistant 编辑隐藏附件与 marker 能力。输入框、引导卡片与时间线只把当前已知技能 marker 投影为整块视觉，不改变底层字符串或建立身份旁路。
- Agent round 运行态与 stop 命令不锁定普通草稿编辑；send、continue、revise、queue update 与 reset 受理期间相关编辑器只读。运行中有效普通草稿通过 message 入队，空草稿执行 stop；空闲且队列暂停时 Composer 统一执行 continue，可选草稿随请求追加队尾。压缩和 `workspace_apply` 期间仍允许有效普通草稿排队，但不可 stop。队列组件只消费后端顺序与能力快照，修改、删除、重排和立即发送均经页面调用 `AgentSessionProvider` 命令入口；steer user 不开放 round 的修改或重试操作。失败恢复仍由后端拥有，renderer 不监听终态补发命令。
