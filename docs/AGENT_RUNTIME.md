# LinguaGacha 产品 Agent 工程边界

本文统一承载产品 Agent 的公开会话协议、运行态所有权、模型会话、启动资源、skill 与工具、宿主能力和前端消费。共享 Gateway、项目事务、模型请求与前端运行态分别归 [`BACKEND.md`](BACKEND.md) 和 [`FRONTEND.md`](FRONTEND.md)，进程拓扑归 [`ARCHITECTURE.md`](ARCHITECTURE.md)；字段级 schema、局部算法和产品语义留在代码、测试与当前产品设计中。

## 1. 公开会话协议

- Agent 公开入口提供 snapshot、message、continue、输入队列 update / delete / reorder / send、最新轮次 revise、stop 与 reset。message 请求和公开 user 条目携带规范化后的 `text` 与有序 `attachments`，附件只包含 renderer 生成的 WebP base64 图片或用户确认的回复批注，正文与附件不能同时为空。批注冻结所选助手正文与允许为空的用户评论，不追踪来源消息；后端只把选文和评论投影为模型可读的引用上下文，图片仍通过模型图片通道传递。
- 空闲且没有暂停队列时，message 建立新的公开轮次；运行时 message 进入当前会话的有界内存输入队列。正常轮次成功后在同一运行 lease 内按 FIFO 续取，stop 或模型失败保留并暂停剩余队列。continue 原子追加可选消息、解除暂停，并按需恢复压缩、失败 round 或队首；空 continue 只表达继续意图。立即发送在空闲时启动选中 round，在运行时经 Pi `steer` 发送，并仅在对应 user `message_start` 后从 `sending` 提交为成功的 `delivery: steer` 条目；提交前失败、停止或取消恢复为 `queued`。普通 user 使用 `delivery: round`；只有 round 建立 SDK history checkpoint 和轮次终态，因而可作为 revise（包括以原输入重新运行）与失败 continue 的目标。
- revise 目标为最新 round user 时删除整轮旧尝试并以完整替换消息重新调用模型，替换为原输入即表示重试；目标为该轮最终可见 assistant 时保留此前 user 与工具历史、写入零 usage 的纯文本 assistant 而不调用模型。continue 必要时先原位恢复压缩，再以隐藏“继续”消息续跑原 user 轮次；已完成轮次的压缩失败只恢复模型历史。两种操作都要求会话空闲，revision 另校验最新 round 输入或最终输出身份；更早轮次、steer 输入和同轮中间 assistant 不可修订。会话状态只区分 `idle | running`；round user、assistant 与 tool 条目携带 `running | success | error | stopped` 状态，steer user 只在成功提交后公开，上下文压缩条目只使用 `running | success | error`。
- 时间线由 snapshot 与 `agent.session_event` 通过同 id 完整条目覆盖和 `snapshot_seed` 共同恢复本次 reset 以来的内存历史；未解决的上下文压缩在自动再试与“继续”时复用原 entry。公开 assistant 条目只保留非空白的 text / thinking parts、合并相邻同类且至少包含一项；空投影不产生条目。公开快照只携带模型可见历史的估算 token；模型失败只写入对应条目和轮次，不发布第二套失败事件。公开工具条目冻结规范化后的完整输入，并只在 SDK 工具终帧后携带模型实际收到的文本输出；公开协议不承载 SDK 原始参数引用、结构化 details、压缩诊断、供应商连续性元数据或脱敏思考。
- 工具 `running` 条目在执行体开始前发布；所有产品工具在统一注册边界先让出一次事件循环，为本地 SSE 首帧提供独立发送轮次。

## 2. 状态与生命周期

|状态|拥有者|唯一入口|
|---|---|---|
|公开状态、完整 UI 时间线、会话生命周期与启动期资源|`AgentService`|Agent API、`agent.session_event`|
|模型可见历史、工具循环、上下文压缩、中断与 settle|内存 `AgentSession`|`AgentService` 调用 SDK 的 prompt、模型切换与关闭 API|
|用户输入队列与暂停 / 发送状态|`AgentService`|Agent message、continue 与 queue API|
|模型对话级动态工作队列|`AgentService`|`task_progress`|
|当前对话 task、数据快照与显式 change 准备|`AgentWorkspaceService`|`workspace_load`、`workspace_script`、`workspace_apply`|

- Agent 运行时完全内存化。消息受理到当前 round 及其自动 FIFO 链最终 settle 期间持续持有 [`RuntimeOperationGate`](BACKEND.md) 的同一运行 lease；单个 round 可以跨越多个 SDK run，但只在 SDK settle 的安全边界压缩，并以隐藏的“继续”消息保持同一公开轮次。Pi `agent_start / agent_end` 与压缩事件共同决定公开 `canSendNow`，避免在异步预检、压缩或结算窗口接受 steer。用户输入队列跨 round、stop 与模型失败保留，`task_progress` 跨普通模型回合、stop、continue 与压缩保留；两者都在 reset、工程切换和 dispose 时清理。round user 与最终 assistant 修订分别使用写入模型历史前记录的 SDK leaf 裁剪活动路径；裁剪保留此前模型历史，但不回滚已经发生的外部副作用。
- continue 从受理到压缩、失败 round 恢复或队首启动持有同一运行 lease，失败时重新暂停剩余队列；失败 user 原位恢复并保留既有公开条目与模型历史，不追加公开“继续”user。stop 同步封口当前 round 后异步取消 SDK，lease 到最终 settle 才释放。压缩和 `workspace_apply` 不可 stop；reset、工程切换和 dispose 通过关闭屏障隔离旧会话。
- 显式 reset 与 `ProjectSessionState.mark_loaded` / `clear` 会立即隔离公开会话并等待旧运行时清理；同一工程内的项目事实变化不重置公开时间线或模型历史，已失效运行时的迟到阶段不得改写条目、发布终态或启动模型请求。
- GUI Agent 在应用 userdata 中持有活动 UUID 数据快照及其同级 `task`、`sources`。task 在当前 Agent 对话、工程 epoch 与权威语言内跨 load、普通 section revision、apply、stale 和 revision 冲突保留；内容结构及使用方式完全由模型决定，不自动进入模型上下文或项目事实。
- 工程加载时从 `.lg` 原始资产生成 sources，同一工程 epoch 与 files revision 内复用，files revision 变化后由下一次 load 替换；普通文本保留为单文件，EPUB / XLSX 保留容器内部路径并只展开文本成员。新 load 全部成功后才替换旧快照；成功 `workspace_script` 将 change、task 和 scratch 作为同一文件事务提交，脚本失败、取消或结果无效只回滚本次运行。普通 revision、apply 和 stale 只清理快照；reset、工程身份、epoch 或语言变化、无法补偿的文件事务、未知宿主失败、dispose 和下次启动同时清理 task。change 校验与数据库回滚保留快照，sources 生成失败不回滚工程加载。目录清理失败只留诊断，不改变项目提交事实；task、快照与 sources 都不进入 Agent snapshot、模型历史或项目事实。

## 3. 模型、资源与 skill

- Agent 与 OneShot 共用 [`BACKEND.md`](BACKEND.md) 定义的唯一模型能力解析和请求覆盖边界。模型配置中的 `agent.context_window` 与 `agent.max_output_tokens` 各自以 `0` 表示自动：自动上下文采用同 canonical ID 全部 Pi 记录的最大窗口；自动输出先取模型最大输出与产品档位的较小值，模型最大窗口低于 500K 时产品档位为 32K，否则为 64K。用户非零值优先，最终输出仍不得超过 `context_window - 32K`；格式损坏或无法容纳固定预留时整组恢复 `0/0`。每次 Agent 模型操作前把生效容量与已经确认可用的思考等级同步到既有 `AgentSession`，请求期不再调整档位。页面从 `context_window - max_output_tokens - 32K` 起预警；设置作用于同一对话的下一次模型操作，不重建或清空模型历史。模型页 generation 和 threshold 输入 / 输出 token 设置只作用于 OneShot。隐藏“继续”消息在操作发起时按当前 `app_language` 解析。
- Agent 模型在 Pi 请求边界固定声明 text / image 输入；消息附件中的批注先进入 text prompt，规范 WebP 则直接交给当前供应商，OneShot 仍只声明 text。产品不探测或配置具体模型的视觉能力，不自动删图、降级或回退 JPEG，供应商拒绝图片时沿用普通模型失败语义。
- 模型可见上下文超过 `context_window - 32K` 时，自然结束由 `AgentSession` 自动压缩，完整工具批次后由 `AgentService` 在包含工具结果的历史上补足检查。历史切点完全交给 SDK，保留侧不拆分 assistant 工具调用与其结果；压缩成功后 token 仪表直接采用 SDK 对新模型历史的估算，失败保留原用量。
- 启动期原子加载必需的 `resource/agent/system_prompt.md` 与 `resource/agent/session_seed.json`；会话种子由零个或多个顺序任意的 user / assistant 消息组成，文本裁剪后允许为空，按资源顺序进入每个新会话的模型历史但不进入公开时间线，任一资源缺失或结构无效都会阻止启动。
- coding-agent 的默认工具与项目资源发现全部关闭，SDK 不发现项目 `AGENTS.md`、`.pi` 或其它运行期资源。产品在初始会话及每次 reset 或工程切换时从用户、内置目录依次加载 skill，以首个有效同名定义获胜，坏 skill 只记录诊断；形成的会话 catalog 同时拥有 System Prompt 能力清单、公开 mention、用户 marker 注入和名称到获胜 skill 包的内部绑定，并在当前对话内冻结。模型能力清单只公开名称与描述，显式注入块只公开名称与正文；`SKILL.md` 描述同时作为模型描述和 `ui.json` 展示描述缺失时的回退。
- `agent-charter` 是隐藏但保留在模型能力清单中的最高层任务宪章；其短正文与 System Prompt 的“任务与准则”有意重复。模型负责确保它在任务前已经加载；后端不注入任务阶段副本，也不跟踪加载状态。
- `ui.json` 的 `visible` 只控制公开列表和用户 marker：隐藏 skill 不进入公开快照，用户输入的同名 marker 不展开，但不影响模型能力清单或文件读取；`disableModelInvocation` 只排除模型能力清单，因此可见且禁用模型调用的 skill 仍能由用户 marker 显式注入。skill 正文可以声明必读或条件组合的其它 skill，组合本身不改变任务对象、范围或工作区权限。未展开或未知的 `@skill(...)` 与裸 `@name` 按普通文本处理，UI 配置不进入模型上下文。
- `read_skill` 只接收 skill `name` 与可选包内相对 `path`，默认读取 `SKILL.md`，不向模型暴露来源或磁盘位置。当前 catalog 已有的名称始终使用会话冻结的获胜 skill 包；未知名称在调用时按同一优先级实时发现，因此会话中新增长出的名称可显式读取但不进入 System Prompt、mention 或 marker，同名新覆盖则到下一会话才生效。正文与包内文件实时读取，同名 skill 不合并目录或向失败者回退；目录穿越、绝对路径、非规范路径和真实目标越出获胜包均拒绝。
- System Prompt 统一拥有最高层任务准则、对外人格、任务阶段、视觉组织和决策交互格式；除有意重复该短准则的 `agent-charter` 外，skill 只补充领域判断、业务信息顺序、证据方法与停止条件。Agent 页面忠实消费模型 Markdown 与 Mermaid，不从标题或 emoji 反向推断领域状态。
- 内置 skill 只补充领域规则；`roleplay` 的 task 资产不属于项目事实，具体参考文件、状态字段与迁移规则归各自 `SKILL.md`。

## 4. 产品工具与宿主能力

- 产品 JSON 工具统一由 `agent-tool` 生成同源的模型正文与 `details`；TypeBox Schema 独占模型参数，并统一使用跨供应商稳定的普通 `object` 根，条件字段组合由工具执行入口收窄。注册边界在模型请求前拒绝非 `object` 根和根级联合，且不按供应商改写 Schema。受控 `AppError` 只投影稳定 `code` 与公开字段，未知执行异常对模型固定为 `{ "code": "tool_failed" }`，原始异常只进入本地诊断。SDK 的 `tool_execution_start/end` 仍是完整持久化调用记录的唯一来源，覆盖参数校验失败、未知工具、成功和执行异常。
- `task_progress` 始终注册，管理当前对话中至多一个内存动态工作队列；`advance` 在完整校验后原子完成既有项并追加派生项，`finish` 拒绝遗留待办，显式 `cancel` 只清理进度而不回滚其它副作用。工具只向模型返回分阶段计数和有限待办，不保存领域事实、工程证据、百分比或完成判据；公开 Agent snapshot 与 SSE 另以 `taskProgress` 投影全部待办标签，空数组表示不展示，不公开标题、键、阶段或完成统计。
- 工程数据工具只保留 `workspace_load`、`workspace_script`、`workspace_apply`，并且只在 GUI Electron 沙箱端口存在时成组注册；端口缺失时不注册工程数据假实现。`AgentService` 只负责会话与工具注册，不持有 item、quality 或 proofreading 领域依赖。
- `workspace_load` 无参数生成完整只读快照和空 change 文件、挂载当前对话 task，只在工具结果返回语言与数量摘要；完整 project_meta 和 contract 保留在磁盘，脚本运行时把 contract 投影为 `workspace.contract`。`items/entries.jsonl` 额外携带只读 `text_type`，用于按文本格式解释规则命中分布；project_meta 保存解释快照所需的语言、数量、文件顺序及可用的 source 文本路径或容器文本根，质量规则功能开关和文本处理设置不进入工作区。contract 是 datasets、显式 change 操作、字段、身份、稳定写入副作用、领域提交软建议、模型结果与查询上限的唯一代码权威，不承载固定脚本 SDK 或运行时生命周期。`workspace_script` 的 TypeBox 工具 Schema 是固定 SDK、具名工作区方法和完整入口语法的唯一模型可见权威，Electron runner 注入相同成员。System Prompt 规定 items 优先、sources 仅补足缺失片段或结构证据，并提供无 skill 时读取工作区事实、准备并提交 contract 声明变更的完整默认流程；skill 只补充领域判断与处理方法。
- 工作区按业务领域相邻组织只读数据；analysis 状态、候选、预计算质量分析和质量规则关系组不进入只读数据集。warnings 是 load 时证据且不随程序化处理重新计算；模型在 `task/**` 与 `scratch/**` 中维护的领域任务资产不属于 contract 或项目事实。固定 change 文件按 items / prompts 更新和每个 quality kind 的创建、更新、删除、移动分开；具体路径与字段留在 contract，固定查询方法的参数与返回形状留在脚本 SDK，实现随 Electron bundle 发布并由相邻行为测试验证。
- JavaScript 是唯一处理编排面。筛选、邻近上下文、质量规则分组、公共词根与正式字面匹配都作为具名 `workspace.*` 方法进入同一脚本 SDK；发布源码方法在一次性 renderer 内运行，只获得 contract、读取与列表 API，不能写 change、task 或 scratch，正式字面匹配则由 Electron main 的私有 protocol 执行。质量规则结构组仍只安排共同审查，不推断语义或合并结论；公共词根方法仍只为调用方已确认语义相关的词形枚举候选。质量规则 probes 与 facts 仍是 scratch 内的领域任务资产，不由查询方法建立第二套语义协议。
- `workspace.matchLiterals` 是 `src` 与 `name_src` 的正式完整字面匹配入口；私有 protocol 同时匹配全部具名 pattern，并按自然顺序扫描完整 items JSONL 一次，返回实际扫描数、item 去重计数、字段计数与有限原文范围证据。`workspace.queryItems` 的 NFKC 小写 includes 只用于确定性筛选。
- 每次 `workspace_script` 只接收完整的 `async function main(workspace) { ... }` 入口函数，并在无 Node、无 preload、无 Shell、无网络、无权限与下载的一次性 Chromium renderer 中由宿主注入 `workspace` 后调用；缺少具名入口或未显式返回 JSON 值都失败并回滚。每次调用拥有唯一磁盘事务，脚本只把 contract `changes` 区块声明的固定文件及 `task/**`、`scratch/**` 写入 overlay；最终脚本结果通过 JSON 与 `contract.limits.result_bytes` 字节硬门后才提交，未捕获失败、停止或超限只回滚本次 overlay。提交失败先恢复被替换基线，补偿或清理失败才把当前快照标为失效。私有 protocol 提供活动快照、同级可写 task 与同级只读 sources 的合并视图、流式文件访问和正式字面匹配；datasets、project_meta、contract 与 sources 永远只读，固定 change 文件不能删除。路径穿越、绝对路径、反斜线、符号链接和事务实现目录均拒绝。
- `workspace_apply` 无参数，只读取非空显式 change 文件；items 按 ID 定点读取，prompts 只读取目标 kind，quality 只为受影响 kind 构造 prospective 最终集合，不扫描或比较完整 datasets。change 校验错误与数据库事务回滚保留当前快照，stale 或 revision 冲突只清理当前快照并要求重新 load；无变化不进入项目写口、不推进 revision、不发布事件。成功只返回紧凑真实计数与提交后 revision，并以 [`BACKEND.md`](BACKEND.md) 的单事务入口修改 `.lg`；apply 成功或无变化后销毁当前快照但保留 task。数据库已提交但缓存或公开事件同步失败使用带 `committed: true` 的稳定错误，销毁当前快照且禁止重试。
- Agent 先对完整范围执行确定性程序化处理，只把剩余开放式语义目标按模型上下文软上限组成审查组；审查组不等于提交单元。技术提交只遵循 contract 的领域软建议，后端不以审查组或建议值建立硬上限；写入授权分具体差异、确定规则与已确认判断标准三种形态，一经取得持续覆盖范围内全部技术提交，连续 apply 之间重新 load。
- GUI Agent 的 Web 能力以 `web_search` 与 `web_fetch` 成组注册，宿主抓取端口缺失时不注册假实现。`web_search` 通过固定的 Exa、Tavily、Firecrawl、AnySearch 与 Keenable 无凭据 MCP 工具实现统一查询 Schema 和错误契约，不动态投影远端工具；模型只提交自然语言查询，供应商协议或业务失败均进入同一回退链。应用级搜索服务从 Exa 开始，当前来源失败时环形尝试其余来源并将成功来源晋升为首选，该内存状态跨工程切换复用、应用重启后重置。五家会话均按需建立并复用，组合根在 Agent 之后统一释放；`web_fetch` 仍独立使用本地安全下载链路，不委托搜索供应商抓取正文。
- `web_fetch` 与普通模型网络共用 Electron session 提供的当前系统代理解析，但保留独立的安全下载边界：Backend 使用 Undici 逐跳抓取 HTTP(S)，每一跳重新解析代理；直连请求在实际 socket lookup 中只交付公网地址，代理请求把用户配置的代理视为目标解析与可达范围的信任边界。每次调用限制总时长、重定向和响应字节，HTTP 失败向模型返回状态码与最终 URL，受支持文本统一归一为 Markdown。System Prompt 是搜索摘要和网页正文不可信规则的唯一归宿，工具描述和结果不重复注入同一规则。

## 5. 前端消费

- 后端按 `ui.json` 过滤、排序并补全 Agent skill snapshot；页面保持该顺序并按当前 locale 选择描述，不另建排序或翻译表。
- `AgentSessionProvider` 跨路由持有 snapshot / SSE 镜像、独立 transport、当前 command、`inputQueue`、模型可见历史 token、`taskProgress` 待办标签、普通 Composer 草稿与 renderer 全局纯文本输入历史；这些会话事实不进入 `DesktopStateProvider` 或项目 session UI 缓存。历史消息与队列项的修订草稿由页面原位编辑器短暂拥有，不覆盖普通 Composer 草稿。草稿与队列附件不写入 localStorage、项目资源、`.lg` 或 Agent 磁盘工作区；公开时间线、输入队列与模型历史中的附件随内存会话在 reset、工程切换或 dispose 时清理。
- `AgentCompletionAttention` 在跨路由会话镜像中观察一次运行从 `running` 收束到最终 round `success | error` 的转换，并忽略 `stopped`、reset 与自动队列中间轮次；确认后只请求宿主注意力，不新增 Agent SSE 事件或通知正文。
- 图片文件入口和协议归一由 renderer 拥有；文件选择、拖入与粘贴在发送前统一转换为公开协议要求的 WebP，后端不承担文件解码、格式探测或回退。
- 恢复失败与已恢复会话断线由 transport 提供持续恢复路径；所有队列命令复用既有 HTTP ack 与命令期 SSE 重放，删除、重排和立即发送的受理失败由页面解析为安全 Toast，队列原位编辑失败保留在编辑器旁，不写入共享会话状态。合法 message ack 与携带消息的 continue ack 都把非空文本更新到输入历史并原子清空普通 Composer 草稿，空 continue 不改写草稿或历史；队列项与时间线条目各自在目标位置展开独立编辑器，成功后由页面显式替换 user 输入历史，assistant 修改不改写输入历史。
- 页面持有滚动、活动原生选区、当前原位编辑目标，以及从既有质量规则 query 与共享统计缓存读取的 glossary 和命中数；这些页面局部事实不进入 Agent snapshot、历史或发送协议。每轮最后一个成功 assistant 正文允许把单一原生选区和可选评论确认到当前消息草稿，不建立来源定位或第二套批注状态。`task_progress` 工具调用不渲染为时间线条目，页面在 Composer 上方固定展示 `taskProgress` 队首标签，完整队列由提示承载，空数组不占位。消息级“复制”与“编辑”共用当前可修订消息的操作区；复制仅对其中有正文的 user / assistant 开放且不改变会话状态，输入消息的保存并重试会重新运行最新 round。历史 user、assistant 与队列项各自在目标位置展开独立编辑器，失败时保留编辑内容。assistant 编辑隐藏附件与 marker 能力。输入框、引导卡片与时间线只把当前已知 marker 投影为整块视觉，不改变底层字符串或建立身份旁路。
- Agent round 运行态与 stop 命令不锁定普通草稿编辑；send、continue、revise、queue update 与 reset 受理期间相关编辑器只读。运行中有效普通草稿通过 message 入队，空草稿执行 stop；空闲且队列暂停时 Composer 统一执行 continue，可选草稿随请求追加队尾。压缩和 `workspace_apply` 期间仍允许有效普通草稿排队，但不可 stop。队列组件只消费后端顺序与能力快照，修改、删除、重排和立即发送均经页面调用 `AgentSessionProvider` 命令入口；steer user 不开放 round 的修改或重试操作。失败恢复仍由后端拥有，renderer 不监听终态补发命令。
