# LinguaGacha 后端权威边界

本文统一承载共享后端公开协议、状态拥有者、项目写入、任务运行态、数据库与 `.lg` 物理存储规则；产品 Agent 的专属协议与运行时归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。字段级细节、完整 schema 和局部算法留在代码与测试中。

## 1. 公开协议

- `ApiGatewayServer` 是 Electron 运行态公开 `/api/*` 的唯一装配点；`register_api_routes` 在单一注册表中把公开路径绑定到 `BackendServices`，路由不自行组装业务依赖。
- 普通 loaded-project query / write 从 `ProjectSessionState` 取得目标工程；create、open、preview、`/api/session/source-files/summary` 和打开前 settings alignment 是可以接收显式路径的生命周期例外。source-files summary 只按共享互斥扩展名目录递归发现并去重，返回文件总数与各格式命中数，不读取内容或向 renderer 公开文件路径。
- Gateway 只监听本机地址，CORS 只允许 `Content-Type`，renderer 不依赖额外私有请求头。
- 成功响应为 `{ ok: true, data }`，失败响应为 `{ ok: false, error: { code, details? } }`；`APP_ERROR_DEFINITIONS` 是错误码、严重度和 HTTP 状态的唯一词表。公开错误不携带服务端本地化文案、request id、diagnostic context、cause、stack 或供应商原始异常，request id 只保留在后端日志上下文中。
- 公开 SSE topic 固定为 `project.data_changed`、`batch_translation.snapshot_changed`、`runtime.snapshot_changed`、`agent.session_event`、`settings.changed`，data 使用严格 JSON 序列化；`POST /api/runtime/snapshot` 返回带单调 `revision` 的当前运行所有者 `batch_translation | agent | model_test | null`。
- 通用质量规则由切片 query / update 读写，校对 query 统一分发列表、上下文、筛选面板与真实 warning 类型计数。items update 对正文译文的实际修改统一完成条目并清零 `retry_count`，相同非空译文可以确认 `ERROR` 结果，显式人工状态最后覆盖且同样清零，姓名译文保持正文状态与重试历史；清空命令以必填 `reset_status` 决定是否同时恢复状态和重试次数，替换保留独立的后端意图命令。
- `POST /api/session/project/preview` 直接读取磁盘，不加载或切换会话；文件路径与工作台共用 asset 顺序及历史条目补齐规则，统计复用 `build_project_translation_stats`。
- `POST /api/project/translation-stats` 提供当前工程统计，成功与跳过条目占全部条目的比例取整为完成率，空工程为零，仍有未完成对象时最高为 99%；该口径独立于本轮任务进度。响应携带工程路径供切换隔离。
- `POST /api/workbench/snapshot` 的文本文件复用工程统计口径；PDF 按原页处置计数，translate（含空译稿）为完成，keep 与 omit 为跳过，其余为等待，失败计数为 null。完成率复用工程取整规则，与核对标记独立；工程统计仍只汇总文本条目。
- 模型管理 API 只负责配置 CRUD；任务入口读取窄选项，通过组合选模或按用途更新等级命令修改配置。选项只携带显示身份、解析后的非敏感 Agent 容量、当前等级与可用等级，不公开自动配置、密钥、请求覆盖或生成参数。
- `LogManager` 统一日志入口，`LogFileStore` 拥有每日正文 `.jsonl` 与可重建索引 `.idx.jsonl`。文件和 API 传递同一份正文，控制台和索引消费文本投影；Agent 事件字段由后端生产者约束，读取端按 JSON 展示。翻译摘要冻结本地化文案，其投影省略 `LogError.message`、保留调用栈。日志写入时间由 `LogManager` 生成；翻译起止时间由 worker 在模型请求开始和响应处理收尾时捕获，回放保留原值。
- 日志身份采用日期和物理行号，隐藏与损坏行同样计数；字节定位只留在索引。每个日期在进程首次访问时重建索引，随后通过文件身份、大小和时间戳区别自身追加与外部编辑；编辑或索引失效更换内容代次，旧游标与详情请求过期。正文先写、索引后写；同日期恢复任务共享，失败保留正文，日志自身故障走 stderr。
- 查询固定在显式日期文件内结束；隐藏记录 `window: false` 不进入摘要和详情。Agent 对话与执行记录消费同一查询链路，其生产和生命周期边界归 [AGENT_RUNTIME](AGENT_RUNTIME.md)。正文、索引和旧 `.log` 按最近三个日期共同轮转；旧 `.log` 只供直接查看。
- renderer 诊断入口只接收实际异常摘要与白名单上下文并写入 `LogManager`，不改变项目、任务或设置事实。

`POST /api/models/select` 接受 `target`（translation / agent / agent_batch_translation）、`model_id` 和可选 `thinking_level`，返回 `ModelSelectionSnapshot`。Agent 主模型选择不接受等级，批量跟随使用 `model_id: null` 且不带等级；省略等级保留模型归一配置，显式等级须属于模型能力集合。`ModelService` 在同一配置副本中校验并更新选择和模型全局等级，同步保存一次，设置文件写入成功后才更新缓存；该边界不提供磁盘写入回滚。独立等级更新按用途定位当前模型。

内置模型目录按 ID 补齐缺失模型并提供重置模板；已有用户配置与选择保留。预设下架后可删除，仍有模板时可重置且禁止删除。`ModelService` 每次操作共用一份目录判断权限，快照的 `can_reset` 不持久化，类型仍记录来源与分组。目录允许空数组；读取、解析或结构校验失败在配置写入前报错，避免把资源损坏解释为下架。

`POST /api/models/copy` 接受源配置内部 ID `model_id`，一次保存后返回 `snapshot` 和 `copied_model_id`。复制源模型当前完整配置，按协议进入对应自定义分类末尾；SakuraLLM 禁止复制。副本使用新 ID，名称按当前应用语言在整个模型集合中避重，有效模型选择保留原值。

## 2. 状态拥有者

|状态 / 边界|拥有者|唯一写入口 / 读出口|
|---|---|---|
|应用设置、最近工程、语言|`AppSettingService`|设置 API、CLI transient overrides、`settings.changed`|
|模型集合、配置与按用途选择|`ModelService`|模型 API；经 `AppSettingService` 持久化到应用设置|
|翻译 / Agent / 接口测试占用与工程写互斥|`RuntimeOperationGate`|运行 lease、`POST /api/runtime/snapshot`、`runtime.snapshot_changed`|
|loaded 工程身份|`ProjectSessionState`|`ProjectLifecycleService`|
|loaded 工程热读数据|`CacheManager`|工程热机、committed event、功能 query|
|Agent 工程数据快照与 change 准备|`AgentWorkspaceService`|完整 load / run / apply 生命周期|
|项目事实提交|`ProjectWriteStore`|单 `.lg` 事务、唯一 `ProjectEventHandler`、`adapt_project_change`|
|Item 状态值域与重复关系|`domain/item` / `ProjectWriteStore`|人工状态只含 `NONE`、`PROCESSED`、`EXCLUDED`；重复组协调器物化 `DUPLICATED`|
|活动 run、operation、scope、本轮进度、status、revision、请求压力和 completion|`BatchTranslationRuntime`|批量翻译命令、Runner 生命周期和项目会话切换|
|累计翻译进度|`.lg` 的翻译进度 meta|`BatchTranslationProjectStore` 经 `ProjectWriteStore` 写入|
|批量翻译公开快照|`BatchTranslationRuntime.build_snapshot`|内存运行态、本轮进度与当前工程累计进度|
|`.lg` 物理 workflow|`ProjectDatabase`|类型化读写方法、`transaction(projectPath, callback)`|
|平台 IO 与路径身份|`NativeFs` / `NativePathPolicy`|`src/native`|
|后端日志|`LogManager`|正文文件、可重建索引与按位置查询|

`RuntimeOperationGate` 是批量翻译、Agent、接口测试与工程写入 / 生命周期操作的唯一互斥边界。三类执行从受理到最终收尾持有运行 lease；普通工程写入的准备与提交持有同一工程写 lease。纯应用设置、模型配置管理、预设文件管理与只读查询不占用运行时；模型列表探测只请求元数据，接口测试才取得 `model_test` lease。执行入口冻结所用配置，运行中修改或删除配置只影响后续执行。Agent 工作区变更在自己的运行 lease 内由 `AgentWorkspaceService` 串行调用 `ProjectWriteStore`；Agent 发起的批量翻译复用该 lease，由共享批量翻译链路经 `ProjectWriteStore` 提交。冲突统一返回 `runtime.busy`。

`POST /api/settings/update` 由 `AppSettingsCommandService` 编排，返回 `settings + accepted + changes`。语言和预过滤修改涉及已加载工程时，准备、配置保存、工程提交及失败补偿持有同一写 lease；目标语言只同步设置，其余工程设置重算预过滤。提交前失败只补偿本次字段，已提交错误保留新配置；设置通知在两个存储完成后发布。配置与工程持久化分别归 `AppSettingService` 和 `ProjectWriteStore`。

接口测试的多 Key 请求共用取消信号和配置副本。GUI 关闭先停止 Gateway 受理，并同时取消接口测试，避免 Gateway 排空在途 HTTP 时等待无法取消的请求；业务根释放前等待测试完成链。

## 3. 项目读取与写入

- 文件列表按 asset 组装；普通文件类型取首个 Item，零条目为 NONE，PDF 类型来自文档身份。预览与持久化读取采用相同规则。
- PDF 导入只读取原稿摘要和 PDFPage 元信息，原始资产与文档同事务保存，资产导入和替换明确携带 PDFDocument 或表示文本格式的 null，零 Item 的 PDF 工程有效。
- PDF 以原稿页为持久化和修改单位，未提交页沿用已保存事实。translation 为 null 表示待处理并暂时输出原页，keep 确认无需翻译并保留原页，omit 按用户要求省略原页，后两者须提供非空白理由。空 translate 表示内容已归入其它页。跨页归属由 Agent 安排，语言由工程设置提供。
- 页指纹绑定文件路径、来源摘要和该页全部事实。重复意图、旧指纹和非法内容只拒绝对应页，合法页沿用工程写入事务；原稿替换使旧页指纹失效。`ProjectWriteStore` 将 Agent 的 `pages` 变更写入 PDF 存储，并独立推进 `pdf` revision 和摘要事件。`pdf` 数据分区同时覆盖来源文档与格式统计；文件替换重建页面，删除清理来源与页面，翻译重置清空译稿、核对与续做记录。
- 提交、预览与导出共用逐页 Markdown 编译，脚注与标题链接在页内隔离，公式错误报告原页码与位置。聊天和 PDF 共用语法配置，HTML 按文本输出，图片仅引用本原稿区域。正文使用原页可见尺寸，尺寸和背景相同的相邻译稿连续排版，空译稿不输出也不打断正文；保留页和省略页结束当前排版。原页批注保留，译文链接在导入后重建。背景覆盖每张译文页底层，不参与正文分页。
- `POST /api/proofreading/page` 按工程、文件和原稿页查询预览，只返回图像与分页信息，无输出页返回空对象。单页译稿与导出共用排版和背景合成，引用完整原稿；单页预览分页与整份连续导出可不同。服务只缓存当前详情的来源及译稿 PDF，翻页复用打印结果，来源或译稿变化失效，关闭详情或切换工程取消并释放。
- 全部保留时原样输出 asset，译文页数可变化。保存允许暂时没有输出页，整份文档预览和导出至少保留一页。计算失败终止导出，文件服务负责落盘。宿主边界归 [ARCHITECTURE](ARCHITECTURE.md)，工作区入口归 [AGENT_RUNTIME](AGENT_RUNTIME.md)。

项目数据 section 固定为：

```text
project, files, items, pdf, quality, prompts, proofreading
```

- `/api/session/project/manifest` 只返回项目身份、revision 索引和 counts，不预热大 section。
- 功能 query 返回其结果依赖的 `sectionRevisions`；只有基于已消费快照形成的用户写入或预演提交才以这些 revision 做乐观锁。任务启动和面向当前项目事实的 reset 不携带 revision，由运行或项目写 lease 后读取当前事实；`projectRevision` 只是所有 section revision 的最大值，不是独立全序或可写锁。
- `CacheManager` 是当前 session 的热读缓存根；query 只组合 cache、按需数据库读取和 shared 纯规则，不建立第二套项目事实。
- 文本源文件与需要重读原始 asset 的格式统一通过 shared 解码入口把 bytes 转成字符串，固定按 BOM、调用方声明编码、严格 UTF-8、传统编码探测的顺序裁决；无法确定或不支持的编码按文件解析失败处理。
- 文本内资源引用由 shared 纯规则统一识别 Base64 data URI、带 `://` scheme 的 URI 和带已知扩展名的无 scheme 路径；格式 reader 在拥有完整格式语义时立即决定槽位范围与格式规则状态，已生成 Item 的自动规则统一写为 `RULE_SKIPPED`，`EXCLUDED` 只表达用户手动排除。项目预过滤重新扫描通用文本内容，只有移除引用后各行均无正文时才跳过整个 Item；语言过滤使用独立状态。
- Markdown 文本统一由 Markdown V2 的 AST 块 reader / writer 处理：`.md` 生成 `file_type: MD_V2`、`text_type: MD` Item，`row` 是 Markdown 块起始物理行，块内 URI 与 Base64 保持原始文本并随普通块直接写回。
- 译文导出由 `TranslationFileExportService` 从当前项目数据库读取条目与 asset，统一编排 GUI 与 CLI 的格式写回和输出目录语义。PDF 在写文件前固定页面并校验内容，回执按原页计数，translated_pages 包含空译稿页，original_pages 包含待处理与确认保留页，不表示完成数量。
- GUI 与 CLI 导出共用开始、完成和失败处理。未知导出异常统一为 `translation.export_failed`，已有业务错误保留原码；界面兜底与导出失败日志复用同一文案，导出服务记录一次原始异常及其调用栈、原因链，Gateway 另保留请求诊断。格式写回依赖的原始 asset 缺失时必须报错，失败终止本次导出，已写出的产物可能保留；打开输出目录失败只记录附加动作错误。
- EPUB 的 `slot_per_line`、`block_text` 和历史无 AST 条目继续按原协议写回；`text_run` 绑定原始 DOM 片段，全部片段定位在修改节点前核验并解析。manifest href 在读取入口解码一次，ZIP 键和持久定位不重复解码。打开项目不重建条目；旧 ruby 迁移只转换节点与正文匹配的候选，保留 ID、行号及用户事实。
- “全部重置”在项目写 lease 内从工程保存的全部 asset 重建条目（PDF 清空页面译稿、核对与续做记录），分配新 ID 并重新预过滤；格式 reader 恢复源文件自带译文并据此重算完成进度，耗时和 token 累计清零。条目数允许变化，读取或解析失败时不提交部分结果；成功后经 `ProjectWriteStore` 原子替换并发布 items 全量失效。指定文件或失败条目的重置保留既有身份。
- 项目内质量规则条目统一通过 `QualityRule` 与 `normalize_quality_rule_entries` 收窄，并由真实执行器校验；运行期只要求每个 kind 内的 `entry_id` 非空且唯一，不校验身份格式。无项目身份的导入文件、预设、CLI 资源只能经显式创建入口取得新身份，外部文件和预设不持久化项目身份；入口不得另建字段、身份回退或正则容错。
- 质量规则的匹配语义集中在 `src/shared`：字面量执行 NFKC，`case_sensitive` 控制大小写折叠，正则遵循 JavaScript 原生语义。术语分别匹配 `src/name_src` 并检查对应译文字段，领域结果保存术语身份与字段归属。高亮、替换和包含关系按需计算字符坐标。替换与文本保护按字段内逐行执行，导入身份和包含关系共用相同匹配语义。
- `builtin/text_preserve/preset/*.json` 是内置文本保护规则的唯一内容来源；`base.json` 在所有模式下启用，其余预设按 `text_type` 提供智能规则，`custom` 叠加项目规则。
- 翻译与校对共用逐行准备结果：`prepared_text` 提供请求和保护段比较依据，`restoration_text` 保留译前替换前的形式。保护段分析绑定当前文本，供剥离、样例与校对比较复用。译前替换引入换行后，校对按组合正文的实际行重新分析，行数警告仍比较原稿与译文。首尾保护段参与正文替换和模型请求，遗漏由校对报告。空白行与完全保护行保留原文，全部保留的条目跳过请求。响应行数对应时恢复原始空白和保留行。
- 翻译规划以短引用计算 token 指标；work unit 将资源引用按输入顺序投影为 `lg-uri/<n>`，由基础规则保护并在译后按内存映射恢复。校对在自然语言判断前移除资源引用；投影和映射不进入 Item、项目存储或跨线程协议。
- 外文残留按目标语言允许的书写系统检查剥离保护片段后的译文，以完整 Unicode 字素簇保留附标；单个 Latin 字素或 2～4 个 ASCII 大写字母组成的片段豁免，其它残留继续报告。日／韩译中文的相似度警告同时要求过滤后仍有残留证据。校对 worker 与 cache identity 携带完整文本处理配置，增量评估沿用全量同步冻结的配置。
- 标点结构检查比较准备后的源文与最终译文，剥离保护片段及资源引用后按整条正文核验；允许同类形式转换，保留原文未闭合结构。分组比较不识别同组引号错配或符号相对正文的位置变化。条目警告、筛选与统计共用警告词表顺序。
- `FileCache` 向工作台和校对提供工程文件顺序，历史条目独有路径按首次出现顺序补在资产文件之后。校对列表、上下文与警告查询按文件顺序、行号或原稿页码、数值文本 ID 排列，列排序同值时沿用自然顺序。
- 校对读取器分别保存文本评估与页面事实，用带 `kind` 的行引用查询，在窗口响应边界生成展示字段。计算线程只返回文本 ID 和评估结果，正文由同次输入快照提供。`view_id` 标识稳定结果快照，字段更新保留成员与顺序，删除剪除成员，文件同步使旧视图失效。新查询重新筛选和排序，上下文与按 ID 读取保留当前视图。
- 文本与页面共用状态、文件和术语筛选及计数。页面没有文本质量评估记录，已翻译页进入 `NO_WARNING`，所有页面属于无术语缺失集合。默认筛选隐藏保留和省略页面，页面搜索只匹配译稿正文。结果计数只受文件范围影响，术语计数忽略自身条件。真实警告摘要只汇总成功文本的警告，无警告不保证内容正确。
- `CacheManager` 按变化分区更新基础缓存。文件更新使用资产、页面身份与内存文件元信息，文本全量更新同时刷新文件信息。完整热机及缓存世代变化用于工程生命周期与故障恢复。
- 校对文本评估依赖工程、缓存世代、`items` / `quality` / `proofreading` 修订和文本处理配置，文件与页面分别按 `files`、`pdf` 修订同步。评估等待期间重排文件可复用结果并同步最新顺序，文本依赖变化或同步撤销后的结果失效。响应修订绑定实际快照，热查询只比较身份，缓存未命中时才读取完整内容。
- `QualityRuleStatisticsCache` 是四类质量规则命中数、代表例句和字面包含父项的唯一后端统计缓存，供 GUI query 使用；缓存命中只读取缓存引用和轻量 revision，不复制 item、不重建文本组或计算内容签名。quality 变化同时失效统计与父项，item 变化只按受影响文本侧失效统计并保留父项；无法证明范围时失效全部统计。
- 质量规则统计按不同 item 去重计算 `hits`，同一 item 内多字段、多次或重叠命中只计一次；术语读取原文字段，其余规则按生产语义逐行读取原文或译文。worker 在同一遍命中扫描中保留最多两个确定性 `examples`，不保存完整候选集，并按 item 顺序输出。
- 质量规则结构分析只返回复用正式字面匹配语义的真实包含父项；完全等价和正则不形成父项，也不生成全局关系组或推断公共词根。
- 客户端只提交用户意图和必要的设置镜像；canonical items、翻译进度、prefilter 和重复组由后端计算。
- 重复身份由同一 `file_path`、完全相同的 `src`、翻译管线消费的可见 `name_src` 与相同 `text_type` 组成；预过滤与项目写入协调按该身份维护物化的 `DUPLICATED`，导出按同一身份复用已处理译文。重复组中的 `PROCESSED` 或 `ERROR` 条目承担已有代表，否则按行号和 item 身份稳定保留一个 `NONE` 代表；协调只改写 `NONE` 与 `DUPLICATED`，关闭重复过滤时恢复全部重复项。
- 快照派生写入在最终提交点完成 revision guard 与单 `.lg` 事务；当前事实 reset、任务 artifact 等写入不带预期 revision，但仍通过 `ProjectWriteStore` 更新事实和 section revision。
- settings-only alignment 只发布内部 committed event，不发布公开 project change；仅持久化任务 progress 的写入走 task snapshot 通道，不制造项目变更事件。
- 项目事实事务提交后才把类型化 committed event 交给唯一缓存 handler，缓存完成后再发布公开 change。后置缓存或公开事件同步失败不会回滚已提交事务，统一转换为带 `committed: true`、提交后 section revisions 和重新加载动作的 `data.committed_sync_failed`；调用方不得重试该写入。常规增量维护失败由 `CacheManager` 标记为可恢复，并在后续 query 前从数据库重建。
- HTTP `changes` 与 SSE 使用同一 canonical `ProjectChangeEvent`，消费者不得依赖两条通道的网络到达顺序。
- 公开事件绑定后端确认的 `projectPath`、`projectRevision`、`sectionRevisions` 与 `updatedSections`；payload mode 只允许 `canonical-delta`、`field-patch`、`section-invalidated`。
- 全量替换、排序或无法精确表达受影响行的写入使用 `section-invalidated`；只有能完整表达受影响行和删除 tombstone 的小范围变化才发布行级增量。
- Agent 磁盘工作区承载可修改的工作资产和显式 change 准备；`AgentWorkspaceService` 以工程身份、epoch 与语言守卫快照边界，以对象指纹校验写入目标，普通 section revision 漂移不阻塞对象级 apply。工作资产生命周期与恢复语义归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `ProjectWriteStore.apply_agent_workspace_changes` 是工作区唯一物理写入口：在 `BEGIN IMMEDIATE` 内读取当前目标、按对象 `fp` 重算 resolver，并将合法 item、PDF 页面、quality、prompt 尽可能一次提交。Item 显式变化与受影响重复组的被动变化形成同一实际变化集合，共同驱动写入、翻译统计、revision、cache 和 canonical delta；对象冲突形成逻辑部分成功，quality 每个变化 kind 只写一次并共享一次 aggregate revision，实际变化 section 才推进 revision。
- 工作区无实际 change 时不写数据库、不推进 revision、不发布事件。数据库失败回滚本次事务全部事实与 revision；提交后 cache / 公开事件只依据 actual applied sections，后置同步失败按已提交处理并返回 reload 语义。
- create / load / migration / 默认预设初始化与 CLI bootstrap 资源属于生命周期或初始化写入；若它们改变 query 可见事实，必须在同一事务更新对应 revision meta。

## 4. 任务、worker 与 LLM

- 批量引擎处理 Item。PDF 的格式识别、Agent 指引和 CLI 排除在文件与任务入口处理，具体 CLI 协议归 CLI.md。

- 工作台、校对页、CLI 与 Agent 共用 `BackendServices.batchTranslation`。`POST /api/batch-translation/start` 接收显式 `operation` 与 `scope`：`translate` 携带 `new | continue | reset` 模式和可选 `include_errors`，`retranslate` 只接收指定 item 范围。`stop` 与 `snapshot` 接收空对象。HTTP 与 `batch_translation.snapshot_changed` 共用 `{ batch_translation: BatchTranslationSnapshot }`，快照包含 `revision`、`status`、`source`、`request_in_flight_count`、工程累计 `progress` 与 `scope`，预约后包含 `operation`，目标准备后包含本轮 `run_progress`。可选 `config` 承载本次运行的非敏感配置摘要，本轮取消后携带 `stop_source`。`requested | running | stopping` 唯一决定活跃态。
- `BatchTranslationService` 收窄命令并确认 loaded 工程，在运行 lease 内准备单次执行上下文：普通入口按 translation 用途读取模型，Agent 入口采用调用方解析出的模型配置，设置与模型在交给 Runner 时隔离引用。`BatchTranslationRuntime` 在首次异步发布前建立 run、controller 和唯一 completion；standalone 原子取得运行 lease，Agent 内运行校验真实 lease 并单向连接工具取消信号。两种入口共享一个活动翻译 run。Runtime 在预约时按入口写入 `source: standalone | agent`，本轮终态保留，新预约覆盖，工程切换清空为 `null`；来源只属于内存运行态，预约发布失败随快照回滚。快照 `scope.kind` 保留本轮范围类型，指定范围的 `item_ids` 随成功提交的执行结果移除，同值结果也完成本次尝试，任一终态清空 ID。
- `BatchTranslationRunner` 消费 Service 提供的执行上下文，以类型化进度、质量规则、条目和提交数据消费 ProjectStore、Planner、Pipeline 与 worker。执行目的与范围分别决定目标资格和选中集合；目标准备校验目标存在性，在执行副本中重置状态。统一规划器保留工程顺序与完整前文，仅对实际目标计量和执行。Runner 从执行上下文投影 `config` 并登记到 Runtime；新运行预约和工程切换清空配置，终态保留，工程重开只恢复累计进度。
- 本轮 `run_progress` 由 Runtime 持有，目标总量在执行前冻结，成功提交后推进成功、最终失败与用量；已报告用量即使没有终态条目也经同一提交链累计，终态保留，工程切换清空。工程累计 `progress` 持久化在 `translation_extras`，行数在 ProjectWriteStore 的同一写事务中按真实前后状态更新；失败重试成功减少累计失败数，同值失败保持工程计数。Runner 只提供累计耗时与用量并从已提交 meta 读取权威计数。提交后同步失败保留已完成事实与原始诊断。
- Runner 等待规划、worker 和增量提交收束，保存最终进度并释放本轮数据库 lease 后返回独立结果；Runtime 冲刷请求压力、发布同一结果的终态、移除父监听并释放自己取得的 lease，最后结算 completion。完成、取消与执行失败分别为 `done`、`stopped`、`error`，`idle` 表示没有运行任务；已提交译文保留。首次取消在发出信号前记录 `stop_source: user | parent | shutdown`，重复停止返回未受理，新运行与工程切换清空来源。基础设施异常拒绝 completion；取消后的 `BatchTranslationCompletionError` 携带结果与原始 cause；dispose 等待同一完成链。
- 生命周期与已提交进度立即发布快照，请求压力按 500ms 合并且在终态前冲刷。请求压力只计已发出的模型请求。每次项目会话切换重置为空闲并推进 revision，迟到 run 和旧帧不能覆盖新工程。
- work-unit worker 负责提示词与响应处理，通过本次执行携带的父线程请求端口访问 LLM；线程与同进程模式共用该端口和原 work unit 的取消信号。worker 崩溃必须中止所属父线程请求，作为基础设施错误结束任务。
- `TranslationRequestScheduler` 是本轮唯一请求队列、并发额度与派发入口，同时检查速率和 Key 可用性。网络失败保持原请求回到队尾，重新选择可用 Key；收到响应后交给内容处理。`RequestRatePool` 跨任务保留同配置的速率时钟，Key、并发额度与请求队列属于单轮任务。
- 并发与 RPM 双零启用本轮探测，显式并发优先，仅 RPM 非零时并发取 RPM。降档版本在真实派发时记录，重派重新取值；旧版本不调整额度，但继续参与结果与 Key 恢复。默认 RPS 随额度变化，跨轮保留速率时钟并重新探测。
- `TranslationPipeline` 读取请求调度器的并发额度与密钥耗尽快照来供应 work unit，完成后优先补充内容重试；降档保留在途任务，真实网络派发立即受新额度约束。活动 work unit 包含预处理与响应处理，其数量与网络在途计数、线程池容量各自独立。
- 密钥首次失败暂停派发并等待在途请求结束。同波并发失败只计一次，成功清零。冷却后仅派发一个恢复请求，恢复机会耗尽则本轮禁用该密钥，其余密钥继续处理共享队列。全部暂时不可用时等待。响应内容错误进入内容重试。
- 全部密钥耗尽时，流水线停止领取普通及重试分块，待请求的活动分块收到 `keys_exhausted`，其余活动分块继续收尾，仅提交已完成条目和真实用量。未完成目标保留数据库原状态、译文和重试次数。任务返回 `status: error`、`reason: keys_exhausted`，结果与快照保留原因，新运行与工程切换清空。
- `429` 从响应接收时刻等待 `max(30 秒, min(服务端等待时间, 本轮请求超时设置))`。`Retry-After` 缺失、无效或过期时等待 30 秒。同波响应取最晚恢复时刻，同时等待在途请求结束，收束后不重新起算。其它请求故障在收束后冷却 30 ± 5 秒。
- `TranslationPlanner` 首次建立本轮源文指标，Runner 持有到任务完成；token 数按短引用投影后的 `o200k_base` 正文计算，特殊标记按普通文本处理，行数来自原文。内容重试按本轮条目和指标同步拆块，worker 返回值只决定待重试集合；最终提交消费 worker 写回快照。指标不进入 work-unit 载荷、计费统计或项目存储。
- Planner 独占跨任务计数 LRU，同轮缺失文本去重后交给 planning worker；每个线程独占 BPE 片段缓存并按需启动、跨规划复用。池依赖单 run 互斥，只受理一个计数请求；取消停止新批次派发，在完整条目之间响应，并等待全部活动批次终态后释放请求。线程异常使本次请求失败，后续请求按需重建已退出线程；显式同进程执行共用计数循环。
- 翻译 work-unit 以 item 为唯一请求、响应和提交单位：普通模型每个请求 item 使用一条 JSONL 记录（`id`、`text`，actor 模式再加 `actor`），`text` 可包含换行。`id` 在请求内从 0 按实际记录分配，与数据库 item ID 独立；响应按原值匹配，允许乱序。唯一匹配的非空译文独立提交，缺失、重复、未知或空白正文只影响对应 item；请求失败、零有效译文、部分有效和全部有效分别形成 error、error、warning 和 info 结果日志，结构变化的译文保留模型完整文本并由校对实时派生 `LINE_COUNT_MISMATCH` warning。SakuraLLM 每个 work-unit 只发送一个 item，并以完整纯文本承载译文；worker 内部才保留逐行准备与恢复事实。
- 普通翻译的增强段位于基础或自定义规则之后、输出约束之前，由本轮 `prompt_enhancement_enable` 控制，与模型原生思考独立；Agent 批量翻译共用，SakuraLLM 使用专用提示词并跳过分析分离。普通响应无论增强开关如何，只分离开头连续的 `<why>` 块，保留正文中的同名标签；未闭合块保留诊断、清空译文正文，交给既有无效响应处理。原生思考、规则分析与译文分别记录，只有译文进入解码。
- `resolve_prompt_template_language` 统一选择普通翻译模板：中文 UI 使用中文，其它 UI 语言使用英文。模板、源／目标语言占位符、输入与术语等模型说明及其日志回显均使用模板语言，名称与说明从共享词典解析；自定义规则正文由用户拥有。一般日志和错误继续按应用语言展示，Agent 交互消息的语言归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- 翻译 work unit 在 pre-pipeline 前从原始 source fields 计算术语覆盖，再以全局开关和非空 `dst` 裁出 Prompt 激活条目；PromptBuilder 只格式化已激活条目，不根据预处理或模型输入文本再次匹配。
- 批量翻译以外的重型计算通过 `ComputeWorkerClient` 提交无状态 compute task；worker 不读数据库、不写 `.lg`、不发布事件、不持有项目 cache。
- `src/backend/llm` 统一处理模型能力、请求准备、协议载荷和结果。模型管理、OneShot 与 Agent 共用能力结果，Pi 模型构造直接消费该结果。持久化 `Model` 保存用户配置，远端可用模型列表由供应商 REST API 提供。
- 能力目录优先精确匹配名称，变种 ID 在字母数字边界内取最长且唯一的标准模型 ID。容量取同名记录的最大上下文与输出规格。思考模板先匹配协议，再按原厂、聚合目录、托管平台的显式优先级选择。唯一未知来源可用，多个未知来源按能力缺失处理。缺少容量时使用 Agent 安全值，最终请求保留用户的真实模型 ID。
- `llm-overrides.ts` 保存模型与端点修正。同协议思考映射和兼容配置按字段合并，`null` 表示档位不受支持。OpenAI 两种协议回退时仅借用思考能力与档位，Azure Responses 与 Responses 共用兼容契约。Agent 运行容量规则归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- `llm-request.ts` 准备配置与生成选项，`llm-payload.ts` 合并最终载荷。请求头通过适配器选项发送，端点按精确主机名匹配，用户扩展头按大小写不敏感覆盖默认值。OneShot 的分块与重试共享 `run_id`，批量任务及每个密钥的模型测试各自独立。Agent 对话身份归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。
- OneShot 在适配器入口调用 `normalizeContext()`，Agent 由 `ModelRuntime` 归一化上下文。Anthropic 与 Google 合并用户扩展后保留结构化思考设置，Google 单次请求最终使用应用的取消信号。
- 产品思考档位按操作语义合并同效果别名，包括关闭思考；共享映射由 Pi adapter 转为供应商接口值。
- `LLMClient` 独立拥有 OneShot 的总时限、取消和请求终态，Pi 固定 `maxRetries: 0`：供应商请求失败归 `request_error`，长度截断和不支持的工具调用归 `response_error`，正常终止的正文原样交给消费方按任务协议校验，空正文因此属于零有效任务数据；成功 usage 归一为输入、思考与输出三个互斥口径并分别进入任务快照。
- `src/backend/network` 是普通后端与 Agent 工作区 HTTP 的共用传输所有者。工作区调用和代理通信归 [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)。`BackendResources` 在业务服务启动前把它安装为当前 Backend Runtime worker 或 CLI 进程的 `globalThis.fetch`，同时安装同版本的 Request、Response、Headers 和 FormData，关闭时一起恢复，避免 Electron 内置 Undici 与应用依赖混用。模型 adapter、模型列表和 Web Search 从该入口取用 transport。HTTP 入口按请求隔离状态码、接收时刻及重试时间，LLM 端口传递事实，调度器决定恢复策略。每次请求按当前 Electron session 代理规则选路，loopback 固定直连。解析失败、路由不受支持或代理失败都结束请求，不绕过代理静默直连，也不改写进程全局 dispatcher。
- OneShot 的 HTTP 状态由统一 transport 在请求异步上下文中采集，再附到 `LLMClient` 结果；该边界保留 SDK 压平错误后丢失的状态码，网络层不解释翻译语义。
- OpenAI Chat Completions 与 Responses 是显式独立的 `api_format`，不按 URL 或模型名自动探测，也不互相重试或降级；模型配置归一化时统一把失效思考档位调整为当前模型可用值并在配置写入口持久化，模型快照不会向消费方暴露失效档位，请求阶段只保留 `off` 兜底。两种协议的原生思考载荷与 Responses 连续性由 `pi-ai` 生成，项目只补协议生成字段、把 Responses 系统指令规范为 `developer`，并让显式 `extra_body` 最终覆盖。

## 5. 数据库与 `.lg` 存储

- `ProjectDatabase` 是 `.lg` workflow 的唯一入口；上层调用类型化读写方法，不持有 SQLite 连接，也不拼字符串操作协议。
- `transaction(projectPath, callback)` 只为该路径的连接建立事务；回调内的类型化方法仍显式接收路径，跨 `.lg` 写入不具备原子性。`create_project` 完成基础建库后在该路径事务内执行可选初始化回调；回调失败时关闭并移除新文件。
- `.lg` 使用 SQLite `FULL auto_vacuum` 回收完整空闲页；`ProjectDatabase` 遇到其它模式时在 schema/writeback migration 前尝试 `VACUUM`，物理整理未完成时保留现有模式并继续正常 workflow。
- 连接运行期使用 WAL；长任务通过 project lease 保留连接，普通 workflow 结束且无租约时统一 checkpoint 并关闭连接，不手动删除 `-wal` / `-shm`。
- `pdf_documents` 保存来源摘要，`pdf_pages` 以 `(file_path, page)` 保存页面 JSON，原始字节归 assets。读取按原页序组合，写入仅更新目标页。导入事务核对资产 SHA-256，拒绝解析后变化的来源。文字、字体与坐标提取作为可再生工作材料，不进入存储。
- asset 存在 `assets` 表，以 Zstd blob 落库；压缩格式集中在 `src/shared/utils/zstd-tool.ts`，数据库读取向上返回解压后的 bytes。
- 新建与既有工程共用打开迁移入口：按实际表和列补齐结构，再执行业务写回迁移。执行成功后在同一事务内记录 `applied_writeback_migrations`，完成记录由迁移执行器唯一写入。迁移清单归 registry。
- 启动期迁移先处理 userdata 与历史安装布局，再读取设置；版本内置资产始终只读。project-open 文件迁移在事务执行时按目标文件合并当前可见 Item，使多个格式迁移可以串行组合；历史 `file_type: MD` 在缓存热机和 session loaded 前一次性转为 `MD_V2`。
- 历史工程中已停用能力的表、规则与 meta 保留物理原值，当前 manifest、section、提示词与运行快照只投影现行事实。翻译提示词的路径和存储键由 `TRANSLATION_PROMPT` 固定描述对象拥有。
