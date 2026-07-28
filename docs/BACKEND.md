# LinguaGacha 后端权威边界

本文统一承载后端公开协议、状态拥有者、项目写入、任务运行态、数据库与 `.lg` 物理存储规则。字段级细节、完整 schema 和局部算法留在代码与测试中。

## 1. 公开协议

- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一装配点；`register_api_routes` 在单一注册表中把公开路径绑定到 `BackendServices`，路由不自行组装业务依赖。
- 普通 loaded-project query / write 从 `ProjectSessionState` 取得目标工程；create、open、preview 和打开前 settings alignment 是可以接收显式路径的生命周期例外。
- Gateway 只监听本机地址，CORS 只允许 `Content-Type`，renderer 不依赖额外私有请求头。
- 成功响应为 `{ ok: true, data }`，失败响应为 `{ ok: false, error }`；公开错误不包含 diagnostic context、cause、stack 或供应商原始异常。
- 公开 SSE topic 固定为 `project.data_changed`、`task.snapshot_changed`、`settings.changed`、`log.appended`，data 使用严格 JSON 序列化。
- `log.appended` 只携带轻量预览；完整记录按日志目标落盘，`/api/logs/detail` 只查询当前进程详情池且不回扫历史文件。
- `/api/diagnostics/renderer-error` 只接收实际 renderer 异常摘要与白名单上下文并写入 `LogManager`，不改变项目、任务或设置事实。

## 2. 状态拥有者

| 状态 / 边界 | 拥有者 | 唯一写入口 / 读出口 |
| --- | --- | --- |
| 应用设置、最近工程、语言 | `AppSettingService` | 设置 API、CLI transient overrides、`settings.changed` |
| loaded 工程身份 | `ProjectSessionState` | `ProjectLifecycleService` |
| loaded 工程热读数据 | `CacheManager` | 工程热机、committed event、功能 query |
| 项目事实提交 | `ProjectWriteStore` | 单 `.lg` 事务、唯一 `ProjectEventHandler`、`adapt_project_change` |
| 活动任务类型、translation scope、status、busy、`run_revision`、请求压力 | `TaskRuntime` | 任务命令、Engine 生命周期、项目会话切换 |
| 任务 progress / analysis candidate count | `.lg` meta | `TaskProjectStore` 经 `ProjectWriteStore` 写入 |
| 任务公开快照 | `TaskRuntime.build_snapshot` | 组合内存运行态与 `.lg` meta |
| `.lg` 物理 workflow | `ProjectDatabase` | 类型化读写方法、`transaction(projectPath, callback)` |
| 平台 IO 与路径身份 | `NativeFs` / `NativePathPolicy` | `src/native` |
| 后端日志 | `LogManager` | 文件日志、轻量 SSE、当前进程详情池 |

`ProjectOperationGate` 保护会改变任务输入集合或需要慢准备的结构性项目操作；准备与最终提交必须持有同一 gate lease，避免检查通过后被任务启动插入。

## 3. 项目读取与写入

项目数据 section 固定为：

```text
project, files, items, quality, prompts, analysis, proofreading
```

- `/api/session/project/manifest` 只返回项目身份、revision 索引和 counts，不预热大 section。
- 功能 query 返回其结果依赖的 `sectionRevisions`，用户写入和任务命令以这些 revision 做乐观锁；`projectRevision` 只是所有 section revision 的最大值，不是独立全序或可写锁。
- `CacheManager` 是当前 session 的热读缓存根；query 只组合 cache、按需数据库读取和 shared 纯规则，不建立第二套项目事实。校对 `view_id` 表示稳定结果快照：条目字段增量只刷新旧视图中的行内容，删除 tombstone 从旧视图移除成员；成员与排序只由新的 list query 重算。
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

- `TaskService` 负责命令 JSON 收窄、task / mode / scope 归一、section revision 校验、gate 接入和 Engine 命令转交；激活模型由 `TaskEngine` 在每轮 run 开始时解析并冻结到运行上下文。
- 启动任务必须携带 `TaskService` 按 task type 与 scope 固定要求的 `expected_section_revisions`；通过 gate 后立即进入 busy，Engine 启动失败时恢复前置状态。
- 所有任务命令 ack 都通过 `TaskRuntime.build_snapshot` 重新读取当前事实，避免旧命令意图覆盖更晚的终态。
- `TaskRuntime.build_snapshot` 组合内存中的 status、busy、`run_revision`、请求压力与 translation scope，以及 `.lg` 中的 progress / analysis candidate count；`run_revision` 是前端丢弃旧 snapshot 的排序依据。
- 每次成功 load / unload 都推进 `ProjectSessionState` 的内部会话世代；生命周期返回前，`TaskRuntime` 重置为新会话的 idle、推进 `run_revision` 并发布快照，因此旧工程迟到帧严格早于新工程事实。
- 生命周期和进度提交立即发布完整 `task.snapshot_changed`；只有请求压力允许合并，终态前必须冲刷。请求压力只表示已租约发出的 LLM 请求，不表示队列或 worker 数量。
- `TaskRuntime` 拥有全局运行互斥、取消、终态和 Engine completion；`TaskEngine` 只负责编排，任务结果统一经 `TaskProjectStore` 进入项目写入边界。全量翻译与分析经过 Planner，行级重翻直接从目标 items 构造 context。
- work-unit worker 负责提示词构建、runner、pipeline 和响应处理；planning worker 只承担规划期计算。线程数不等于 LLM 并发，实际并发由模型 key lease 与 limiter 决定。
- 非 engine 的重型计算通过 `BackendWorkerClient` 提交无状态 worker task；worker 不读数据库、不写 `.lg`、不发布事件、不持有项目 cache。
- provider policy、request policy、SDK transport 和结果归一归 `src/backend/llm`，任务层不解析供应商异常文本。

## 5. 数据库与 `.lg` 存储

- `ProjectDatabase` 是 `.lg` workflow 的唯一入口；上层调用类型化读写方法，不持有 SQLite 连接，也不拼字符串操作协议。
- `transaction(projectPath, callback)` 只为该路径的连接建立事务；回调内的类型化方法仍显式接收路径，跨 `.lg` 写入不具备原子性。`create_project` 完成基础建库后在该路径事务内执行可选初始化回调；回调失败时关闭并移除新文件。
- 运行期使用 WAL；长任务通过 project lease 保留连接，普通 workflow 结束且无租约时统一 checkpoint 并关闭连接，不手动删除 `-wal` / `-shm`。
- asset 存在 `assets` 表，以 Zstd blob 落库；压缩格式集中在 `src/shared/utils/zstd-tool.ts`，数据库读取向上返回解压后的 bytes。
- `schema_version` 只描述物理表结构，业务写回迁移单独记账；完整表与 migration 清单以 migration registry 和 schema migration 代码为准。
- 启动期迁移先处理 userdata / resource 落点，再读取设置；项目迁移在 `.lg` 首次打开时先补 schema，再执行幂等写回迁移。

## 6. 更新条件

公开路由、响应壳、错误载荷、SSE、状态所有权、写入/失败语义、任务快照、worker / LLM 边界、数据库 workflow、migration 或 `.lg` 物理格式变化时更新本文；前端消费方式只更新 [`FRONTEND.md`](FRONTEND.md)。
