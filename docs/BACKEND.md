# LinguaGacha 后端权威边界

本文件统一承载后端公开协议、领域边界、状态拥有者、唯一写入口、任务链路、数据库与 `.lg` 物理存储规则。字段级细节、局部算法和能从类型定义直接看出的内容留在代码和测试中。

## 1. 公开协议边界

- `CoreBootstrap` 是 GUI 与 CLI 共享的 Core 启停入口；它接收入口层注入的 appRoot、`openOutputFolder` 和 `EngineExecution`，并拥有日志、启动期迁移、设置、数据库、`CoreServices` 与可选 Gateway 的生命周期。
- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一注册点；路由集中注册在 `src/core/api/api-gateway-server.ts`，POST JSON 路由必须经 `post_json` 返回统一响应壳。
- Gateway 只监听 `127.0.0.1`，CORS 只允许 `Content-Type`；renderer 不依赖额外私有请求头。
- 成功响应形状为 `{ ok: true, data }`，失败响应形状为 `{ ok: false, error }`。错误载荷来自 `src/shared/error` 的 `AppError` 投影，只暴露安全字段；用户可见文案通过 i18n key 解析，内部异常、stack、API key、Authorization header 和 provider 原始响应只允许进入日志诊断。
- 公开 SSE 使用固定 topic 和严格 JSON 序列化：项目数据通过 `project.data_changed`，任务运行态通过 `task.snapshot_changed`，设置通过 `settings.changed`，日志窗口通过 `log.appended`。
- `log.appended` 只携带列表、筛选和排序所需的轻量日志事件；完整日志正文只保留在当前进程内详情池，并通过 `/api/logs/detail` 按 ID 读取。Core 不为日志详情写数据库、索引或额外文件，历史 `app.yyyymmdd.log` 不作为详情接口的数据源。
- CLI 不启动 Gateway；CLI 命令通过同进程 `CoreServices` 和 `CoreEventHub` 复用任务、项目、导出和质量服务。
- 发布态任务执行入口由产品入口构造为 `worker_threads`，指向桌面 bundle 内的 work-unit 与 planning worker；`in_process` 只允许测试或源码执行显式选择，不是 worker 失败回退。

## 2. Core 状态拥有者

| 状态 / 事实 | 拥有者 | 唯一写入口 / 出口 |
| --- | --- | --- |
| 应用设置、最近工程、语言 | `AppSettingService` | 设置 API、CLI transient overrides、`settings.changed` |
| 当前 loaded 工程身份 | `ProjectSessionState` | `ProjectLifecycleService` |
| 项目公开快照 | `.lg` + `ProjectRuntimeProjectionService` | `/api/project/manifest`、`/api/project/read-sections`、`/api/project/items/read-by-ids` |
| 同步项目 mutation | `ProjectSyncMutationService` / `ProofreadingService` / `QualityService` 等领域服务 | database transaction + `ProjectChangePublisher` |
| 项目变更事件 | `ProjectChangeEventAdapter` + `ProjectChangePublisher` | 同一事件同时返回 HTTP mutation result 并广播 SSE |
| 任务 busy/status/request pressure | `TaskRuntimeState` | `TaskRuntimePublisher` |
| 任务公开快照 | `TaskSnapshotBuilder` | 任务命令 ack、`/api/tasks/snapshot`、`task.snapshot_changed` |
| 后台任务生命周期 | `TaskEngine` | `TaskService.start_task` / `stop_task` |
| `.lg` 物理读写 | `ProjectDatabase` | `DatabaseOperation` / `execute_transaction` |
| 真实磁盘 IO 与路径身份 | `NativeFs` / `NativePathPolicy` | `src/native` |
| Core 内部日志 | `LogManager` | `app.yyyymmdd.log` 完整文件日志、轻量日志 SSE、当前进程详情池、Electron main 诊断 |

`ProjectOperationGate` 是结构性项目 mutation 与后台任务启动的互斥门闩；涉及文件集合、reset、settings alignment 或任务启动的改动必须先确认它是否应参与 gate。

## 3. 项目读取与 mutation 契约

项目数据 section 固定为：

```text
project, files, items, quality, prompts, analysis, proofreading
```

- `/api/project/manifest` 只返回项目身份、project revision、section revision 和 counts，不预热大 section。
- `/api/project/read-sections` 按需返回 ProjectStore 可合并形状；`items` 使用 `item_id` map，`files` 使用相对路径 map，`quality` / `prompts` 使用公开 kind，`analysis` 只返回轻量 extras、candidate count 和 status summary。
- 完整分析候选池不进入常驻项目快照，只能通过 `/api/project/analysis/candidates` 按需读取。
- 同步项目 mutation 成功返回 `ProjectMutationResult = { accepted: true, changes }`；`changes` 与后续 SSE 广播是同一批后端 canonical `ProjectChangeEvent`。
- `ProjectChangeEvent` 必须带后端确认的 `projectPath`、`projectRevision`、本次更新 section 的 `sectionRevisions` 和 `updatedSections`；不属于当前 loaded 工程的草稿不能发布。
- 变更 payload mode 只允许四类：`canonical-delta` 直接携带后端规范数据，`field-patch` 只表达校对可写字段 `dst / status / retry_count`，`ids-only` 要求前端补读公开 DTO，`section-invalidated` 只用于异常恢复。
- canonical item upsert 必须是完整公开 DTO；瘦身 item DTO 不能进入项目事件。
- 删除语义必须显式表达 tombstone：items 用 `deleteIds`，files 用 `deletePaths`；无法精确表达删除时使用对应 section 的 full replace。
- 后端 mutation 不接收 renderer 派生的 `items`、task/progress extras、prefilter config 或 analysis extras 作为最终事实；页面只能提交用户意图、设置镜像和当前 section revision 依赖。

## 4. 任务、worker 与 LLM 边界

- `TaskService` 是 `/api/tasks/*` 的公开命令边界，负责 JSON 收窄、任务类型 / mode / scope 归一、section revision 校验、模型可用性基础检查和命令转交。
- 启动后台任务必须携带 `expected_section_revisions`；分析任务依赖 `quality` / `prompts`，翻译任务依赖由任务定义决定，行级重翻还必须定位当前 loaded 工程。
- `TaskService.start_task` 通过 gate 后立即写入 `requested` 并发布完整 task snapshot；Engine 启动失败时恢复前置运行态，避免永久 busy。
- `TaskService.stop_task` 的 HTTP 回包必须重新读取当前真实 snapshot，不能把旧 stopping 意图回写给前端。
- `TaskSnapshot` 公开形状固定为 `base + progress + extras`：通用状态只在 base，进度只在 `progress`，分析候选数只在 analysis extras，翻译 scope 只在 translation extras。
- `runtime_revision` 是前端丢弃旧任务 snapshot 的唯一排序依据；页面不能建立“终态优先”的第二套排序规则。
- `TaskRuntimePublisher` 是任务运行态唯一公共出口；生命周期和进度提交立即发布完整 `task.snapshot_changed`，只有 `request_in_flight_count` 展示允许后端 500ms 合并，终态前必须冲刷该窗口。
- `request_in_flight_count` 只表示真实已租约发出的 LLM 请求数量，不表示队列长度或 worker 数量。
- `TaskEngine` 是后台任务执行权威：全量翻译和分析经 RunCoordinator 全局运行锁、Planner、WorkUnit、Limiter、ModelKeyLease、Pipeline 和 Artifact Committer；单条翻译复用 limiter / key lease，但不占用全局后台任务锁。
- work-unit worker 负责提示词构建、runner、pipeline 和响应处理；planning worker 只做规划期 token 计数。worker 数量不等同于 LLM 并发。
- `src/core/llm` 是 provider policy、request policy、官方 SDK transport、ProviderClientPool 和请求结果归一的边界；任务编排和 worker 只能消费归一后的 LLM 能力，不反向持有 provider SDK 细节。

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

- 新增或改变 `/api/*` 路由、响应壳、错误投影、SSE topic、CORS 或 Gateway 生命周期，更新本文。
- 改项目 section、投影形状、mutation payload mode、revision 语义、事件去重依据或状态拥有者，更新本文并同步 [`docs/FRONTEND.md`](FRONTEND.md) 的消费边界。
- 改任务命令、snapshot 形状、运行态状态机、request pressure、worker 执行模式、LLM policy 或并发租约，更新本文。
- 改 database operation、事务、schema、migration、asset 压缩、`.lg` 文件格式或 NativeFs 边界，更新本文。
- 改 CLI 如何进入 Core、临时 `.lg` 或命令输出，同步 [`docs/CLI.md`](CLI.md)。
