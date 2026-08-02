# LinguaGacha 后端权威边界

本文统一承载后端公开协议、状态拥有者、项目写入、任务运行态、数据库与 `.lg` 物理存储规则。字段级细节、完整 schema 和局部算法留在代码与测试中。

## 1. 公开协议

- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一装配点；`register_api_routes` 在单一注册表中把公开路径绑定到 `BackendServices`，路由不自行组装业务依赖。
- 普通 loaded-project query / write 从 `ProjectSessionState` 取得目标工程；create、open、preview 和打开前 settings alignment 是可以接收显式路径的生命周期例外。
- Gateway 只监听本机地址，CORS 只允许 `Content-Type`，renderer 不依赖额外私有请求头。
- 成功响应为 `{ ok: true, data }`，失败响应为 `{ ok: false, error }`；公开错误不包含 diagnostic context、cause、stack 或供应商原始异常。
- 公开 SSE topic 固定为 `project.data_changed`、`task.snapshot_changed`、`runtime.snapshot_changed`、`agent.session_event`、`settings.changed`、`log.appended`，data 使用严格 JSON 序列化；`POST /api/runtime/snapshot` 返回带单调 `revision` 的当前运行所有者 `task | agent | null`。
- Agent 公开入口固定为 `GET /api/agent/snapshot` 与 `POST /api/agent/message|stop|reset`；消息保留有序 text / skill parts，会话状态只区分 `idle | running`，user / assistant / tool 条目各自携带 `running | success | error | stopped` 状态。
- Agent 时间线由 snapshot 与 `agent.session_event` 通过同 id 完整条目覆盖和 `snapshot_seed` 共同恢复本次 reset 以来的内存历史，并公开模型可见历史的估算用量与当前会话容量；模型失败只写入对应条目和轮次，不发布第二套失败事件。公开条目不包含工具参数、供应商连续性元数据或脱敏思考。
- 工具 `running` 条目在执行体开始前发布；所有产品工具在统一注册边界先让出一次事件循环，为本地 SSE 首帧提供独立发送轮次。
- 通用质量规则切片通过 `POST /api/quality/rules/query` 读取、`POST /api/quality/rules/update` 写入，分析术语导入等复合 workflow 保留独立命令；`POST /api/proofreading/query` 统一分发校对查询，`POST /api/proofreading/items/update` 只批量更新 `dst` / `name_dst`，清空、状态与替换使用各自命令。
- 模型管理 API 只负责配置 CRUD；任务入口通过 `GET /api/models/selection` 读取窄选项，通过 `POST /api/models/select` 按 `translation`、`analysis` 或 `agent` 用途更新单项选择。选项只携带显示身份与非敏感的 Agent 容量，不公开密钥、请求覆盖或生成参数。
- `LogManager` 以 `LogContent` 判别联合保存单一正文事实：文件和控制台从它生成纯文本投影，`log.appended` 只携带轻量预览，`/api/logs/detail` 只查询当前进程结构化详情池且不回扫历史文件。
- `/api/diagnostics/renderer-error` 只接收实际 renderer 异常摘要与白名单上下文并写入 `LogManager`，不改变项目、任务或设置事实。

## 2. 状态拥有者

| 状态 / 边界 | 拥有者 | 唯一写入口 / 读出口 |
| --- | --- | --- |
| 应用设置、最近工程、语言 | `AppSettingService` | 设置 API、CLI transient overrides、`settings.changed` |
| 模型集合与按用途选择 | `ModelService` | 模型 API；经 `AppSettingService` 持久化到应用设置 |
| 普通任务 / Agent 活动所有者与项目写互斥 | `RuntimeOperationGate` | 运行 lease、`POST /api/runtime/snapshot`、`runtime.snapshot_changed` |
| loaded 工程身份 | `ProjectSessionState` | `ProjectLifecycleService` |
| loaded 工程热读数据 | `CacheManager` | 工程热机、committed event、功能 query |
| 项目事实提交 | `ProjectWriteStore` | 单 `.lg` 事务、唯一 `ProjectEventHandler`、`adapt_project_change` |
| 活动任务类型、translation scope、status、busy、`run_revision`、请求压力 | `TaskRuntime` | 任务命令、Engine 生命周期、项目会话切换 |
| 任务 progress / analysis candidate count | `.lg` meta | `TaskProjectStore` 经 `ProjectWriteStore` 写入 |
| 任务公开快照 | `TaskRuntime.build_snapshot` | 组合内存运行态与 `.lg` meta |
| Agent 公开状态、完整 UI 时间线、Agent 会话生命周期与启动期资源 | `AgentService` | Agent API、`agent.session_event`；规则与译文写工具委托对应服务的 Agent 专用写入口 |
| Agent 模型可见历史、工具循环、上下文压缩、中断与 settle | 内存 `AgentSession` | `AgentService` 只通过 SDK 的 prompt、模型切换与关闭 API 驱动 |
| `.lg` 物理 workflow | `ProjectDatabase` | 类型化读写方法、`transaction(projectPath, callback)` |
| 平台 IO 与路径身份 | `NativeFs` / `NativePathPolicy` | `src/native` |
| 后端日志 | `LogManager` | 文件日志、轻量 SSE、当前进程详情池 |

`RuntimeOperationGate` 是普通任务、Agent 与项目结构性写入的唯一互斥边界。task / Agent 的运行 lease 从受理持有到最终 settle，二者完全互斥；普通项目写入的准备与提交持有同一项目写 lease，设置和模型配置写入也必须先确认运行时空闲。Agent 只能在自己的运行 lease 内通过专用服务入口串行写项目；冲突统一返回 `runtime.busy`。

## 3. 项目读取与写入

项目数据 section 固定为：

```text
project, files, items, quality, prompts, analysis, proofreading
```

- `/api/session/project/manifest` 只返回项目身份、revision 索引和 counts，不预热大 section。
- 功能 query 返回其结果依赖的 `sectionRevisions`，用户写入和任务命令以这些 revision 做乐观锁；`projectRevision` 只是所有 section revision 的最大值，不是独立全序或可写锁。
- `CacheManager` 是当前 session 的热读缓存根；query 只组合 cache、按需数据库读取和 shared 纯规则，不建立第二套项目事实。
- 校对 reader 同时维护原始自然顺序和单个列表视图：`view_id` 表示稳定结果快照，条目字段增量只刷新旧视图中的行内容，删除 tombstone 从旧视图移除成员，成员与排序只由新的 list query 重算；上下文读取不创建或替换当前列表视图。
- `QualityStatisticsCache` 的身份由规则和实际文本依赖决定；`items` 变化只在能证明文本源范围时局部失效，否则全量失效。
- 客户端只提交用户意图、设置镜像和 revision 依赖；canonical items、task extras、prefilter 结果和 analysis 结果由后端计算。
- 需要乐观锁的用户写入在最终提交点完成 revision guard 与单 `.lg` 事务；任务 artifact 等内部写入可以不带预期 revision，但仍通过 `ProjectWriteStore` 更新事实和 section revision。
- settings-only alignment 只发布内部 committed event，不发布公开 project change；仅持久化任务 progress 的写入走 task snapshot 通道，不制造项目变更事件。
- 项目事实事务提交后才把类型化 committed event 交给唯一缓存 handler，缓存完成后再发布公开 change。未捕获的 handler 失败不会回滚已提交事务，但会令请求失败并阻止公开 change；常规增量维护失败由 `CacheManager` 标记为可恢复，并在后续 query 前从数据库重建。
- HTTP `changes` 与 SSE 使用同一 canonical `ProjectChangeEvent`，消费者不得依赖两条通道的网络到达顺序。
- 公开事件绑定后端确认的 `projectPath`、`projectRevision`、`sectionRevisions` 与 `updatedSections`；payload mode 只允许 `canonical-delta`、`field-patch`、`section-invalidated`。
- 全量替换、排序或无法精确表达受影响行的写入使用 `section-invalidated`；只有能完整表达受影响行和删除 tombstone 的小范围变化才发布行级增量。
- create / load / migration / 默认预设初始化与 CLI bootstrap 资源属于生命周期或初始化写入；若它们改变 query 可见事实，必须在同一事务更新对应 revision meta。

## 4. 任务、worker 与 LLM

- `TaskService` 负责命令 JSON 收窄、task / mode / scope 归一、section revision 校验和 Engine 命令转交；`TaskRuntime.begin` 原子取得共享运行 lease。`TaskEngine` 在每轮 run 开始时按 translation / analysis 用途解析模型，并与限流、提示词配置一起冻结到运行上下文。行级重翻和 CLI 复用同一任务入口，不另建模型选择旁路。
- 启动任务必须携带 `TaskService` 按 task type 与 scope 固定要求的 `expected_section_revisions`；取得运行 lease 后立即进入 task busy，Engine 启动失败时恢复前置状态并释放 lease。
- 所有任务命令 ack 都通过 `TaskRuntime.build_snapshot` 重新读取当前事实，避免旧命令意图覆盖更晚的终态。
- `TaskRuntime.build_snapshot` 组合内存中的 status、busy、`run_revision`、请求压力与 translation scope，以及 `.lg` 中的 progress / analysis candidate count；`run_revision` 是前端丢弃旧 snapshot 的排序依据。
- 每次成功 load / unload 都推进 `ProjectSessionState` 的内部会话世代；生命周期返回前，`TaskRuntime` 重置为新会话的 idle、推进 `run_revision` 并发布快照，因此旧工程迟到帧严格早于新工程事实。
- 生命周期和进度提交立即发布完整 `task.snapshot_changed`；只有请求压力允许合并，终态前必须冲刷。请求压力只表示已租约发出的 LLM 请求，不表示队列或 worker 数量。
- `TaskRuntime` 拥有任务取消、终态和 Engine completion，并以当前 active run 派生 task snapshot 的 `busy`。`TaskEngine` 只负责编排，任务结果统一经 `TaskProjectStore` 进入项目写入边界。全量翻译与分析经过 Planner，行级重翻直接从目标 items 构造 context。
- work-unit worker 负责提示词构建、runner、pipeline 和响应处理；planning worker 只承担规划期计算。线程数不等于 LLM 并发，实际并发由模型 key lease 与 limiter 决定。
- 非 engine 的重型计算通过 `ComputeWorkerClient` 提交无状态 compute task；worker 不读数据库、不写 `.lg`、不发布事件、不持有项目 cache。
- 模型请求快照、`api_format` 协议策略、最终请求覆盖、结果归一和模型列表探测归 `src/backend/llm`；OneShot 与 Agent 共用同一请求事实和 `pi-ai` 原生 adapter，模型列表探测直接调用供应商 REST API。`LLMClient` 独立拥有 OneShot 的总时限、取消、退化和结果语义，任务层不解析供应商异常文本。
- OpenAI Chat Completions 与 Responses 是显式独立的 `api_format`，不按 URL 或模型名自动探测，也不互相重试或降级；模型族思考字段由项目共享策略生成，未收录模型不猜测，`extra_body` 最后覆盖。Responses 的原生载荷与连续性由 `pi-ai` 生成；除通用思考与 `extra_body` 策略外，项目只把其中的系统指令规范为 `developer`，指令角色不随思考档位变化。
- Agent 运行时完全内存化，coding-agent 的默认工具与项目资源发现全部关闭。消息受理到 SDK 最终 settle 期间持续持有共享运行 lease；stop 同步把当前轮次内仍运行的子条目和 user 条目封口为 `stopped`、将公开会话切回 `idle`，再异步取消 SDK，运行 lease 仍到最终 settle 才释放；显式 reset 与 `ProjectSessionState.mark_loaded` / `clear` 会立即隔离公开会话并等待旧运行时清理，同一工程内的项目事实变化不重置公开时间线或模型历史；已失效运行时的迟到阶段不得改写条目、发布终态或启动模型请求。
- 模型级 `agent.context_window` 与 `agent.max_output_tokens` 在新会话创建时冻结；每个后续回合重新解析 agent 用途选择并刷新请求快照与思考等级，但不改变当前会话容量。模型页 generation 和 threshold 输入 / 输出 token 设置只作用于 OneShot。
- Agent 基础 system prompt 的唯一资源为 `resource/agent/system_prompt.md`，缺失或无效会阻止启动；产品 skill 只在启动期从内置与用户目录加载，坏 skill 只记录诊断，SDK 不发现项目 `AGENTS.md`、`.pi` 或其它运行期资源。
- skill 的 `SKILL.md` 描述同时作为模型描述和 UI 翻译缺失时的回退；manual-only skill 必须由显式 skill part 授权，`read_skill` 只能读取启动期形成的 `SKILL.md` 与 references 白名单，UI 翻译不进入模型上下文。
- Agent 产品工具从当前 cache / query 读取事实，写入经对应服务的 Agent 专用入口复用同一 revision、事务和项目事件边界，重型统计复用 compute worker。

## 5. 数据库与 `.lg` 存储

- `ProjectDatabase` 是 `.lg` workflow 的唯一入口；上层调用类型化读写方法，不持有 SQLite 连接，也不拼字符串操作协议。
- `transaction(projectPath, callback)` 只为该路径的连接建立事务；回调内的类型化方法仍显式接收路径，跨 `.lg` 写入不具备原子性。`create_project` 完成基础建库后在该路径事务内执行可选初始化回调；回调失败时关闭并移除新文件。
- 运行期使用 WAL；长任务通过 project lease 保留连接，普通 workflow 结束且无租约时统一 checkpoint 并关闭连接，不手动删除 `-wal` / `-shm`。
- asset 存在 `assets` 表，以 Zstd blob 落库；压缩格式集中在 `src/shared/utils/zstd-tool.ts`，数据库读取向上返回解压后的 bytes。
- `schema_version` 只描述物理表结构，业务写回迁移单独记账；完整表与 migration 清单以 migration registry 和 schema migration 代码为准。
- 启动期迁移先处理 userdata / resource 落点，再读取设置；项目迁移在 `.lg` 首次打开时先补 schema，再执行幂等写回迁移。

## 6. 更新条件

公开路由、响应壳、错误载荷、SSE、状态所有权、写入/失败语义、任务快照、worker / LLM 边界、数据库 workflow、migration 或 `.lg` 物理格式变化时更新本文；前端消费方式只更新 [`FRONTEND.md`](FRONTEND.md)。
