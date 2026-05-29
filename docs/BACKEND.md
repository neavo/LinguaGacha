# LinguaGacha 后端权威边界

本文件统一承载后端公开协议、领域边界、状态拥有者、唯一写入口、任务链路、数据库与 `.lg` 物理存储规则。字段级细节、局部算法和能从类型定义直接看出的内容留在代码和测试中。

## 1. 公开协议边界

- `BackendBootstrap` 是 GUI 与 CLI 共享的后端启停入口；它接收入口层注入的 appRoot、`openOutputFolder` 和 `BackendWorkerExecution`，并拥有日志、启动期迁移、设置、数据库、`BackendServices` 与可选 Gateway 的生命周期。
- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一装配点；具体路由只允许注册在 `src/backend/api/routes/*.ts`，POST JSON 路由必须经 `postJson` 返回统一响应壳。
- 业务 API URL 按 `/api/{功能域}/{对象?}/{动作}` 命名；当前 loaded 工程由 session 隐式绑定，业务功能域 URL 不携带 project path。
- Gateway 只监听 `127.0.0.1`，CORS 只允许 `Content-Type`；前端不依赖额外私有请求头。
- 成功响应形状为 `{ ok: true, data }`，失败响应形状为 `{ ok: false, error }`。错误载荷来自 `src/shared/error` 的 `AppError` 组装，只暴露安全字段；用户可见文案通过 i18n key 解析，内部异常、stack、API key、Authorization header 和 provider 原始响应只允许进入日志诊断。
- 内部异常跨 LLM、worker、bootstrap 或日志边界时统一归一为 `LogError`；shared error 只负责 JSON 化与长度 / 深度裁剪，路径和 URL 等敏感字段必须由 LLM、worker、Electron、renderer 等调用边界本地 typed builder 显式转成摘要值对象。`message` 只保留业务摘要，调用栈不得拼进 `message`，只能进入日志诊断视图。
- 公开 SSE 使用固定 topic 和严格 JSON 序列化：项目数据通过 `project.data_changed`，任务状态通过 `task.snapshot_changed`，设置通过 `settings.changed`，日志窗口通过 `log.appended`。
- `log.appended` 只携带列表、筛选和排序所需的轻量日志事件；完整日志正文只保留在当前进程内详情池，并通过 `/api/logs/detail` 按 ID 读取。后端不为日志详情写数据库、索引或额外文件，历史 `app.yyyymmdd.log` 不作为详情接口的数据源。
- `/api/diagnostics/renderer-error` 只接收 renderer 实际异常摘要并写入 `LogManager`；载荷必须经过 shared error 的 `RendererErrorReport` normalizer，触发事件和 renderer error context 都按 shared 白名单收窄。Gateway 不维护第二套 message / stack / context 裁剪规则；该路由不改变项目、任务或设置事实，也不保存正常 SSE 流水、完整项目 payload 或页面自定义上下文对象。
- CLI 不启动 Gateway；CLI 命令通过同进程 `BackendServices` 和 `ApiStreamHub` 复用同一业务链路。
- 发布态后端 worker 执行配置由产品入口构造为 `worker_threads`，指向桌面 bundle 内的后端 worker 入口；`in_process` 只允许测试或源码执行显式选择，不是 worker 失败回退。

## 2. 后端状态拥有者

| 状态 / 事实 | 拥有者 | 唯一写入口 / 出口 |
| --- | --- | --- |
| 应用设置、最近工程、语言 | `AppSettingService` | 设置 API、CLI transient overrides、`settings.changed` |
| 当前 loaded 工程身份 | `ProjectSessionState` | `ProjectLifecycleService` |
| 当前 loaded 工程热读数据 | `ProjectDataCache` | `ProjectLifecycleService` 热机、`ProjectEventBus` committed event、各功能域 view API |
| 后端内部 committed event | `ProjectEventBus` | 写侧事务成功后的 after-commit 发布 |
| 项目公开 manifest | `.lg` + `ProjectDataReader` | `/api/session/project/manifest` |
| 页面 view model | 各功能域 query service + `ProjectDataCache` | 各功能域 view API |
| 同步运行态项目写入 | `ProjectMutationStore` | database transaction + internal event + `ProjectChangePublisher` |
| 项目公开变更事件 | `ProjectChangeEventAdapter` + `ProjectChangePublisher` | 同一事件同时返回 HTTP 写入结果并广播 SSE |
| 任务 busy/status/request pressure | `TaskRunState` | `TaskRunPublisher` |
| 任务公开快照 | `TaskSnapshotBuilder` | 任务命令 ack、`/api/tasks/snapshot`、`task.snapshot_changed` |
| 后台任务生命周期 | `TaskEngine` | `TaskService.start_task` / `stop_task` |
| `.lg` 物理读写 | `ProjectDatabase` | `DatabaseOperation` / `execute_transaction` |
| 真实磁盘 IO 与路径身份 | `NativeFs` / `NativePathPolicy` | `src/native` |
| 后端内部日志 | `LogManager` | `app.yyyymmdd.log` 完整文件日志、轻量日志 SSE、当前进程详情池、Electron main 与 renderer 诊断 |

`ProjectOperationGate` 是结构性项目写入与后台任务启动的互斥门闩；涉及文件集合、reset、settings alignment 或任务启动的改动必须先确认它是否应参与 gate。

## 3. 项目读取与写入契约

项目数据 section 固定为：

```text
project, files, items, quality, prompts, analysis, proofreading
```

- `/api/session/project/manifest` 只返回项目身份、project revision、section revision 和 counts，不预热大 section。
- `files` / `items` / `analysis` 的 section revision 继续读写既有 `.lg` meta key `project_runtime_revision.*`；本次命名清理不改变数据库物理字段。
- 前端读取项目 view model 只能走对应功能域 view API；query response 必须携带本次 view 依赖的 `sectionRevisions`，页面写入使用这些 revision 作为乐观锁依赖。
- `ProjectDataCache` 是当前 loaded 工程的热读事实拥有者；query service 只能从 cache、按需数据库数据读取和 shared 纯算法组合页面 view，不能建立第二套长期项目事实缓存。
- 校对列表派生由 `ProofreadingCache` 在 Electron 主进程后端能力层持有；`ProjectDataCache` 不保存列表、筛选或 worker 细节，列表查询继续走本地 cache service。
- 非 engine 的重型派生通过 `BackendWorkerClient` 提交无状态后端 worker task；worker 不读数据库、不写 `.lg`、不发布事件、不持有项目 cache。
- `/api/toolbox/name-fields/view` 读取当前 loaded 工程的名称字段提取视图；前端只提交筛选和排序参数。
- `/api/toolbox/ts-conversion/files/export` 只接收转换方向和用户选项；前端不传转换后的 items。
- `/api/translation/files/export` 触发当前 loaded 工程的普通译文文件产物导出。
- 完整分析候选池不进入常驻项目快照，只能通过 `/api/analysis/candidates/list` 按需读取。
- 同步项目写入成功返回 `ProjectWriteResult = { accepted: true, changes }`；`changes` 与后续 SSE 广播是同一批后端 canonical `ProjectChangeEvent`。
- loaded 工程运行态事实写入只允许经 `ProjectMutationStore` 提交；领域服务负责请求校验、业务派生和语义化写入意图，不直接执行事务、推进 section revision 或发布项目变更。
- `ProjectMutationStore` 的提交顺序固定为数据库事务成功后先发布内部 committed event，再发布公开项目变更；内部事件失败时不能继续发布公开 SSE。
- project create/load/unload、migration、默认预设初始化、CLI bootstrap 资源提交和测试前置 seed 属于生命周期、初始化或测试夹具写入，不纳入运行态唯一写入口。
- `ProjectChangeEvent` 必须带后端确认的 `projectPath`、`projectRevision`、本次更新 section 的 `sectionRevisions` 和 `updatedSections`；不属于当前 loaded 工程的草稿不能发布。
- 变更 payload mode 只允许三类：`canonical-delta` 直接携带后端规范数据，`field-patch` 只表达校对可写字段 `dst / status / retry_count`，`section-invalidated` 只作为页面重新 query 的刷新提示。
- canonical item upsert 必须是完整公开 DTO；领域草稿可只给 `changedIds`，但公开事件必须由后端 adapter 回读补齐，瘦身 item DTO 不能进入项目事件。
- 删除语义必须显式表达 tombstone：items 用 `deleteIds`，files 用 `deletePaths`；无法精确表达删除时使用对应 section 的 full replace。
- 后端写入不接收前端派生的 `items`、task/progress extras、prefilter config 或 analysis extras 作为最终事实；页面只能提交用户意图、设置镜像和当前 section revision 依赖。

## 4. 任务、worker 与 LLM 边界

- `TaskService` 是 `/api/tasks/*` 的公开命令边界，负责 JSON 收窄、任务类型 / mode / scope 归一、section revision 校验、模型可用性基础检查和命令转交。
- 启动后台任务必须携带 `expected_section_revisions`；分析任务依赖 `quality` / `prompts`，翻译任务依赖由任务定义决定，行级重翻还必须定位当前 loaded 工程。
- `TaskService.start_task` 通过 gate 后立即写入 `requested` 并发布完整 task snapshot；Engine 启动失败时恢复前置任务状态，避免永久 busy。
- `TaskService.stop_task` 的 HTTP 回包必须重新读取当前真实 snapshot，不能把旧 stopping 意图回写给前端。
- `TaskSnapshot` 公开形状固定为 `base + progress + extras`：通用状态只在 base，进度只在 `progress`，分析候选数只在 analysis extras，翻译 scope 只在 translation extras。
- `run_revision` 是前端丢弃旧任务 snapshot 的唯一排序依据；页面不能建立“终态优先”的第二套排序规则。
- `TaskRunPublisher` 是任务状态唯一公共出口；生命周期和进度提交立即发布完整 `task.snapshot_changed`，只有 `request_in_flight_count` 展示允许后端 500ms 合并，终态前必须冲刷该窗口。
- `request_in_flight_count` 只表示真实已租约发出的 LLM 请求数量，不表示队列长度或 worker 数量。
- `TaskEngine` 是后台任务执行权威：全量翻译和分析经 RunCoordinator 全局运行锁、Planner、WorkUnit、Limiter、ModelKeyLease、Pipeline 和 Artifact Committer；单条翻译复用 limiter / key lease，但不占用全局后台任务锁。
- work-unit worker 负责提示词构建、runner、pipeline 和响应处理；planning worker 只做规划期 token 计数。worker 数量不等同于 LLM 并发。
- `src/backend/llm` 是 provider policy、request policy、官方 SDK transport、ProviderClientPool 和请求结果归一的边界；任务编排和 worker 只能消费归一后的 LLM 能力，不反向持有 provider SDK 细节。
- LLM 请求失败和 worker 执行失败只通过结构化 `LogError` 进入任务日志；任务重试和 UI 展示不解析供应商异常文本。

## 5. 数据库与 `.lg` 物理存储

- `ProjectDatabase` 是 `.lg` 物理 workflow 的唯一入口；上层只能发送严格 JSON 的 `DatabaseOperation`，不得直接持有 SQLite 连接。
- `execute()` 处理单操作；`execute_transaction()` 处理同一工程文件内的批量操作。事务不得跨 `.lg` 文件，`createProject` 特例失败时必须关闭并移除刚创建的文件。
- SQLite 运行期使用 `node:sqlite` `DatabaseSync`，连接开启 WAL / NORMAL / busy_timeout；普通 workflow 结束且无长租约时 checkpoint 并关闭连接，不手动删除 `-wal` / `-shm`。
- 长任务通过 `acquire_project_lease` 保留项目连接；租约释放函数幂等，任务持有期间看到 `-wal` / `-shm` 属于正常现象。
- `.lg` asset 存储在 `assets` 表中，内容以 Zstd 压缩 blob 落库；读取 asset 时由数据库层返回解压后的 bytes，上层不理解压缩格式。
- 当前 `.lg` schema 包含 `meta`、`assets`、`items`、`rules`、`analysis_item_checkpoint`、`analysis_candidate_aggregate`。`schema_version` 只表达物理表结构；业务写回迁移用 `applied_writeback_migrations` 独立记录。
- 启动期迁移处理 userdata/resource 文件落点，必须早于设置读取；项目数据库迁移在 `.lg` 首次打开时执行，先补 schema，再执行幂等写回迁移。
- 生产代码真实磁盘 IO 经 `src/native/native-fs.ts`；SQLite 连接生命周期只允许落在 database 或 migration 边界。

## 6. 更新触发条件

- 新增或改变 `/api/*` 路由、`src/backend/api/routes` 注册边界、响应壳、错误载荷组装、SSE topic、CORS 或 Gateway 生命周期，更新本文。
- 改项目 section、数据读取形状、写入 payload mode、revision 语义、事件去重依据或状态拥有者，更新本文并同步 [`docs/FRONTEND.md`](FRONTEND.md) 的消费边界。
- 改任务命令、snapshot 形状、运行态状态机、request pressure、worker 执行模式、LLM policy 或并发租约，更新本文。
- 改 database operation、事务、schema、migration、asset 压缩、`.lg` 文件格式或 NativeFs 边界，更新本文。
- 改 CLI 如何进入后端组合根、临时 `.lg` 或命令输出，同步 [`docs/CLI.md`](CLI.md)。
