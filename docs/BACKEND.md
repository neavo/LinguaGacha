# LinguaGacha 后端权威边界

本文统一承载共享后端公开协议、状态拥有者、项目写入、任务运行态、数据库与 `.lg` 物理存储规则；产品 Agent 的专属协议与运行时归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。字段级细节、完整 schema 和局部算法留在代码与测试中。

## 1. 公开协议

- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一装配点；`register_api_routes` 在单一注册表中把公开路径绑定到 `BackendServices`，路由不自行组装业务依赖。
- 普通 loaded-project query / write 从 `ProjectSessionState` 取得目标工程；create、open、preview、`/api/session/source-files/summary` 和打开前 settings alignment 是可以接收显式路径的生命周期例外。source-files summary 只按共享互斥扩展名目录递归发现并去重，返回文件总数与各格式命中数，不读取内容或向 renderer 公开文件路径。
- Gateway 只监听本机地址，CORS 只允许 `Content-Type`，renderer 不依赖额外私有请求头。
- 成功响应为 `{ ok: true, data }`，失败响应为 `{ ok: false, error: { code, details? } }`；`APP_ERROR_DEFINITIONS` 是错误码、严重度和 HTTP 状态的唯一词表。公开错误不携带服务端本地化文案、request id、diagnostic context、cause、stack 或供应商原始异常，request id 只保留在后端日志上下文中。
- 公开 SSE topic 固定为 `project.data_changed`、`task.snapshot_changed`、`runtime.snapshot_changed`、`agent.session_event`、`settings.changed`、`log.appended`，data 使用严格 JSON 序列化；`POST /api/runtime/snapshot` 返回带单调 `revision` 的当前运行所有者 `task | agent | null`。
- 通用质量规则由切片 query / update 读写，分析术语导入等复合 workflow 保留独立命令；校对 query 统一分发读取，items update 原子批量更新 `dst` / `name_dst` / 人工状态，清空与替换保留各自的后端意图命令。
- 模型管理 API 只负责配置 CRUD；任务入口按 `translation`、`analysis` 或 `agent` 用途读取窄选项并更新单项选择。选项只携带显示身份与解析后的非敏感 Agent 容量，不公开自动配置、密钥、请求覆盖或生成参数。
- `LogManager` 以 `LogContent` 判别联合保存单一正文事实：文件和控制台从它生成纯文本投影，`log.appended` 只携带轻量预览，详情 query 只查询当前进程结构化详情池且不回扫历史文件。`source: agent-tool` 的完整严格 JSON 正文是 file-only 特例，不进入控制台或日志窗口、不使用会裁剪的 context，并沿用每日文件及最近三个日期文件的轮转。
- renderer 诊断入口只接收实际异常摘要与白名单上下文并写入 `LogManager`，不改变项目、任务或设置事实。

## 2. 状态拥有者

| 状态 / 边界 | 拥有者 | 唯一写入口 / 读出口 |
| --- | --- | --- |
| 应用设置、最近工程、语言 | `AppSettingService` | 设置 API、CLI transient overrides、`settings.changed` |
| 模型集合、配置与按用途选择 | `ModelService` | 模型 API；经 `AppSettingService` 持久化到应用设置 |
| 普通任务 / Agent 活动所有者与项目写互斥 | `RuntimeOperationGate` | 运行 lease、`POST /api/runtime/snapshot`、`runtime.snapshot_changed` |
| loaded 工程身份 | `ProjectSessionState` | `ProjectLifecycleService` |
| loaded 工程热读数据 | `CacheManager` | 工程热机、committed event、功能 query |
| Agent 工程数据快照与 change 准备 | `AgentWorkspaceService` | 完整 load / run / apply 生命周期 |
| 项目事实提交 | `ProjectWriteStore` | 单 `.lg` 事务、唯一 `ProjectEventHandler`、`adapt_project_change` |
| 活动任务类型、translation scope、status、busy、`run_revision`、请求压力 | `TaskRuntime` | 任务命令、Engine 生命周期、项目会话切换 |
| 任务 progress / analysis candidate count | `.lg` meta | `TaskProjectStore` 经 `ProjectWriteStore` 写入 |
| 任务公开快照 | `TaskRuntime.build_snapshot` | 组合内存运行态与 `.lg` meta |
| `.lg` 物理 workflow | `ProjectDatabase` | 类型化读写方法、`transaction(projectPath, callback)` |
| 平台 IO 与路径身份 | `NativeFs` / `NativePathPolicy` | `src/native` |
| 后端日志 | `LogManager` | 文件日志、轻量 SSE、当前进程详情池 |

`RuntimeOperationGate` 是普通任务、Agent 与项目结构性写入的唯一互斥边界。task / Agent 的运行 lease 从受理持有到最终 settle，二者完全互斥；普通项目写入的准备与提交持有同一项目写 lease，设置和模型配置写入也必须先确认运行时空闲。Agent 只能在自己的运行 lease 内由 `AgentWorkspaceService` 串行调用 `ProjectWriteStore`；冲突统一返回 `runtime.busy`。

## 3. 项目读取与写入

项目数据 section 固定为：

```text
project, files, items, quality, prompts, analysis, proofreading
```

- `/api/session/project/manifest` 只返回项目身份、revision 索引和 counts，不预热大 section。
- 功能 query 返回其结果依赖的 `sectionRevisions`；只有基于已消费快照形成的用户写入或预演提交才以这些 revision 做乐观锁。任务启动和面向当前项目事实的 reset 不携带 revision，由运行或项目写 lease 后读取当前事实；`projectRevision` 只是所有 section revision 的最大值，不是独立全序或可写锁。
- `CacheManager` 是当前 session 的热读缓存根；query 只组合 cache、按需数据库读取和 shared 纯规则，不建立第二套项目事实。
- 项目内质量规则条目统一通过 `QualityRule` 与 `normalize_quality_rule_entries` 收窄，并由真实执行器校验；运行期只要求每个 kind 内的 `entry_id` 非空且唯一，不校验身份格式。无项目身份的导入文件、预设、CLI 资源与分析候选只能经显式创建入口取得新身份，外部文件和预设不持久化项目身份；入口不得另建字段、身份回退或正则容错。
- 质量规则的模式语义集中在 shared：普通字面量始终执行 NFKC，`case_sensitive` 只控制大小写折叠；正则保持 JavaScript 原生语义。术语按独立的 `src/name_src` 字段命中并用同一 matcher 检查对应译文字段，替换与文本保护按字段内逐行执行；导入身份和字面量包含关系复用相同模式语义。
- 翻译与校对复用共享的逐行源文准备事实，固定 Ruby 清理、空白与保护前后缀提取、译前替换和保护样例收集的顺序；校对不逆推译后规则。校对 worker 与 cache identity 携带完整文本处理配置，增量评估沿用全量同步冻结的配置。
- 校对 reader 同时维护原始自然顺序和单个 GUI 列表视图：`view_id` 表示稳定结果快照，条目字段增量只刷新旧视图中的行内容，删除 tombstone 从旧视图移除成员，成员与排序只由新的 list query 重算。list query 可用稳定 `row_id` 锚定首次返回窗口，并复用视图反向索引一次返回目标附近行；上下文与按 ID 读取只查询共享评估运行态，不创建或替换该视图。
- 校对缓存的热查询只比较项目、epoch、revision 与处理配置组成的轻量身份；完整 items / quality 同步输入只在身份未命中时构造。
- `QualityRuleAnalysisCache` 是四类质量规则命中数、代表例句和字面包含父项的唯一后端分析缓存，供 GUI query 使用；缓存命中只读取缓存引用和轻量 revision，不复制 item、不重建文本组或计算内容签名。quality 变化同时失效统计与父项，item 变化只按受影响文本侧失效统计并保留父项；无法证明范围时失效全部统计。
- 质量规则分析按不同 item 去重计算 `hits`，同一 item 内多字段、多次或重叠命中只计一次；术语读取原文字段，其余规则按生产语义逐行读取原文或译文。worker 在同一遍命中扫描中保留最多两个确定性 `examples`，不保存完整候选集，并按 item 顺序输出。
- 质量规则结构分析只返回复用正式字面匹配语义的真实包含父项；完全等价和正则不形成父项，也不生成全局关系组或推断公共词根。
- 客户端只提交用户意图和必要的设置镜像；canonical items、task extras、prefilter 结果和 analysis 结果由后端计算。
- 快照派生写入在最终提交点完成 revision guard 与单 `.lg` 事务；当前事实 reset、任务 artifact 等写入不带预期 revision，但仍通过 `ProjectWriteStore` 更新事实和 section revision。
- settings-only alignment 只发布内部 committed event，不发布公开 project change；仅持久化任务 progress 的写入走 task snapshot 通道，不制造项目变更事件。
- 项目事实事务提交后才把类型化 committed event 交给唯一缓存 handler，缓存完成后再发布公开 change。后置缓存或公开事件同步失败不会回滚已提交事务，统一转换为带 `committed: true`、提交后 section revisions 和重新加载动作的 `data.committed_sync_failed`；调用方不得重试该写入。常规增量维护失败由 `CacheManager` 标记为可恢复，并在后续 query 前从数据库重建。
- HTTP `changes` 与 SSE 使用同一 canonical `ProjectChangeEvent`，消费者不得依赖两条通道的网络到达顺序。
- 公开事件绑定后端确认的 `projectPath`、`projectRevision`、`sectionRevisions` 与 `updatedSections`；payload mode 只允许 `canonical-delta`、`field-patch`、`section-invalidated`。
- 全量替换、排序或无法精确表达受影响行的写入使用 `section-invalidated`；只有能完整表达受影响行和删除 tombstone 的小范围变化才发布行级增量。
- Agent 磁盘工作区只是一次性只读快照和显式 change 准备区，不是 `.lg` 写入口。`AgentWorkspaceService` 对完整七 section revision、工程 epoch 与语言做 freshness 守卫；apply 只解析固定 change 文件，items 用稳定 ID 定点读取，prompts 只读取目标 kind，quality 只为受影响 kind 按删除、更新、创建、移动构造 prospective 最终集合并复用真实领域规范化与重复组校验。功能开关不进入工作区，也不随 apply 改变。
- `ProjectWriteStore.apply_agent_workspace_changes` 是工作区唯一物理写入口：一次 `BEGIN IMMEDIATE` 内完成完整 revision guard，并组合 items / proofreading 字段补丁、任意多个受影响 quality kind 最终集合和目标 prompt 正文。每个变化 section 的 aggregate revision 只推进一次，同一事务内变化的 quality kind 或 prompt kind 共用各自的新 revision；items 公开载荷固定为 `section-invalidated`。方法返回独立于公开事件存在与否的 committed ack 和提交后 revisions。
- 工作区无真实 change 时不调用 store、不推进 revision、不发布事件。任一数据库写失败会回滚所有 item、规则、提示词与 revision，且不发布内部或公开事件；事务回滚保留工作区供安全重试，revision 冲突则废弃旧快照。成功提交后才按 items、quality、prompts 顺序维护 cache，最后发布一个统一公开 change；后置同步失败按已经提交处理，不做补偿或重复写入。
- create / load / migration / 默认预设初始化与 CLI bootstrap 资源属于生命周期或初始化写入；若它们改变 query 可见事实，必须在同一事务更新对应 revision meta。

## 4. 任务、worker 与 LLM

- `TaskService` 只负责命令 JSON 收窄、task / mode / scope 归一和 Engine 命令转交；启动命令不携带 `expected_section_revisions`。`TaskRuntime.begin` 原子取得共享运行 lease，成为任务受理的唯一并发边界；`TaskEngine` 随后读取当前工程事实，并在每轮 run 开始时按 translation / analysis 用途解析模型，与限流、提示词配置一起冻结到运行上下文。行级重翻和 CLI 复用同一任务入口，不另建模型选择旁路。
- Agent、任务或结构性项目写入占用共享门禁时，任务启动统一返回 `runtime.busy`；取得 task lease 后立即进入 busy，Engine 启动失败时恢复前置状态并释放 lease。
- 所有任务命令 ack 都通过 `TaskRuntime.build_snapshot` 重新读取当前事实，避免旧命令意图覆盖更晚的终态。
- 每次成功 load / unload 都推进 `ProjectSessionState` 的内部会话世代；生命周期返回前，`TaskRuntime` 重置为新会话的 idle、推进 `run_revision` 并发布快照，因此旧工程迟到帧严格早于新工程事实。
- 生命周期和进度提交立即发布完整 `task.snapshot_changed`；只有请求压力允许合并，终态前必须冲刷。请求压力只表示已租约发出的 LLM 请求，不表示队列或 worker 数量。
- `TaskRuntime` 拥有任务取消、终态和 Engine completion，并以当前 active run 派生 task snapshot 的 `busy`。`TaskEngine` 只负责编排，任务结果统一经 `TaskProjectStore` 进入项目写入边界。全量翻译与分析经过 Planner，行级重翻直接从目标 items 构造 context。
- work-unit worker 负责提示词构建、runner、pipeline 和响应处理，但不持有供应商网络客户端；模型请求通过类型化 worker 消息回到父线程唯一的 `LLMClient`，取消仍使用原 work unit 的 signal。planning worker 只承担规划期计算。线程数不等于 LLM 并发，实际并发由模型 key lease 与 limiter 决定。
- 翻译 work unit 在 pre-pipeline 前从原始 source fields 计算术语覆盖，再以全局开关和非空 `dst` 裁出 Prompt 激活条目；PromptBuilder 只格式化已激活条目，不根据预处理或模型输入文本再次匹配。
- 非 engine 的重型计算通过 `ComputeWorkerClient` 提交无状态 compute task；worker 不读数据库、不写 `.lg`、不发布事件、不持有项目 cache。
- 模型请求快照、`api_format` 协议策略、最终请求覆盖、结果归一和模型列表探测归 `src/backend/llm`；OneShot 与 Agent 共用同一请求事实和 `pi-ai` 原生 adapter，模型列表探测直接调用供应商 REST API。`LLMClient` 独立拥有 OneShot 的总时限、取消、退化和结果语义，任务层不解析供应商异常文本。
- 除 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md) 定义的 Agent 公网 URL 安全抓取外，`src/backend/network` 是普通后端远端 HTTP 的唯一传输所有者；`BackendBootstrap` 在服务启动前把它安装为当前 Backend Runtime worker 或 CLI 进程的 `globalThis.fetch`，模型 adapter、模型列表和 Web Search 不再各自传递 transport。每次请求按当前 Electron session 代理规则选路，loopback 固定直连；解析失败、路由不受支持或代理失败都结束请求，不绕过代理静默直连，也不改写进程全局 dispatcher。
- OpenAI Chat Completions 与 Responses 是显式独立的 `api_format`，不按 URL 或模型名自动探测，也不互相重试或降级；模型族思考字段由项目共享策略生成，未收录模型不猜测，`extra_body` 最后覆盖。Responses 的原生载荷与连续性由 `pi-ai` 生成；除通用思考与 `extra_body` 策略外，项目只把其中的系统指令规范为 `developer`，指令角色不随思考档位变化。

## 5. 数据库与 `.lg` 存储

- `ProjectDatabase` 是 `.lg` workflow 的唯一入口；上层调用类型化读写方法，不持有 SQLite 连接，也不拼字符串操作协议。
- `transaction(projectPath, callback)` 只为该路径的连接建立事务；回调内的类型化方法仍显式接收路径，跨 `.lg` 写入不具备原子性。`create_project` 完成基础建库后在该路径事务内执行可选初始化回调；回调失败时关闭并移除新文件。
- 运行期使用 WAL；长任务通过 project lease 保留连接，普通 workflow 结束且无租约时统一 checkpoint 并关闭连接，不手动删除 `-wal` / `-shm`。
- asset 存在 `assets` 表，以 Zstd blob 落库；压缩格式集中在 `src/shared/utils/zstd-tool.ts`，数据库读取向上返回解压后的 bytes。
- `schema_version` 只描述物理表结构，业务写回迁移单独记账；完整表与 migration 清单以 migration registry 和 schema migration 代码为准。
- 启动期迁移先处理 userdata / resource 落点，再读取设置；项目迁移在 `.lg` 首次打开时先补 schema，再执行幂等写回迁移。
