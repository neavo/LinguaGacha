# LinguaGacha 后端权威边界

本文统一承载后端公开协议、状态拥有者、唯一写入口、任务链路、数据库与 `.lg` 物理存储规则。字段级细节、局部算法和能从类型定义直接看出的内容留在代码与测试中。

## 1. 公开协议边界

- `BackendBootstrap` 是 GUI 与 CLI 共享的后端启停入口，它拥有日志、启动期迁移、设置、数据库、`BackendServices` 与可选 Gateway 的生命周期。
- 启动顺序固定为日志 → 启动期迁移 → 设置 / 系统代理快照 → `BackendServices` → 可选 Gateway，关闭按 Gateway → services / worker pools → 系统代理 → database → log 逆序收尾。
- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一装配点，路由注册在 `src/backend/api/routes/*.ts`，POST JSON 路由经统一响应壳返回。
- 业务 URL 按 `/api/{功能域}/{对象?}/{动作}` 命名，当前 loaded 工程由 session 隐式绑定，业务 URL 不携带 project path，renderer 不能指定任意 `.lg` 路径。
- Gateway 只监听本机地址，CORS 只允许 `Content-Type`，前端不依赖额外私有请求头。
- 成功响应为 `{ ok: true, data }`，失败响应为 `{ ok: false, error }`。公开错误只暴露安全字段，stack、API key、Authorization header、provider 原始响应和完整异常只进入诊断日志。
- 公开 SSE topic 固定为 `project.data_changed`、`task.snapshot_changed`、`settings.changed`、`log.appended`，SSE data 使用严格 JSON 序列化。
- 日志列表只消费轻量 `log.appended`，完整日志正文只保存在当前进程详情池，通过 `/api/logs/detail` 按 ID 读取，不回扫历史日志文件。
- `/api/diagnostics/renderer-error` 只接收 renderer 实际异常摘要与白名单上下文，写入 `LogManager`，它不改变项目、任务或设置事实。
- CLI 不启动 Gateway，只通过同进程 `BackendServices` 与 `ApiStreamHub` 复用同一业务链路。

## 2. 状态拥有者

| 状态 / 事实 | 拥有者 | 唯一写入口 / 出口 |
| --- | --- | --- |
| 应用设置、最近工程、语言 | `AppSettingService` | 设置 API、CLI transient overrides、`settings.changed` |
| loaded 工程身份 | `ProjectSessionState` | `ProjectLifecycleService` |
| loaded 工程热读数据 | `CacheManager` | 工程热机、committed event、各功能 query API |
| 同步运行态项目写入 | `ProjectWriteStore` | database transaction → internal event → public project change |
| 后端内部 committed event | `ProjectEventBus` | 写侧事务成功后的 after-commit 发布 |
| 公开项目变更 | `ProjectChangePublisher` | 同一 `ProjectChangeEvent` 返回 HTTP 写入结果并广播 SSE |
| 任务 busy/status/request pressure | `TaskRunState` | `TaskRunPublisher` |
| 任务公开快照 | `TaskSnapshotBuilder` | 命令 ack、`/api/tasks/snapshot`、`task.snapshot_changed` |
| `.lg` 物理 workflow | `ProjectDatabase` | `DatabaseOperation` / `execute_transaction` |
| 平台 IO 与路径身份 | `NativeFs` / `NativePathPolicy` | `src/native` |
| 后端日志 | `LogManager` | 文件日志、轻量日志 SSE、当前进程详情池 |

`ProjectOperationGate` 负责结构性项目写入与后台任务启动互斥，涉及文件集合、reset、settings alignment 或任务启动的改动必须先判断是否参与 gate。

## 3. 项目读取与写入契约

项目数据 section 固定为：

```text
project, files, items, quality, prompts, analysis, proofreading
```

- `/api/session/project/manifest` 只返回项目身份、project revision、section revision 和 counts，不预热大 section。
- 页面读取项目事实只能走对应功能域 query API，query response 必须携带本次结果依赖的 `sectionRevisions`，页面写入用这些 revision 做乐观锁。
- `CacheManager` 是当前 session 热读缓存管理根，query service 只能组合 cache、按需数据库读取和 shared 纯算法，不建立第二套长期项目事实缓存。
- 运行态事实写入只允许经 `ProjectWriteStore` 提交，领域服务负责校验和语义化写入意图，不直接执行事务、推进 revision 或发布公开事件。
- 提交顺序固定为 revision guard → 数据库事务 → 内部 committed event → 公开项目变更。内部事件失败时不能继续发布公开 SSE。
- `ProjectWriteResult = { accepted: true, changes }` 中的 `changes` 与后续 SSE 是同一批后端 canonical `ProjectChangeEvent`。
- `ProjectChangeEvent` 必须绑定后端确认的 `projectPath`、`projectRevision`、本次更新 section 的 `sectionRevisions` 与 `updatedSections`，非当前 loaded 工程的草稿不能发布。
- 变更 payload mode 只允许三类：`canonical-delta` 携带后端规范数据，`field-patch` 只表达校对可写字段，`section-invalidated` 只作为页面重新 query 的刷新提示。
- `items` / `files` 的全量替换、排序和无法精确表达受影响行的运行态写入默认发布行级 `section-invalidated`，只有后端能精确表达受影响行和删除 tombstone 的小范围变化才发布行级增量。
- 后端不接收前端计算出的 `items`、task extras、prefilter config 或 analysis extras 作为最终事实，前端只提交用户意图、设置镜像和 revision 依赖。
- project create/load/unload、migration、默认预设初始化、CLI bootstrap 资源提交和测试 seed 属于生命周期、初始化或夹具写入，不纳入运行态唯一写入口；若写入 query 直接暴露的项目事实，必须在同一事务内写入对应 revision meta。

## 4. 任务、worker 与 LLM 边界

- `TaskService` 是 `/api/tasks/*` 的公开命令边界，负责 JSON 收窄、任务类型 / mode / scope 归一、section revision 校验、模型基础检查和命令转交。
- 启动后台任务必须携带任务定义声明的 `expected_section_revisions`，行级重翻还必须定位当前 loaded 工程。
- 任务通过 gate 后立即写入 `requested` 并发布完整 snapshot，Engine 启动失败时恢复前置状态，避免永久 busy。
- `stop_task` 的 HTTP 回包必须重新读取当前真实 snapshot，不能把旧 stopping 意图回写给前端。
- `TaskSnapshot` 公开形状为 `base + progress + extras`，`run_revision` 是前端丢弃旧 snapshot 的唯一排序依据。
- `TaskRunPublisher` 是任务状态唯一公共出口，生命周期和进度提交立即发布完整 `task.snapshot_changed`。只有 `request_in_flight_count` 可 500ms 合并，终态前必须冲刷。
- `request_in_flight_count` 只表示真实已租约发出的 LLM 请求数量，不表示队列长度或 worker 数量。
- `TaskEngine` 是后台任务执行权威，全量翻译、行级重翻和分析经全局运行锁、Planner、WorkUnit、Limiter、ModelKeyLease、Pipeline 与 Artifact Committer。
- work-unit worker 负责提示词构建、runner、pipeline 和响应处理，planning worker 只做规划期 token 计数。worker 数量不等同于 LLM 并发。
- 非 engine 的重型计算通过 `BackendWorkerClient` 提交无状态 worker task，worker 不读数据库、不写 `.lg`、不发布事件、不持有项目 cache。
- LLM provider policy、request policy、SDK transport 和请求结果归一归 `src/backend/llm`，任务层不解析供应商异常文本。

## 5. 数据库与 `.lg` 物理存储

- `ProjectDatabase` 是 `.lg` 物理 workflow 的唯一入口，上层只能发送严格 JSON 的 `DatabaseOperation`，不得直接持有 SQLite 连接。
- `execute()` 处理单操作，`execute_transaction()` 处理同一工程文件内的批量操作。事务不得跨 `.lg` 文件，`createProject` 特例失败时必须关闭并移除刚创建的文件。
- SQLite 运行期使用 `node:sqlite` `DatabaseSync`，连接开启 WAL / NORMAL / busy_timeout，普通 workflow 结束且无长租约时 checkpoint 并关闭连接，不手动删除 `-wal` / `-shm`。
- 长任务通过 project lease 保留连接，租约释放函数幂等，任务持有期间看到 `-wal` / `-shm` 属于正常现象。
- `.lg` asset 存储在 `assets` 表，内容以 Zstd 压缩 blob 落库，读取 asset 时数据库层返回解压后的 bytes，上层不理解压缩格式。
- 当前 `.lg` schema 包含 `meta`、`assets`、`items`、`rules`、`analysis_item_checkpoint`、`analysis_candidate_aggregate`，`schema_version` 只表达物理表结构，业务写回迁移用独立记录。
- 启动期迁移处理 userdata / resource 文件落点，必须早于设置读取，项目数据库迁移在 `.lg` 首次打开时执行，先补 schema，再执行幂等写回迁移。

## 6. 更新触发条件

- 改 `/api/*` 路由、响应壳、错误载荷、SSE topic、CORS、Gateway 生命周期或 renderer 诊断，更新本文。
- 改项目 section、query 结果、payload mode、revision、事件去重、状态拥有者或唯一写入口，更新本文并同步 [`FRONTEND.md`](FRONTEND.md)。
- 改任务命令、snapshot、状态机、request pressure、worker 模式、LLM policy 或并发租约，更新本文。
- 改 database operation、事务、schema、migration、asset 压缩、`.lg` 文件格式或 NativeFs 边界，更新本文。
