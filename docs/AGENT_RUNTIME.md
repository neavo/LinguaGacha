# LinguaGacha 产品 Agent 工程边界

本文统一承载产品 Agent 的公开会话协议、运行态所有权、模型会话、启动资源、skill 与工具、宿主能力和前端消费。共享 Gateway、项目事务、模型请求与前端运行态分别归 [`BACKEND.md`](BACKEND.md) 和 [`FRONTEND.md`](FRONTEND.md)，进程拓扑归 [`ARCHITECTURE.md`](ARCHITECTURE.md)；字段级 schema、局部算法和产品语义留在代码、测试与当前产品设计中。

## 1. 公开会话协议

- Agent 公开入口提供 snapshot、message、最新轮次重试、最新轮次输入或最终输出修改、stop、压缩重试与 reset；message 请求和公开 user 条目携带规范化后的 `text` 与 WebP base64 图片数组，允许纯图片与多图片消息但不允许二者同时为空。主动重试回到最新 user 之前并以原文本和图片重新调用模型；修改该 user 同样删除整轮旧尝试、替换输入后重新调用模型，修改该轮最终可见 assistant 则保留此前 user 与工具历史、写入零 usage 的纯文本 assistant 而不调用模型。三种操作都要求会话空闲并分别校验最新轮次输入或最终输出身份，直接替换活动历史，不保留分支或修改标记；更早轮次和同轮中间 assistant 不可修改。会话状态只区分 `idle | running`；user / assistant / tool 条目各自携带 `running | success | error | stopped` 状态，上下文压缩条目只使用 `running | success | error`，不承载可停止语义。
- 时间线由 snapshot 与 `agent.session_event` 通过同 id 完整条目覆盖和 `snapshot_seed` 共同恢复本次 reset 以来的内存历史；同一未解决上下文压缩的自动再试与手动重试复用唯一 entry，直到成功后下一次压缩才建立新身份。公开快照只携带模型可见历史的估算 token；模型失败只写入对应条目和轮次，不发布第二套失败事件。公开工具条目冻结规范化后的完整输入，并只在 SDK 工具终帧后携带模型实际收到的文本输出；公开协议不承载 SDK 原始参数引用、结构化 details、压缩诊断、供应商连续性元数据或脱敏思考。
- 工具 `running` 条目在执行体开始前发布；所有产品工具在统一注册边界先让出一次事件循环，为本地 SSE 首帧提供独立发送轮次。

## 2. 状态与生命周期

| 状态                                               | 拥有者                  | 唯一入口                                                |
| -------------------------------------------------- | ----------------------- | ------------------------------------------------------- |
| 公开状态、完整 UI 时间线、会话生命周期与启动期资源 | `AgentService`          | Agent API、`agent.session_event`                        |
| 模型可见历史、工具循环、上下文压缩、中断与 settle  | 内存 `AgentSession`     | `AgentService` 调用 SDK 的 prompt、模型切换与关闭 API   |
| 当前对话 task、数据快照与显式 change 准备          | `AgentWorkspaceService` | `workspace_load`、`workspace_script`、`workspace_apply` |

- Agent 运行时完全内存化。消息受理到整个用户任务最终 settle 期间持续持有 [`RuntimeOperationGate`](BACKEND.md) 的运行 lease；一个任务可以跨越多个 SDK run，但只在 SDK settle 的安全边界压缩，并以隐藏的“继续”消息保持同一公开轮次执行。中途压缩失败会结束本轮，并阻断新消息直至压缩恢复。主动重试、输入修改与最终输出修改分别使用最新 user 或最终 assistant 写入模型历史前记录的 SDK leaf 裁剪活动路径，保留切点之前的完整工具配对、压缩摘要与供应商连续性数据；裁剪只改写对话和模型历史，不回滚已发生的工程、文件或网络副作用。
- 手动压缩重试同样持有运行 lease；失败轮次恢复成功后追加“继续”user 轮次，已完成轮次只恢复模型历史。普通模型回合的 stop 同步封口仍运行的子条目和 user 条目、将公开会话切回 `idle`，再异步取消 SDK，lease 仍到最终 settle 才释放。压缩和 `workspace_apply` 都是不可 stop 的原子阶段，前后端在对应 running 条目结束前拒绝 stop；reset、工程切换和 dispose 仍通过运行时关闭屏障隔离旧会话。
- 显式 reset 与 `ProjectSessionState.mark_loaded` / `clear` 会立即隔离公开会话并等待旧运行时清理；同一工程内的项目事实变化不重置公开时间线或模型历史，已失效运行时的迟到阶段不得改写条目、发布终态或启动模型请求。
- GUI Agent 在应用 userdata 中持有活动 UUID 数据快照及其同级 `task`、`sources`。task 在当前 Agent 对话、工程 epoch 与权威语言内跨 load、普通 section revision、apply、stale 和 revision 冲突保留；内容结构及使用方式完全由模型决定，不自动进入模型上下文或项目事实。
- 工程加载时从 `.lg` 原始资产生成 sources，同一工程 epoch 与 files revision 内复用，files revision 变化后由下一次 load 替换；普通文本保留为单文件，EPUB / XLSX 保留容器内部路径并只展开文本成员。新 load 全部成功后才替换旧快照；成功 `workspace_script` 将 change、task 和 scratch 作为同一文件事务提交，脚本失败、取消或结果无效只回滚本次运行。普通 revision、apply 和 stale 只清理快照；reset、工程身份、epoch 或语言变化、无法补偿的文件事务、未知宿主失败、dispose 和下次启动同时清理 task。change 校验与数据库回滚保留快照，sources 生成失败不回滚工程加载。目录清理失败只留诊断，不改变项目提交事实；task、快照与 sources 都不进入 Agent snapshot、模型历史或项目事实。

## 3. 模型、资源与 skill

- Agent 与 OneShot 共用 [`BACKEND.md`](BACKEND.md) 定义的模型请求边界。模型配置中的 `agent.context_window` 与 `agent.max_output_tokens` 各自以 `0` 表示自动；每条 Agent 消息、主动重试、消息修改及手动压缩重试受理后、模型调用前按 `model_id` 解析领域规则或稳定兜底，并把生效容量与思考等级同步到既有 `AgentSession`。Agent 固定保留 32K 上下文用于自动压缩；最大输出超过 `context_window - 32K` 时由统一模型边界自动调小，格式损坏或无法容纳固定预留时整组恢复为 `0/0` 自动配置，模型页同步回写规范值并显示同一条调整警告。页面从 `context_window - max_output_tokens - 32K` 起预警；设置作用于同一对话的下一次模型操作，不重建或清空模型历史。模型页 generation 和 threshold 输入 / 输出 token 设置只作用于 OneShot。后端生成的隐藏“继续”消息在操作发起时通过共享 i18n 按当前 `app_language` 解析。
- Agent 模型在 Pi 请求边界固定声明 text / image 输入并把规范 WebP 直接交给当前供应商；OneShot 仍只声明 text。产品不探测或配置具体模型的视觉能力，不自动删图、降级或回退 JPEG，供应商拒绝图片时沿用普通模型失败与重试语义。
- 模型可见上下文超过 `context_window - 32K` 时，自然结束由 `AgentSession` 自动压缩，完整工具批次后由 `AgentService` 在包含工具结果的历史上补足检查。历史切点完全交给 SDK，保留侧不拆分 assistant 工具调用与其结果；压缩成功后 token 仪表直接采用 SDK 对新模型历史的估算，失败保留原用量。
- 启动期原子加载必需的 `resource/agent/system_prompt.md` 与 `resource/agent/session_seed.json`；会话种子由零个或多个顺序任意的 user / assistant 消息组成，文本裁剪后允许为空，按资源顺序进入每个新会话的模型历史但不进入公开时间线，任一资源缺失或结构无效都会阻止启动。
- coding-agent 的默认工具与项目资源发现全部关闭；产品 skill 只在启动期从内置与用户目录加载，坏 skill 只记录诊断，SDK 不发现项目 `AGENTS.md`、`.pi` 或其它运行期资源。模型能力清单与显式 skill 注入块由产品格式化，不携带 SDK 的第二套路由文案；`SKILL.md` 描述同时作为模型描述和 `ui.json` 展示描述缺失时的回退。`ui.json` 的 `visible` 控制公开列表和用户 marker：隐藏 skill 不进入公开快照，用户输入的同名 marker 不展开，但不影响模型能力清单、`read_skill`、工具注册或启动期白名单；`disableModelInvocation` 只排除模型能力清单，因此可见且禁用模型调用的 skill 仍能由用户 marker 显式注入。已注入 skill 只禁止重复读取自身，正文声明的必读知识 skill 仍从能力清单定位当前有效定义并读取一次；知识依赖不构成第二套工作流、任务对象或范围。模型能力按加载时首次出现顺序确定性注入，重复项去重，未展开或未知的 `@skill(...)` 与裸 `@name` 按普通文本处理。`read_skill` 只按规范化绝对路径读取启动期形成的 `SKILL.md` 与 references 白名单，不扫描会话历史建立第二套授权，UI 配置不进入模型上下文。
- System Prompt 统一拥有对外人格、任务阶段、视觉组织和决策交互格式；skill 只补充领域判断、业务信息顺序、证据方法与停止条件。Agent 页面忠实消费模型 Markdown 与 Mermaid，不从标题或 emoji 反向推断领域状态。

## 4. 产品工具与宿主能力

- 产品 JSON 工具统一由 `agent-tool` 生成同源的模型正文与 `details`；TypeBox Schema 独占工具参数。受控 `AppError` 只投影稳定 `code` 与公开字段，未知执行异常对模型固定为 `{ "code": "tool_failed" }`，原始异常只进入本地诊断。SDK 的 `tool_execution_start/end` 仍是完整持久化调用记录的唯一来源，覆盖参数校验失败、未知工具、成功和执行异常。
- 工程数据工具只保留 `workspace_load`、`workspace_script`、`workspace_apply`，并且只在 GUI Electron 沙箱端口存在时成组注册；端口缺失时不注册工程数据假实现。`AgentService` 只负责会话与工具注册，不持有 item、quality 或 proofreading 领域依赖；`read_skill` 与可选 `web_fetch` 保持独立。
- `workspace_load` 无参数生成完整只读快照和空 change 文件、挂载当前对话 task，只在工具结果返回语言与数量摘要；完整 project_meta 和 contract 保留在磁盘，脚本运行时把 contract 投影为 `workspace.contract`。project_meta 保存解释快照所需的语言、数量、文件顺序及可用的 source 文本路径或容器文本根；contract 是 datasets、显式 change 操作、字段、身份、稳定写入副作用、领域提交软建议、模型结果与查询上限、脚本 API、recipe 参数及具名返回形状的唯一代码权威，不承载运行时生命周期。System Prompt 规定 items 优先、sources 仅补足缺失片段或结构证据，并提供无 skill 时读取工作区事实、准备并提交 contract 声明变更的完整默认流程；skill 只补充领域判断与处理方法。
- 工作区按业务领域相邻组织只读数据和 load 时证据；analysis 状态与候选不作为快照数据集进入工作区，warnings 与 evidence 不随程序化处理重新计算。固定 change 文件按 items / prompts 更新和每个 quality kind 的创建、更新、删除、移动分开；`scratch/**` 只属于当前快照，`task/**` 是不带内容 schema 的跨快照自由目录。具体路径、字段与 recipe 查询算法留在 contract、发布源码和行为测试。
- JavaScript 是唯一处理编排面。`workspace.runRecipe(name, args)` 在脚本内调用 contract 声明的发布 recipe；recipe 只获得 contract、读取与列表 API，不能写 change、task、scratch 或递归调用 recipe。三个 recipe 都返回具名对象，参数、分页与输出限制以 contract 为准。
- `workspace.matchLiterals` 是 `src` 与 `name_src` 的正式字面匹配入口。私有 protocol 同时匹配全部具名 pattern，并按数据集自然顺序扫描完整 items JSONL 一次；结果返回实际扫描 item 数、全部 pattern 命中的 item 并集数、各 pattern 的 item 去重计数、字段计数与有限原文范围证据。同一 pattern 在同一 item 的多个命中只计一个 item，字段仍分别计数。通用 query recipe 的 NFKC 小写 includes 搜索只用于发现和筛选，不代表该正式语义。
- 每次 `workspace_script` 都在无 Node、无 preload、无 Shell、无网络、无权限与下载的一次性 Chromium renderer 中执行，并拥有唯一磁盘事务。脚本只把 contract `changes` 区块声明的固定文件及 `task/**`、`scratch/**` 写入 overlay；最终脚本结果通过 JSON 与 `contract.limits.result_bytes` 字节硬门后才提交，未捕获失败、停止或超限只回滚本次 overlay。提交失败先恢复被替换基线，补偿或清理失败才把当前快照标为失效。私有 protocol 提供活动快照、同级可写 task 与同级只读 sources 的合并视图、流式文件访问和只读 matcher；datasets、project_meta、contract、warnings、evidence、recipes 与 sources 永远只读，固定 change 文件不能删除。路径穿越、绝对路径、反斜线、符号链接和事务实现目录均拒绝。
- `workspace_apply` 无参数，只读取非空显式 change 文件；items 按 ID 定点读取，prompts 只读取目标 kind，quality 只为受影响 kind 构造 prospective 最终集合，不扫描或比较完整 datasets。change 校验错误与数据库事务回滚保留当前快照，stale 或 revision 冲突只清理当前快照并要求重新 load；无变化不进入项目写口、不推进 revision、不发布事件。成功只返回紧凑真实计数与提交后 revision，并以 [`BACKEND.md`](BACKEND.md) 的单事务入口修改 `.lg`；apply 成功或无变化后销毁当前快照但保留 task。数据库已提交但缓存或公开事件同步失败使用带 `committed: true` 的稳定错误，销毁当前快照且禁止重试。
- Agent 先对完整范围执行确定性程序化处理，只把剩余开放式语义目标按模型上下文软上限组成审查组；审查组不等于提交单元。技术提交只遵循 contract 的领域软建议，后端不以审查组或建议值建立硬上限；同一规则授权可以覆盖多个技术提交，连续 apply 之间重新 load。
- `web_fetch({ url })` 仅由 GUI Backend Runtime 创建并注册，CLI 不提供假实现。Backend 使用 Undici 逐跳抓取 HTTP(S)：直连请求在实际 socket lookup 中只交付公网地址，系统代理请求把用户配置的代理视为目标解析与可达范围的信任边界；每次调用限制总时长、重定向和响应字节，HTTP 失败向模型返回状态码与最终 URL，受支持文本统一归一为 Markdown。系统提示是网页正文不可信规则的唯一归宿，工具描述和结果不重复注入同一规则。

## 5. 前端消费

- 后端按 `ui.json` 过滤、排序并补全 Agent skill snapshot；页面保持该顺序并按当前 locale 选择描述，不另建排序或翻译表。
- `AgentSessionProvider` 跨路由持有 snapshot / SSE 镜像、独立 transport、当前 command、模型可见历史 token、完整消息草稿与 renderer 全局纯文本输入历史；时间线不进入 `DesktopStateProvider` 或项目 session UI 缓存。草稿图片不写入 localStorage、项目资源、`.lg` 或 Agent 磁盘工作区；公开时间线与模型历史中的图片随内存会话在 reset、工程切换或 dispose 时清理。
- 图片文件入口和协议归一由 renderer 拥有；文件选择、拖入与粘贴在发送前统一转换为公开协议要求的 WebP，后端不承担文件解码、格式探测或回退。
- 恢复失败与已恢复会话断线由 transport 提供持续恢复路径；send / 主动重试 / 消息修改 / stop / reset 与压缩重试的受理失败拒绝原命令并由页面解析为安全 Toast，不写入共享会话状态。合法 message ack 把非空文本更新到输入历史并原子清空完整草稿；主动重试不改写输入历史或草稿，user 修改成功后替换旧历史文本，assistant 修改不改写输入历史。
- 页面持有滚动、弹窗，以及从既有质量规则 query 与共享统计缓存读取的 glossary 和命中数；这些页面局部事实不进入 Agent snapshot、历史或发送协议。最新一轮输入及其最终可见输出可修改，并共享一次最新轮次重试；模型失败复用错误恢复入口，压缩失败只允许压缩恢复，成功压缩不阻断普通修改或重试。修改态复用唯一 Composer，暂存普通草稿，取消或成功后恢复，失败时保留编辑内容；assistant 修改隐藏图片与 marker 能力。最新轮次已成功执行 `workspace_apply` 时，重试或提交输入修改必须确认既有工程副作用不会回滚，输出修改不确认。输入框、引导卡片与时间线只把当前已知 marker 投影为整块视觉，不改变底层字符串或建立身份旁路。
- Agent 回合运行态与 stop 命令不锁定草稿编辑，send / edit / reset 命令跨路由保持编辑器只读；共享 runtime 锁禁用发送、reset、消息改写与模型选择 / 思考档位控制。压缩和 `workspace_apply` 期间保留草稿编辑但禁用 stop；压缩还禁用发送、reset 与模型控制，失败后允许更换模型或开始新任务。压缩重试成功后的条件续跑由后端拥有，renderer 不监听终态补发命令。
