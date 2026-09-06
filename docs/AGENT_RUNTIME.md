# LinguaGacha 产品 Agent 工程边界

本文统一承载产品 Agent 的公开会话协议、运行态所有权、模型会话、启动资源、skill 与工具、宿主能力和前端消费。共享 Gateway、项目事务、模型请求与前端运行态分别归 [`BACKEND.md`](BACKEND.md) 和 [`FRONTEND.md`](FRONTEND.md)，进程拓扑归 [`ARCHITECTURE.md`](ARCHITECTURE.md)；字段级 schema、局部算法和产品语义留在代码、测试与当前产品设计中。

## 1. 公开会话协议

- Agent 公开入口提供 snapshot、message、写入请求审批模式 update、普通问题 resolve、写入授权 resolve、continue、输入队列 update / delete / reorder / send、最新轮次 revise、手动上下文压缩、stop 与 reset。message 请求和公开 user 条目携带规范化后的 `text` 与有序 `attachments`，附件只包含 renderer 生成的 WebP base64 图片或用户确认的回复批注，正文与附件不能同时为空。批注冻结所选助手正文与允许为空的用户评论，不追踪来源消息；后端只把选文和评论投影为模型可读的引用上下文，图片仍通过模型图片通道传递。
- 空闲且没有暂停队列时，message 建立新的公开轮次；运行时 message 进入当前会话最多保留 5 条的有界内存输入队列，达到上限后 renderer 禁止新增入队，AgentService 仍以共享上限拒绝越界请求。正常轮次成功后在同一运行 lease 内按 FIFO 续取，stop 或模型失败保留并暂停剩余队列。continue 原子追加可选消息、解除暂停，并按需恢复失败 round 或启动队首；空 continue 只表达继续意图。立即发送在空闲时启动选中 round，在运行时经 Pi `steer` 发送，并仅在对应 user `message_start` 后从 `sending` 提交为成功的 `delivery: steer` 条目；提交前失败、停止或取消恢复为 `queued`。普通 user 使用 `delivery: round`；只有 round 建立 SDK history checkpoint 和轮次终态，因而可作为 revise（包括以原输入重新运行）与失败 continue 的目标。
- revise 目标为最新 round user 时删除整轮旧尝试并以完整替换消息重新调用模型，替换为原输入即表示重试；目标为该轮最终可见 assistant 时保留此前 user 与工具历史、写入零 usage 的纯文本 assistant 而不调用模型。continue 以隐藏“继续”消息续跑失败的原 user 轮次。两种操作都要求会话空闲，revision 另校验最新 round 输入或最终输出身份；更早轮次、steer 输入和同轮中间 assistant 不可修订。会话状态只区分 `idle | running`；round user、assistant 与 tool 条目携带 `running | success | error | stopped` 状态，steer user 只在成功提交后公开，上下文压缩条目只使用 `running | success | error`。
- `AgentSessionSnapshot` 与所有 `agent.session_event` 都携带同一会话内单调 `revision`；`snapshot_seed` 先分配 revision，再用同值构造事件顶层和嵌套快照。普通 message、continue、队列、用户决定、审批模式、revise、手动压缩、stop 与 reset 命令只返回 `{ revision }` 的 `AgentCommandAck`，公开事实必须由增量事件表达；手动压缩在 `context_compaction` running 条目发布后返回 ack，最终 success / error 由后续增量事件结算。完整 snapshot 只用于首次加载、重连、revision 缺口和 reset 恢复。renderer 对旧 / 重复事件丢弃，对缺口暂停应用并重新 GET 快照。
- 时间线由 snapshot 与 revisioned `agent.session_event` 共同恢复本次 reset 以来的内存历史；连续的压缩尝试复用最近一次失败 entry。公开 assistant 条目只保留非空白的 text / thinking parts、合并相邻同类且至少包含一项；空投影不产生条目。公开 `context` 同时携带模型可见历史的估算 token 与后端判定的 `compactable`；模型失败只写入对应条目和轮次，不发布第二套失败事件。公开工具条目冻结规范化后的完整输入，并只在 SDK 工具终帧后携带模型实际收到的文本输出；公开协议不承载 SDK 原始参数引用、结构化 details、压缩诊断、供应商连续性元数据或脱敏思考。
- 工具 `running` 条目在执行体开始前发布；所有产品工具在统一注册边界先让出一次事件循环，为本地 SSE 首帧提供独立发送轮次。

## 2. 状态与生命周期

|状态|拥有者|唯一入口|
|---|---|---|
|公开状态、完整 UI 时间线、会话生命周期与启动期资源|`AgentService`|Agent API、`agent.session_event`|
|模型可见历史、工具循环、上下文压缩、中断与 settle|内存 `AgentSession`|`AgentService` 调用 SDK 的 prompt、模型切换与关闭 API|
|用户输入队列与暂停 / 发送状态|`AgentService`|Agent message、continue 与 queue API|
|模型对话级有序 Todo|`AgentService`|`ws.todo`、Agent API 与 `agent.session_event`|
|当前唯一用户决定、固定期限与一次性裁决|`AgentDecisionCoordinator`|各类用户决定 resolve API 与 `agent.session_event`|
|工程写入审批模式|`AgentService`|approval mode API 与 `workspace_apply` 成功结果|
|当前对话 `task`、数据快照与显式变更清单准备|`AgentWorkspaceService`|`workspace_script`、`workspace_apply`|

### 用户决定与会话配置

- 当前回合至多建立一个 `pendingDecision`，由 `AgentDecisionCoordinator` 统一持有普通问题与写入授权的五分钟期限、取消和一次性裁决，各自使用窄 resolve API。后端根据发布时的快照执行到期裁决，renderer 按后端绝对期限展示默认选项的倒计时；默认选项由共享契约定义，结果语义见下文工具契约。裁决先清除 pending，再在下一事件循环恢复工具。reset、工程切换和 dispose 取消当前等待。
- Agent 批量翻译模型偏好属于应用设置 `model_selection.agent_batch_translation`，默认 `null` 表示跟随，显式模型 ID 表示固定选择，跨会话与工程保留；由 `ModelService` 校验并保存，运行中允许修改，删除被引用的模型或修复失效配置时恢复跟随。`run_batch_translation` 调用时同步解析偏好：跟随使用成功建会话或换模后保存的 Agent 生效配置与思考档位，固定选择使用该模型自身保存配置，即使其 ID 等于当前 Agent 模型也保持固定语义。每次批量翻译调用冻结所用配置，运行中修改偏好影响后续调用。
- Agent 模型与思考档位属于应用设置，运行中保存后在下一次普通轮次、失败继续或手动压缩开始前采用。普通命令在受理前完成模型预检；FIFO 自动轮次在实际执行时通过同一模型同步方法预检，失败记入该轮并暂停剩余队列。轮内工具循环与 steer 使用当前轮次配置。公开 context 携带当前会话的历史 tokens 与实际 limits。
- 写入请求审批模式默认 `manual`，`auto` 直接提交工程数据变更，`manual` 为每个实际提交批次建立写入授权。待决状态使用同一份已准备差异生成按业务种类聚合的受影响对象数量；允许后续写入在当前批次成功且用户未更新模式时切换为 `auto`；允许本次写入（含到期默认裁决）、拒绝或提交失败沿用当前模式。reset、工程切换和应用重启恢复为 `manual`。运行中可切换模式，每批开始时确定审批方式，已展示的审批继续等待原裁决。

### 运行控制与恢复

- Agent 完全内存化。消息受理到当前 round 及自动 FIFO 链最终 settle 期间持有同一 [`RuntimeOperationGate`](BACKEND.md) lease，等待用户决定也不释放；Pi 在 SDK run 内拥有工具循环、自动压缩和压缩后的续跑。
- 手动压缩只在稳定空闲且有可压缩旧段时受理，以独立 Agent lease 更新模型配置、发布 running 条目并后台调用同一压缩入口，不建立公开 round。ack 返回后仍持有 lease，关闭屏障等待 settlement 退出。
- Pi `agent_start / agent_end`、压缩事件和 `pendingDecision` 共同决定 `canSendNow`，使异步预检、用户决定、压缩与结算窗口中的 steer 受同一条件约束。
- continue 在同一 lease 内恢复失败 round 或启动队首；失败 user 原位保留历史，不追加公开“继续”user，恢复失败时重新暂停队列。stop 同步封口 round 并异步取消 SDK，到最终 settle 才释放 lease；压缩和 `workspace_apply` 不可 stop。
- 输入队列与 Todo 跨普通回合、stop、continue、模型失败和压缩保留，reset、工程切换和 dispose 时清理。round user 与最终 assistant 修订按各自 SDK history checkpoint 裁剪活动路径，不回滚已发生的外部副作用。
- 显式 reset 与 `ProjectSessionState.mark_loaded` / `clear` 会立即隔离公开会话并等待旧运行时清理；同一工程内的项目事实变化不重置公开时间线或模型历史，已失效运行时的迟到阶段不得改写条目、发布终态或启动模型请求。

### 工作区投影

- GUI Agent 在 `userdata/agent/workspace` 持有固定物理工作区：数据快照、`changes`、`scratch`、`task` 与 `sources` 都使用真实相对路径。task 绑定当前 Agent 对话、工程 epoch 与权威语言；这些目录都是 Agent 工作资产，公开会话和项目事实分别由 `AgentService` 与项目读写边界拥有。
- 工程加载从 `.lg` 原始资产生成 `sources`；同一工程 `epoch` 与文件修订号复用同一投影，文件修订号变化时完整重建。`workspace_script` 在普通 section revision 后刷新数据快照、空 change 文件和 `scratch`，保留相容的 `task`；reset 清除快照和 task 并保留相容 sources，工程切换与应用启动清除旧工作区。`sources` 生成和目录清理故障进入诊断，项目加载与提交事实保持其权威结果。
- 普通文本映射为单文件，EPUB / XLSX 按容器内部路径展开文本成员。
- 每次 `workspace_script` 启动一个 Deno 子进程，跨调用状态只由文件承担。脚本成功、失败、超时或停止后已经完成的文件写入均保留；后续调用按需要重新读取并修复或覆盖，不建立工作文件事务或回滚。

## 3. 模型、资源与 skill

- Agent 与 OneShot 共用 [`BACKEND.md`](BACKEND.md) 定义的唯一模型能力解析和请求覆盖边界。模型配置中的 `agent.context_window` 与 `agent.max_output_tokens` 各自以 `0` 表示自动：自动上下文采用同 canonical ID 全部 Pi 记录的最大窗口；自动输出先取模型最大输出与产品档位的较小值，模型最大窗口低于 500K 时产品档位为 32K，否则为 64K。用户非零值优先，最终输出仍不得超过 `context_window - 32K`；格式损坏或无法容纳固定预留时整组恢复 `0/0`。每次 Agent 模型操作前把生效容量与已经确认可用的思考等级同步到既有 `AgentSession`，请求期保持该档位稳定。页面从 `context_window - max_output_tokens - 32K` 起预警；设置作用于同一对话的下一次模型操作，不重建或清空模型历史。模型页 generation 和 threshold 输入 / 输出 token 设置只作用于 OneShot。隐藏“继续”消息在操作发起时按当前 `app_language` 解析。
- Agent 模型在 Pi 请求边界固定声明 text / image 输入；消息附件中的批注先进入 text prompt，规范 WebP 则直接交给当前供应商，OneShot 仍只声明 text。产品不探测或配置具体模型的视觉能力，不自动删图、降级或回退 JPEG，供应商拒绝图片时沿用普通模型失败语义。
- 模型可见上下文超过 `context_window - 32K` 时，`AgentSession` 在新用户请求前、自然结束后，以及完整工具批次与下一次 assistant 请求之间统一自动压缩；空闲会话也可由公开手动入口立即压缩。历史切点完全交给 SDK，保留侧不拆分 assistant 工具调用与其结果；`AgentService` 只把 SDK 压缩事件投影到公开时间线，成功后 `context` 采用 SDK 对新模型历史的估算并重新计算可压缩性，失败保留原上下文快照并沿用 SDK 后续请求语义。
- Workspace 是 `AgentService` 的构造依赖、初始化前置和恒定工具面，初始化失败会阻止 Agent 启动资源完成加载。Agent 启动期原子加载必需的 `builtin/agent/system_prompt.md` 与 `builtin/agent/session_seed.json`；会话种子由零个或多个顺序任意的 user / assistant 消息组成，文本裁剪后允许为空，按资源顺序进入每个新会话的模型历史但不进入公开时间线，任一资源缺失或结构无效都会阻止启动。GUI Backend 的完整装配与启动顺序归 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
- coding-agent 的默认工具与项目资源发现全部关闭，SDK 不发现项目 `AGENTS.md`、`.pi` 或其它运行期资源。产品在初始会话及每次 reset 或工程切换时按用户目录、当前版本内置目录的优先级依次扫描，同名 skill 取首个有效定义，坏 skill 只记录诊断；安装根的历史资源目录不参与发现。形成的会话 catalog 同时拥有 System Prompt 能力清单、公开 mention、用户 marker 注入和名称到获胜 skill 包的内部绑定，并在当前对话内冻结。模型能力清单只公开名称与描述，显式注入块只公开名称与正文；`SKILL.md` 描述同时作为模型描述和 `ui.json` 展示描述缺失时的回退。
- `agent-charter` 是隐藏但保留在模型能力清单中的最高层任务宪章；其短正文与 System Prompt 的“任务与准则”有意重复。模型负责确保它在任务前已经加载；后端不注入任务阶段副本，也不跟踪加载状态。
- `ui.json` 的 `visible` 只控制公开列表和用户 marker：隐藏 skill 不进入公开快照，用户输入的同名 marker 不展开，但不影响模型能力清单或文件读取；`disableModelInvocation` 只排除模型能力清单，因此可见且禁用模型调用的 skill 仍能由用户 marker 显式注入。`@skill(name)` 是用户消息中的显式技能 marker，已知且公开时由宿主直接展开为完整技能块；它不调用 `read_skill`，也不表示 skill 依赖。未展开或未知的 `@skill(...)` 与裸 `@name` 按普通文本处理，UI 配置不进入模型上下文。
- `read_skill` 只接收 skill `name` 与可选包内相对 `path`，默认读取 `SKILL.md`，不向模型暴露来源或磁盘位置。skill 正文声明的前置或条件组合技能统一由模型调用 `read_skill` 加载，组合本身不改变任务对象、范围或工作区权限。当前 catalog 已有的名称始终使用会话冻结的获胜 skill 包；未知名称在调用时按同一优先级实时发现，因此会话中新增长出的名称可显式读取但不进入 System Prompt、mention 或 marker，同名新覆盖则到下一会话才生效。正文与包内文件实时读取，同名 skill 不合并目录或向失败者回退；目录穿越、绝对路径、非规范路径和真实目标越出获胜包均拒绝。
- System Prompt 统一拥有最高层任务准则、对外人格、结果表达、跨任务术语前置、CodeAct 执行范式及示例、提交恢复与交互路由；参数用法归工具 Schema，工作区回执字段归 `ws.contract`。静态 Markdown 模板直接拥有完整的 Agent 工作区章节和顺序，资源加载器只在原位填充权限范围与模块限制，形成跨会话字节稳定的基础 System 前缀，再在其后拼接会话 skill catalog。除有意重复该短准则的 `agent-charter` 外，skill 只补充领域概念、业务信息与工作资产归属、判断逻辑、证据方法和停止条件；仅当某个正式数据工具本身构成流程语义或结果契约时直接点名，不描述其调用参数、文件 API 或通用工具编排。Agent 页面忠实消费模型 Markdown、Mermaid 与结构化决策状态，不从标题或 emoji 反向推断领域状态。
- 领域流程记录由模型维护在工作资产中，技能加载器与后端不维护领域流程状态；阶段完成依据来自工作资产与实际工具结果，具体组合、判据、字段与恢复规则归各技能包。

## 4. 产品工具与宿主能力

- `run_batch_translation` 是顺序工具，接收全量或明确 item ID 范围及是否纳入失败条目的决定，以当前 round 的 Agent lease 调用共享 `BatchTranslationService`；由批量引擎在运行中自行提交译文，等待提交与收尾后返回终态、本轮进度和工程累计进度。范围、失败条目决定与执行分流归 Agent 工作流；工具取消单向传给翻译，Agent lease 在 SDK settle 后释放，后续工作区操作重新加载工程快照。`stop_source: user` 使 AgentService 缓存停止结果并暂停同轮翻译调用，收尾失败也保留停止事实与诊断；自动工具循环和压缩沿用暂停，新用户 round、显式 continue、重新运行、reset 与工程切换清理缓存。共享运行态与提交协议归 [`BACKEND.md`](BACKEND.md)。

- 工具模块拥有模型可见的用途、调用要求、结果、副作用与特有恢复说明，参数 Schema 只描述字段含义和约束。`workspace_script` 从运行策略生成环境与限制；`workspace_apply` 从 `contract` 的同一份提交语义投影关键副作用和回执。System Prompt 保留通用协作、信任边界与任务流程。
- 模型 FC 的 JSON 结果统一由 `model-tools/definition` 生成同源的模型正文与 `details`；FC 的 TypeBox Schema 独占模型参数，并统一使用跨供应商稳定的普通 `object` 根，条件字段组合由工具执行入口收窄。注册边界在模型请求前拒绝非 `object` 根和根级联合，且不按供应商改写 Schema。受控 `AppError` 只投影稳定 `code` 与公开字段，未知执行异常对模型固定为 `{ "code": "tool_failed" }`，原始异常只进入本地诊断。SDK 的 `tool_execution_start/end` 仍是完整持久化调用记录的唯一来源，覆盖参数校验失败、未知工具、成功和执行异常。
- `ask_user` 始终注册，承接任务开始前或执行中的单个有界决定，适用于可通过二至三个选项表达的范围、处理策略或偏好。通用交互原则归 System Prompt，领域技能拥有具体触发条件，调用、返回、到期与取消语义归工具说明。工具参数包含一个 `prompt`、可选的问题级 `description` 和二至三个身份唯一、按推荐顺序排列的固定选项；宿主提供自定义答案与取消。到期采用第一项并返回 `selected` 与其 `optionId`，手动选择和自定义答案同样返回原工具轮次，显式取消返回 `cancelled`，模型暂停依赖该决定的动作。所有结果均返回原工具轮次，不追加公开 user 消息。完成后沿用普通工具条目与详情。工程写入授权使用独立权限入口，到期采用 `allow_once`，对应界面第二项，仅允许当前批次写入。
- 当前对话只持有一份由短阶段标签组成的有界有序 Todo，不保存领域事实、工程证据、百分比、完成历史或完成判据。每次 `workspace_script` 启动时以当前 Todo 初始化 `ws.todo`；脚本通过同步 `read()` 读取不可变副本，通过同步 `write(todos)` 替换本次脚本副本。脚本成功时最终 Todo 随结果 envelope 返回并由 `AgentService` 原子提交，脚本失败、停止或超时保留调用前状态；公开 Agent snapshot 与 SSE 使用 `todos` 投影完整数组，空数组表示不展示。
- 工作区工具由 `workspace_script` 与 `workspace_apply` 组成，并随每个 `AgentService` 恒定注册。`AgentService` 负责会话和工具注册，`AgentWorkspaceService` 拥有工程数据快照与显式变更提交协调。
- 每个 Workspace 数据工具模块共同拥有用途、参数 Schema、结果 Schema 与类型化执行入口；机器可读注册表只列举工具集合，`ws.tool` 与模型可见 TypeScript 协议由该集合投影，并随恒定注册的 `workspace_script` 顶层工具说明提供完整能力发现。字段描述与结构约束共同进入生成声明；脚本内数据工具可使用判别联合表达相关参数。未知参数在统一分发边界按 Schema 收窄，结构错误返回字段路径与要求，领域实现通过按数据集命名的流式只读端口消费类型化快照，结果在同一边界复核模型契约。HTML 字符串与响应流转换同样位于 `ws.tool`，只公开稳定的 `baseUrl`、正文选择和 CSS selector 参数，底层 npm 实现随单文件 runtime 构建而不进入产品契约。
- `matchLiterals` 的覆盖核验消费各模式全部字段证据页，完整计数独立于分页。各页重新扫描同一快照，不维护跨调用游标状态；快照或模式变化后重新取得证据。分页参数与字段范围归工具 Schema。
- `ws.contract` 的类型外壳、磁盘对象和模型声明共用同一 Schema；`workspace/schema` 统一拥有快照与变更记录结构，`contract` 组合布局与提交语义，`changes` 按相同 Schema 校验 JSONL 后转换为领域意图。纯指纹格式常量与业务字段词表位于无宿主依赖的 `shared/project/agent-workspace`，项目写入器负责事实、冲突与领域规则。标准 JSON Schema 描述当前快照的数据集与变更记录，路径、`limits`、`effects`、`guidance` 和 `apply` 契约也由该对象拥有，`warnings` 直接使用 shared 校对词表和证据字段。Deno 注入的冻结 `ws` 由 contract、Todo 与工具树组成，文件访问统一使用 Deno 标准 API。
- `workspace_script` 按需建立或刷新完整只读快照、空变更清单文件和当前对话 `task`。`items`、quality entry 与 prompt 对象携带基于数据对象事实计算的指纹 `fp`，用于 `workspace_apply` 时校验该对象自工作区快照后是否仍保持一致；quality 额外携带零基 `sort`。显式变更清单按 `items`、`prompts` 和各质量规则类型的 create/update/delete 分开，记录形状由 contract 中对应 Schema 唯一声明。
- TypeScript 异步函数体通过 Deno 原生模块加载器转译，并在一次性固定版本进程中运行。运行时策略统一投影可写根、限制参数、超时、结果上限与数据工具默认值及上限；Deno 可读取完整工作区，只能写入 `changes`、`task` 与 `scratch`，可使用原生网络，但不能访问外部模块、环境、系统信息、子进程或 FFI。stdin / stdout 使用窄 JSONL 协议承载启动、系统代理解析和最终有界结果，脚本诊断进入 stderr；超时或停止先终止进程、取消待决代理请求并等待退出，再释放工作区串行边界。
- Deno 二进制按 Windows、macOS、Linux 的 x64 与 ARM64 目标由单一版本 manifest 管理，发布压缩资产与解压后二进制分别携带 SHA-256；目标二进制校验通过时直接复用，否则校验压缩资产和二进制后安装。Runner 从该 manifest 读取期望版本并在应用启动时校验当前目标二进制。发布包只带当前目标资产，开发态使用项目构建缓存，二者都不查询系统 `PATH`；afterPack 只安装目标资产与已经生成的 runtime bundle。
- `workspace_apply` 单次读取一个提交批次的显式变更清单，按对象 `fp` 与领域规则逐行处理；Item 预演与事务提交都把受影响同文组的被动状态变化计入 actual applied，审批摘要与回执使用该实际数量。正常结果固定包含 `status`、`applied`、`rejected`、`destroyed` 与 `revisions`；status 为 `applied | partial | rejected | unchanged`。实际提交或目标事实漂移返回 `destroyed: true`，输入错误、无变化和回滚保留工作区。
- Agent 工作区任务先完成确定性处理，再按 System Prompt 的规模建议与领域边界组织固定范围内的开放式语义业务单元。提交安排由用户目标和领域依赖决定：完整范围验收后统一准备提交，或逐业务单元提交并刷新事实；每次 `workspace_apply` 处理一个批次，实际成功对象在同一事务写入，拒绝项按真实回执处理。System Prompt 统一规定成功变更作为后续工程基线、失败恢复仅重试尚未成功变更，以及新证据或用户要求触发的后续修改基于最新对象事实重新准备并按当前审批模式提交。领域工作流核对实际结果并将新证据回流，完成声明同时满足发现、验收与回执要求。开放式语义批次先输出完整业务结果，手动模式由审批界面承接用户决定，工具返回后输出执行回执。用户只在范围、标准、提交要求、写入策略或语义未决需要决定时介入。
- GUI Agent 只把 `web_search` 注册为模型 FC；它通过固定的 Exa、Tavily、Firecrawl、AnySearch 与 Keenable 无凭据 MCP 工具实现统一查询 Schema 和错误契约，不动态投影远端工具。模型提交自然语言查询后，供应商协议或业务失败进入同一回退链；应用级搜索服务从 Exa 开始，当前来源失败时环形尝试其余来源并将成功来源晋升为首选，该内存状态跨工程切换复用、应用重启后重置，五家会话按需建立并复用，组合根在 Agent 之后统一释放。
- 网页读取、批量编排、筛选、聚合与工作文件落盘由 `workspace_script` 内的 Deno 原生 `fetch` 和 `ws.tool` 完成。全局 `fetch` 在每次调用开始时经 JSONL 通道请求 Backend 使用 Electron session 解析当前 URL 的系统代理路线，Deno 为代理路线复用显式 `HttpClient`，DIRECT 使用确定的直连环境；原生重定向链复用初始路线。其它 Deno 网络 API 沿用运行时原生语义。System Prompt 是搜索摘要和网页正文不可信规则的唯一归宿。

## 5. 前端消费

- 后端按 `ui.json` 过滤、排序并补全 Agent skill snapshot；页面保持该顺序并按当前 locale 选择描述，不另建排序或翻译表。
- `AgentSessionStore` 跨路由持有经过 revision 校验的 snapshot / SSE 镜像、独立 transport、当前 command、`inputQueue`、审批模式、`pendingDecision`、模型可见历史 `context`、`todos`、普通 Composer 草稿与 renderer 全局纯文本输入历史；这些会话事实不进入 `DesktopStateProvider` 或项目 session UI 缓存。Store 通过 `useSyncExternalStore` 暴露 timeline、controls、queue、todo、skills 与 input 切片，actions 在 Store 生命周期内保持稳定；恢复时先拿到并订阅 EventSource 再读取 snapshot，连接断开是可逆的，旧连接世代的异步结果不得写回当前 Store。历史消息与队列项的修订草稿由页面原位编辑器短暂拥有，不覆盖普通 Composer 草稿。草稿与队列附件不写入 localStorage、项目资源、`.lg` 或 Agent 磁盘工作区；公开时间线、输入队列与模型历史中的附件随内存会话在 reset、工程切换或 dispose 时清理。
- `AgentCompletionAttention` 在跨路由会话镜像中观察一次运行从 `running` 收束到最终 round `success | error` 的转换，并忽略 `stopped`、reset 与自动队列中间轮次；确认后只请求宿主注意力，不新增 Agent SSE 事件或通知正文。
- 图片文件入口和协议归一由 renderer 拥有；文件选择、拖入与粘贴在发送前统一转换为公开协议要求的 WebP，后端不承担文件解码、格式探测或回退。
- 恢复失败与已恢复会话断线由 transport 提供持续恢复路径；所有命令复用轻量 ack 与命令期 SSE revision 重放，删除、重排和立即发送的受理失败由页面解析为安全 Toast，队列原位编辑失败保留在编辑器旁，不写入共享会话状态。合法 message ack 与携带消息的 continue ack 都把非空文本更新到输入历史并原子清空普通 Composer 草稿，空 continue 不改写草稿或历史；队列项与时间线条目各自在目标位置展开独立编辑器，成功后由页面显式替换 user 输入历史，assistant 修改不改写输入历史。
- 页面持有活动原生选区与当前原位编辑目标；这些页面局部事实不进入 Agent snapshot、历史或发送协议。
- 每轮最后一个成功 assistant 正文允许把单一原生选区和可选评论确认到当前消息草稿，不建立来源定位或第二套批注状态。页面在状态区固定展示 Todo 队首与最多 5 条输入队列；Todo 完整列表在提示浮层中展示，并在超出可用高度时内部滚动，列表支持键盘聚焦；输入队列不使用内部滚动，输入队列达到上限时发送按钮显示容量提示并保持禁用，空数组不占位。
- 消息级“复制”与“编辑”共用当前可修订消息的操作区；复制仅对其中有正文的 user / assistant 开放且不改变会话状态，输入消息的保存并重试会重新运行最新 round。历史 user、assistant 与队列项各自在目标位置展开独立编辑器，失败时保留编辑内容。assistant 编辑隐藏附件与 marker 能力。输入框、引导卡片与时间线只把当前已知技能 marker 投影为整块视觉，不改变底层字符串或建立身份旁路。
- Agent round 运行态与 stop 命令不锁定普通草稿编辑；send、continue、revise、queue update 与 reset 受理期间相关编辑器只读。运行中有效普通草稿通过 message 入队，空草稿执行 stop；空闲且队列暂停时 Composer 统一执行 continue，可选草稿随请求追加队尾。压缩和 `workspace_apply` 期间仍允许有效普通草稿排队，但不可 stop。队列组件只消费后端顺序与能力快照，修改、删除、重排和立即发送均经页面调用 `AgentSessionProvider` 命令入口；steer user 不开放 round 的修改或重试操作。失败恢复仍由后端拥有，renderer 不监听终态补发命令。
