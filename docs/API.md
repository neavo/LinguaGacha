# LinguaGacha API 文档

## 一句话总览
Electron 运行时公开 `/api/*` 入口由 `frontend/src/main/api/` 的 TS Gateway 持有；项目轻生命周期、项目同步 mutation、reset preview、bootstrap 运行态编码、`project.patch` 补全与 section revision 收口在 `frontend/src/main/project/`，文件解析 / 写回收口在 `frontend/src/main/file/`，应用设置、模型、质量规则 / 提示词、校对同步保存与路径规则收口在 `frontend/src/main/service/`，Python Core 内部桥落在 `frontend/src/main/core/`。Python Core 保留内部 HTTP / SSE 服务、事件、任务和 Python 客户端兼容契约。本文只保留调用方必须知道的稳定契约：谁在消费它、路由族如何分组、响应壳和错误码如何解释、bootstrap 与 `project.patch` 如何驱动运行态，以及哪些写接口属于同步 mutation、哪些属于异步任务。

## 协议消费者与边界

| 消费者 | 接入方式 | 边界约束 |
| --- | --- | --- |
| Electron 渲染层 | `frontend/src/renderer/app/desktop/desktop-api.ts` -> TS Gateway baseUrl | 页面不得绕过它直连 `fetch` / `EventSource` 到随意路径 |
| 渲染层项目运行态 | `/api/project/bootstrap/stream` + `/api/events/stream` | `ProjectStore` 依赖 bootstrap + `project.patch` 建立最小事实源 |
| Electron 独立日志窗口 | `/api/logs/stream` | 只消费 TS `LogManager` 诊断日志事件，不进入项目运行态 |
| Python 侧对象化客户端 | `api/Contract/ApiPaths.py` + `api/Client/*.py` + `api/Models/*.py` | 路径常量、请求包装与对象化归客户端契约层，不从 Python server route 实现取常量 |

内部 Database Service 与 Python Core 内部端口都不属于公开 `api/` 协议：它们由 Electron main 启动，只供 TS Gateway 或 Python Core 通过 token 调用。renderer、Python 客户端和外部调试脚本不应依赖 `/internal/database/*`、`/internal/runtime/*` 或 Python Core 内部监听地址。

协议层真实分工：
- `frontend/src/main/api/` 负责 Electron 公开 Gateway、CORS、`/api/health`、路由编排和未迁移路由代理；TS 项目域实现收口在 `frontend/src/main/project/`，其它已迁移业务实现与路径解析收口在 `frontend/src/main/service/`，Core 内部桥落在 `frontend/src/main/core/`。
- `frontend/src/main/project/` 负责项目轻生命周期、项目同步 mutation、reset preview、公开 bootstrap 首包、`project.patch` 运行态补全与 section revision 编码；`load/create-commit/open-preview` 也是 TS 项目域公开实现，其中 runtime encoder 和 patch adapter 只做按需读取和请求内快照，不持有长期项目缓存。
- `frontend/src/main/file/` 负责公开文件解析 / 写回：`create-preview`、`workbench/parse-file`、translation reset all 的 asset 重解析、`tasks/export-translation` 和 `export-converted-translation` 的写回都走 TS 文件域。
- `api/Server/` 负责 Python Core 内部 HTTP 服务、路由注册与统一错误映射。
- `api/Application/` 负责把 Core 状态整理成稳定业务语义。
- `api/Contract/` 负责 Python 侧 HTTP 响应壳、SSE 线格式和 Python 客户端对象化载荷。
- `api/Bridge/` 负责公开 topic 与 `project.patch`。
- `api/Contract/ApiPaths.py`、`api/Models/` 与 `api/Client/` 负责 Python 侧对象化契约。

## 路由族与路径前缀

| 路由族 | 代表路径 | 用途 |
| --- | --- | --- |
| 探活 | `/api/health` | Electron main 与渲染层启动前探活 |
| 生命周期 | `/api/lifecycle/shutdown` | Electron main 请求 Core 优雅关闭的内部入口 |
| 长期事件流 | `/api/events/stream` | 公开 SSE topic 与 `project.patch` |
| 诊断日志流 | `/api/logs/stream` | 独立日志窗口订阅 TS `LogManager` 纯文本日志 |
| bootstrap 首包 | `/api/project/bootstrap/stream` | 一次性阶段化项目首包 |
| 项目与同步 mutation | `/api/project/*` | 工程、工作台、校对、reset、导入术语等 |
| 项目派生工具 | `/api/project/export-converted-translation` | 为 TS 侧工具页提供转换结果文件写出；内置文本保护预设读取复用质量规则预设 IO |
| 后台任务 | `/api/tasks/*` | 翻译、分析与重翻任务启动、停止、快照 |
| 模型页 | `/api/models/*` | TS Gateway 承载快照、更新、激活、增删、重排；`list-available` 与 `test` 代理 Python Core |
| 质量规则与提示词 | `/api/quality/rules/*`、`/api/quality/prompts/*` | TS Gateway 承载页面 CRUD、导入导出与预设 IO |
| 应用设置 | `/api/settings/*` | TS Gateway 承载应用设置快照、更新、最近项目维护 |

路径不变量：
- 主业务协议统一落在 `/api/` 前缀，不扩展新的并行根前缀。
- `/internal/database/*` 是 Electron main 进程内 database server 的受保护内部路由；`/internal/runtime/project-state` 与 `/internal/runtime/sync` 是 TS Gateway 调 Python Core 的受保护运行时桥。文件解析 / 写回不再占用 `/internal/runtime/*`，公开文件能力统一由 TS Gateway 的 `frontend/src/main/file/` 执行。
- 公开 `GET` 稳定只有 `/api/health`、`/api/events/stream`、`/api/logs/stream`、`/api/project/bootstrap/stream` 四类；其余公开接口默认走 `POST + JSON body`。
- `/api/lifecycle/shutdown` 是内部生命周期接口，只供 Electron main 调用；它要求 `X-LinguaGacha-Core-Token` 与当前 Core API token 一致。
- `OPTIONS` 由服务器统一回 `204`，CORS 统一开放到 `Origin * / Methods GET,POST,OPTIONS / Headers Content-Type`。

`/api/health` 由 TS Gateway 响应，成功响应固定包含 `status`、`service` 与纯数值 `version`；当 Gateway 由 Electron main 启动时，响应 `data` 额外包含 Gateway 的 `instanceToken`，用于避免误连旧进程。

## HTTP 响应壳

成功响应固定为：

```json
{
  "ok": true,
  "data": {}
}
```

失败响应固定为：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "..."
  }
}
```

### 错误码边界

| `error.code` | 触发条件 | 维护含义 |
| --- | --- | --- |
| `not_found` | 路由不存在，或内部抛出 `FileNotFoundError` | 只能当作“资源或路径不存在”级别错误 |
| `invalid_request` | 内部抛出 `ValueError` | 大部分业务校验失败会折叠到这里 |
| `internal_error` | 其他未捕获异常 | 不能用来区分业务分支 |

需要记住：
- 当前没有稳定的业务错误码体系；revision 冲突、工程未加载、任务忙碌等大多仍表现为 `invalid_request + message`。
- 调用方不要依赖 `error.code` 去穷举所有业务失败分支。

## SSE、bootstrap 与 patch 规则

```mermaid
flowchart TD
    A["/api/project/bootstrap/stream"] --> B["stage_started / stage_payload / stage_completed / completed"]
    B --> C["ProjectStore.applyBootstrapStage()"]
    D["/api/events/stream"] --> E["task.status_changed / task.progress_changed / settings.changed / project.patch"]
    E --> F["DesktopRuntimeContext"]
    F --> G["ProjectStore.applyProjectPatch() 或派生页面信号"]
```

### 普通事件流
- `/api/events/stream` 由 TS Gateway 连接 Python Core 内部事件流；普通 SSE frame 原样透传，只对 `event: project.patch` 的 `data` 做受控适配。
- 线格式只包含 `event:` 与 `data:`，没有额外 `event_id`、`timestamp` 或 `topic` 回显。
- 空闲时服务端发送 `: keepalive`。
- Python Core 只发任务事件和最小项目变更语义；item / analysis / proofreading 运行态块和 section revision 由 TS Gateway 从 database workflow 补全。

### 诊断日志流
- `/api/logs/stream` 由 TS Gateway 直接提供，独立于 `/api/events/stream`，只推送日志窗口需要的诊断日志，不混入 `ProjectStore` 运行态。
- 连接建立后先回放当前进程内 TS `LogManager` ring buffer，再持续推送新增日志；持久排障历史以 `DATA_ROOT/log/app.yyyymmdd.log` 为准。
- SSE 事件名固定为 `log.appended`，`data` 是扁平 `LogEvent`：`id`、`sequence`、`created_at`、`level`、`message`。
- `level` 只使用 `debug / info / warning / error / fatal`；`message` 永远是纯文本，多行详情靠换行、缩进和 ASCII 标签表达。
- Python `LogManager` 是兼容提交层，通过 `POST /api/logs/append` 向 TS Gateway 提交结构化日志；旧调用参数 `console=False` 继续表示不进入控制台和日志窗口，只保留文件目标。

### bootstrap 首包

`/api/project/bootstrap/stream` 由 TS Gateway 直接响应，是一次性阶段化首包，不是长期订阅流。TS 运行态编码器直接读取 Electron main Database Service 构建 `project / files / items / quality / prompts / analysis / proofreading` block，并通过 Python Core 受控 JSON 调用读取 `task` 快照；稳定事件型别如下：

| `event:` | 字段 | 用途 |
| --- | --- | --- |
| `stage_started` | `stage`、`message` | 某个阶段开始 |
| `stage_payload` | `stage`、`payload` | 当前阶段有效载荷 |
| `stage_completed` | `stage` | 当前阶段结束 |
| `completed` | `projectRevision`、`sectionRevisions` | 首包整体完成 |

稳定 stage 顺序固定为：
1. `project`
2. `files`
3. `items`
4. `quality`
5. `prompts`
6. `analysis`
7. `proofreading`
8. `task`

### `RowBlock` 的稳定边界

只有两个 stage 依赖 `RowBlock(fields, rows)` 作为稳定协议：

| stage | 字段顺序 | 渲染层落地键 |
| --- | --- | --- |
| `files` | `rel_path`、`file_type`、`sort_index` | `files[rel_path]` |
| `items` | `item_id`、`file_path`、`row_number`、`src`、`dst`、`name_src`、`name_dst`、`status`、`text_type`、`retry_count` | `items[item_id]` |

块类型由 stage 决定，不额外携带 `schema` 标签。

### 公开 topic 与 `project.patch`

| topic | 稳定事实 |
| --- | --- |
| `project.changed` | 只广播工程是否已加载与当前路径，不携带整页运行态 |
| `task.progress_changed` | 只发送当前事件中真实出现的字段，不补齐缺失统计 |
| `task.status_changed` | `DONE / ERROR / IDLE` 是桥接层对内部终态的公开解释 |
| `settings.changed` | 是设置广播，不等于页面必须整页刷新 |
| `project.patch` | Python 任务事件触发后由 TS Gateway 补全的运行态补丁事件 |

`project.patch` 的稳定语义：
- 对 renderer 至少包含 `source`、`updatedSections`、`patch`、`projectRevision` 与 `sectionRevisions`；Python 内部事件可只携带 item id、分析变更或任务快照等最小语义。
- 调用方应把它当成可直接合并进 `ProjectStore` 的运行态补丁，而不是“请刷新页面”的提示。
- 异步任务终态、重翻提交，以及后端显式发出的 `PROJECT_RUNTIME_PATCH` 都可能产生它；完整旧载荷在迁移窗口内可透传，但最终运行态事实仍以 TS 补全结果为准。

## 同步 mutation 与异步任务的区别

| 类型 | 代表接口 | 运行态推进方式 |
| --- | --- | --- |
| 同步 mutation | 工作台 `add-file / reset-file / delete-file / reorder-files`，项目 `settings-alignment/apply`、`translation/reset`、`analysis/reset`、`analysis/import-glossary`，质量规则 `rules/save-entries / rules/update-meta`，提示词 `prompts/save`，校对 `save-item / save-all / replace-all` | 前端先本地 patch，再由服务端持久化并回 `ProjectMutationAck { accepted, projectRevision, sectionRevisions }` |
| 只读预演 | `create-preview`、`open-preview`、`translation/reset-preview`、`analysis/reset-preview`、`workbench/parse-file`、`prompts/import` | 返回预演结果，不改运行态事实 |
| 异步任务 | `tasks/*`，含 `/api/tasks/start-retranslate` | 依赖任务事件与必要的 `project.patch` 推进运行态 |

翻译任务补充：
- 翻译任务完成只保存项目事实，不自动写出译文文件。
- 生成译文文件由前端确认后显式调用 `/api/tasks/export-translation`，该接口仍复用现有 `POST + JSON body` 形状。

重翻任务补充：
- 重翻只通过 `/api/tasks/start-retranslate` 启动，不再挂在 `/api/project/proofreading/*` 同步 mutation 族下。
- 请求体稳定包含 `item_ids` 与 `expected_section_revisions`；其中 `expected_section_revisions.items` 校验 items section，`expected_section_revisions.proofreading` 校验校对视图 revision。
- 响应体是任务回执：`{ accepted: true, task }`。`task.task_type` 为 `retranslate`，进行中条目由 `task.retranslating_item_ids` 表达。
- 每批提交会发 `project.patch` 推进运行态，补丁至少携带 `merge_items` 与 `replace_task`，并在可用时同步 `replace_proofreading` 与 section revision。

项目派生工具补充：
- 简繁转换页在 TS 侧完成 OpenCC 转换，只把已转换的 `item_id / dst / name_dst` 载荷交给 `/api/project/export-converted-translation` 写出文件；该接口不写回 `.lg` 项目运行态，也不发 `project.patch`。
- 简繁转换页按 `text_type` 读取内置文本保护规则时复用 `/api/quality/rules/presets/read`，请求 `preset_dir_name: "text_preserve"` 与 `virtual_id: "builtin:{lower_text_type}.json"`，页面只消费返回 `entries[].src`。
- 项目轻生命周期中的 `/api/project/snapshot`、`/api/project/load`、`/api/project/create-commit`、`/api/project/open-preview`、`/api/project/unload`、`/api/project/preview`、`/api/project/source-files` 由 TS Gateway 的 `frontend/src/main/project/project-lifecycle-service.ts` 直处理；`create-preview` 由 `frontend/src/main/file/file-preview-service.ts` 解析源文件草稿。`load` 先由 TS 完成文件校验、`updated_at` 写入和打开期兼容迁移，再通过 `/internal/runtime/sync` 的 `project_load` 同步 Python Engine 读侧；`create-commit` 由 TS database workflow 创建 `.lg`、初始化默认预设、写入 asset/items/meta 后复用同一加载流程；`open-preview` 是只读设置对齐预演；`unload` 通过 `project_unload` 触发 Python `DataManager.unload_project()` 后再清空 TS 会话状态并释放 TS database 缓存。
- P2 项目同步 mutation 由 TS Gateway 的 `frontend/src/main/project/project-sync-mutation-service.ts` 直接写 `.lg`，reset preview 由 `frontend/src/main/project/project-reset-preview-service.ts` 直处理，校对 `save-item / save-all / replace-all` 由 `frontend/src/main/service/proofreading-service.ts` 直接写 `.lg`；写入后都通过 `/internal/runtime/sync` 让 Python Core 清任务读侧缓存。translation reset preview 的 all 模式直接用 TS 文件域解析 asset。translation / analysis reset 仍按 `Engine` 忙碌态拒绝同步写入，工作台文件写 mutation 通过内部 runtime bridge 复用 Python Core 文件操作锁；`workbench/parse-file`、转换导出和 `tasks/export-translation` 的文件能力由 TS 直处理，其它未迁移 `tasks/*` 仍代理 Python Core。

额外约束：
- `tasks/translate-single` 只给页面派生工具低频调用，Python Core 创建临时 `Item` 并复用引擎单条翻译入口；姓名字段解析、格式兜底与导入术语表合并仍由渲染层完成。
- `reorder-files` 的 `ordered_rel_paths` 必须完整覆盖当前文件集合。
- 工作台文件协议的路径语义固定为动作路径表达业务动作、数组字段表达数量：`parse-file` 接收 `source_paths` 并返回 `files[]`，`add-file` 接收 `files[]`，`delete-file` 与 `reset-file` 接收 `rel_paths[]`。
- `source-files`、`create-preview`、`create-commit` 的新建工程链路统一接收批量 `source_paths`；选择单个文件或文件夹时也按单元素数组传入。
- `create-preview` 只解析源路径草稿，并在 `draft.files[]` 为每个文件回填 `source_path`；`create-commit` 接收前端预过滤后的 items、`translation_extras`、`prefilter_config` 与项目设置镜像，一次性落盘并加载，落盘资产优先使用草稿文件记录里的 `source_path`。
- `open-preview` 在工程未进入 loaded 前读取项目设置镜像；仅 `target_language` 不一致时返回 `settings_only`，`source_language`、`mtool_optimizer_enable` 或 `skip_duplicate_source_text_enable` 不一致 / 缺失时返回完整草稿。
- `settings-alignment/apply` 是项目设置镜像与前端预过滤结果的唯一写入口：`settings_only` 只写 `source_language / target_language / mtool_optimizer_enable / skip_duplicate_source_text_enable`，`prefiltered_items` 同事务写 items、`translation_extras`、`prefilter_config` 并清空分析事实。
- `settings-alignment/apply` 可带 `path` 在未 loaded 的既有 `.lg` 上直接写入；显式 `path` 不存在时拒绝写入，不创建新库。
- `translation/reset`、`analysis/reset` 会持久化 TS 侧 planner 生成的最终条目或分析载荷；它们属于同步 mutation，不走后台任务生命周期。
- 同步 mutation 的状态载荷边界固定为：条目翻译事实随 `items.status` 更新，任务进度镜像随 `translation_extras` / `analysis_extras` 与 `task` 运行态更新，工程忙碌与终态由任务事件表达。
- `quality/rules/save-entries`、`quality/rules/update-meta` 与 `quality/prompts/save` 会回 `ProjectMutationAck`，页面需要用它们对齐 `quality` 或 `prompts` section revision。
- `analysis/import-glossary` 会分别校验运行态 section revision 与 glossary 自身 revision。
- `tasks/snapshot` 是按需快照，不是订阅入口。
- `settings/update` 由 TS Gateway 写 `DATA_ROOT/userdata/config.json`，只处理设置白名单字段；应用语言只支持 `ZH` / `EN`，写入后通过内部 runtime bridge 让 Python Core 刷新 `Localizer` 并发 `settings.changed`。
- `models/update` 由 TS Gateway 写同一份 `config.json`，只接受模型 patch 白名单字段；`models/reorder` 只能重排单一模型分组，`ordered_model_ids` 必须完整匹配该分组；`list-available` 与 `test` 仍代理 Python Core 并读取最新配置。

## Python 客户端边界

| 关注点 | 当前规则 |
| --- | --- |
| `ApiClient` | 默认只取响应体中的 `data`，不会校验 `ok`、保留 `error` 或主动抛出结构化业务异常 |
| 对象化覆盖 | `SettingsApiClient`、`ProjectApiClient`、`ProofreadingApiClient` 主路径以对象化结果为主；新建工程链路由渲染层通过 `desktop-api.ts` 编排 |
| 混合返回 | `TaskApiClient.export_translation()`、`ModelApiClient.test_model()`、`WorkbenchApiClient.parse_file()` 仍可能返回原始结构，其中工作台解析结果固定包在 `files[]` 内 |

这意味着：
- Python 客户端擅长做请求包装与 DTO 化，不承担 `ProjectStore` 风格的长期状态同步层。
- 若要扩展稳定 DTO 边界，改动通常要同时落在 `api/Models/*` 与对应 `api/Client/*`。

## 什么时候必须更新本文

- 路由前缀、路由分组或监听地址规则变化
- HTTP 响应壳或错误映射口径变化
- bootstrap stage、`RowBlock` 字段顺序、事件型别变化
- 公开 topic 或 `project.patch` 语义变化
- `ProjectMutationAck` 的稳定字段变化
- Python 客户端对象化覆盖边界变化
