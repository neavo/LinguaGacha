# LinguaGacha 架构地图

本文件只回答系统如何分层、跨层边界在哪里、未来任务应该先读哪里。协议字段、状态写入口、前端消费细节和验证矩阵分别归入对应专题文档。

## 1. 阅读路由

| 任务判断 | 先读 | 再读 |
| --- | --- | --- |
| 改系统分层、跨进程链路、模块归属 | 本文 | [`docs/BACKEND.md`](BACKEND.md) 或 [`docs/FRONTEND.md`](FRONTEND.md) |
| 改 Electron main / preload / renderer 共享的桌面宿主契约 | 本文 | [`docs/FRONTEND.md`](FRONTEND.md) |
| 改跨 main / renderer / worker 的基础值域、纯算法、normalize 或派生判断 | 本文 | [`docs/BACKEND.md`](BACKEND.md)、[`docs/FRONTEND.md`](FRONTEND.md) |
| 改 HTTP / SSE / 项目读取 / mutation / 错误码 | [`docs/BACKEND.md`](BACKEND.md) | 相关 service 与测试 |
| 改数据库、`.lg` 存储、迁移、任务运行态写入口 | [`docs/BACKEND.md`](BACKEND.md) | `src/main/database/`、`src/main/project/`、`src/main/engine/` |
| 改 Electron preload、renderer、`ProjectStore`、导航、页面状态 | [`docs/FRONTEND.md`](FRONTEND.md) | 相关页面和组件测试 |
| 判断要跑哪些检查、是否同步文档 | [`docs/WORKFLOW.md`](WORKFLOW.md) | 本文与对应专题文档 |

## 2. 运行时分层

```mermaid
flowchart LR
  N["src/base<br/>实体和值对象"] --> D
  N --> J
  N --> S["src/shared<br/>跨运行时共享规则"]
  S --> D
  S --> J
  X["src/desktop<br/>桌面宿主契约"] --> A
  X --> I
  X --> J
  A["Electron main<br/>窗口与生命周期"] --> B["CoreLifecycleManager<br/>端口、日志、数据库、Gateway"]
  B --> C["ApiGatewayServer<br/>本机 HTTP / SSE 边界"]
  C --> D["Project / TaskEngine / Service 领域服务"]
  D --> E["ProjectDatabase workflow<br/>SQL、事务、.lg asset"]
  D --> F["engine<br/>protocol/runtime/core/definitions/store"]
  F --> G["engine/worker<br/>WorkerPool / runner"]
  G --> H["request policy / official SDK transport<br/>提示词与响应处理"]
  F --> M["CoreEventHub / events"]
  I["preload: window.desktopApp"] --> J["renderer desktop-api.ts"]
  J --> C
  J --> K["DesktopRuntimeProvider + ProjectStore / TaskRuntimeStore"]
  K --> L["页面、组件、项目页缓存"]
```

- Electron main 是桌面宿主和 Core 的同一进程；当前运行态没有独立 backend 子进程或内部 HTTP 回环服务。
- `src/base` 只承载跨层数据实体和值对象的序列化、反序列化、合法值集合和贴身派生判断；不能反向依赖 main、renderer 或 Electron 宿主边界。
- `src/shared` 承载 main、renderer、worker 和测试复用的跨运行时共享规则、协议词表与纯工具，包括 task、quality、language、log、i18n、文本工具、fixer、prefilter、JSON 和压缩能力；Electron 桌面宿主契约不放在这里。
- `src/desktop` 承载 Electron main / preload / renderer 共同遵守的桌面宿主契约，包括 `window.desktopApp`、IPC channel 与载荷、标题栏壳层规则、Core API 地址注入和外链策略。
- `CoreLifecycleManager` 按 `LogManager -> ProjectDatabase -> ApiGatewayServer` 启动，退出时逆序关闭，避免 Gateway 仍持有数据库或日志句柄。
- `ApiGatewayServer` 只监听 `127.0.0.1`，是 renderer 可见的唯一 Core API 边界。
- `ProjectDatabase` 是 `.lg` 物理读写和 SQLite 句柄缓存的唯一入口；上层只发送 database operation，不直接持有 SQL 连接。
- `src/main/engine` 是任务域主控包：`command` 受理统一 `/api/tasks/start|stop|snapshot`，`protocol` 持有任务词表与跨 worker 协议，`runtime` 持有公开运行态和快照，`core` 编排任务，`definitions` 承接任务差异，`store` 通过 artifact 写入项目任务事实。
- `TaskEngine` 通过 `ProjectTaskStore` 取项目事实，通过 `ModelKeyLeasePool`、`WorkerExecutor` / `WorkerPool` 执行统一 `WorkUnit`；任务运行态只经 `TaskRuntimePublisher` 写入 `TaskRuntimeState` 并广播完整 `task.snapshot_changed`。
- renderer 只通过 preload 暴露的 `window.desktopApp` 获得宿主能力和 Core API base URL，再由 `desktop-api.ts` 发起 HTTP / SSE。

## 3. 主链路

### 启动链路

```mermaid
sequenceDiagram
  participant Main as Electron main
  participant Life as CoreLifecycleManager
  participant DB as ProjectDatabase
  participant API as ApiGatewayServer
  participant UI as Renderer

  Main->>Life: app.whenReady()
  Life->>Life: 分配本机端口与日志目录
  Life->>DB: 初始化数据库 workflow
  Life->>API: 注入 database / logManager / appRoot
  API-->>Life: baseUrl
  Main->>UI: 创建窗口并向 preload 注入 baseUrl
  UI->>API: /api/health 探测
```

### 项目运行态链路

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant API as API Gateway
  participant Proj as ProjectRuntimeProjectionService
  participant Hub as CoreEventHub
  participant Store as ProjectStore
  participant Task as TaskRuntimeStore

  UI->>API: /api/project/manifest
  API->>Proj: 构建项目数据索引与 section revision
  UI->>API: /api/project/read-sections
  Proj-->>UI: project / files / items / quality / prompts / analysis / proofreading
  UI->>Store: exact 合并项目数据 section
  UI->>API: /api/events/stream
  Hub-->>UI: project.data_changed / task.snapshot_changed / settings.*
  UI->>Store: 应用 canonical delta 或按需补读 section
  UI->>Task: 合并 task snapshot / task event
```

- `/api/project/manifest` 与 `/api/project/read-sections` 是项目数据初始化主链路；运行态不再保留 full bootstrap stream。
- `/api/events/stream` 是运行期增量事件主链路；项目数据通过 `project.data_changed` 更新，任务运行态通过 `task.snapshot_changed` 更新，页面初始化或项目切换时可按需读取 `/api/tasks/snapshot`。
- 同步 mutation 的 HTTP ack 只用于 revision 对齐；页面最终事实仍以项目读取接口、`project.data_changed`、任务事件和明确的本地乐观 change 进入各自 store。

## 4. 模块关系边界

| 层 | 固定职责 | 不能承接 |
| --- | --- | --- |
| `src/base/` | 数据实体和值对象的 JSON 边界、合法值集合和贴身派生判断 | HTTP 路由、数据库 workflow、页面状态、文件格式算法、跨运行时通用工具 |
| `src/shared/` | 跨运行时业务共享规则、协议词表和纯工具：task、quality、language、log、i18n、文本工具、fixer、prefilter、JSON、压缩能力 | HTTP 路由、数据库 workflow、页面状态、实体持久化语义、Electron 宿主桥接 |
| `src/desktop/` | Electron main / preload / renderer 的桌面宿主契约：桥接 API、IPC、标题栏壳层、Core API 地址注入、外链策略 | Core 业务实现、数据库 workflow、renderer 页面状态 |
| `src/main/lifecycle/` | Core 启停顺序、端口分配、日志和 Gateway 生命周期 | 业务路由、数据库 schema、renderer 状态 |
| `src/main/api/` | 公开 HTTP / SSE 路由、响应壳、CORS、错误映射 | 直接 SQL、页面缓存、文件格式实现 |
| `src/main/project/` | 项目会话、项目数据投影、项目数据变更事件、同步 mutation | Electron preload、页面局部状态 |
| `src/main/engine/{command,protocol,runtime,core,definitions,store}` | 任务命令、协议词表、运行态、快照、编排、任务差异解释、artifact 提交和项目任务事实读写 | worker 内提示词、LLM 请求、响应清洗解码 |
| `src/main/engine/worker/` | work unit 执行、提示词构建、request policy、official SDK direct transport、ProviderClientPool、响应清洗解码 | 数据库写入、全局任务状态、任务进度提交、任务级 Key 轮换 |
| `src/main/events/` | Core 公开运行期事件总线与 SSE 连接管理 | 任务编排、项目变更事件适配、领域状态规则 |
| `src/main/database/` | SQL、事务、`.lg` asset 压缩读写、database operation | HTTP 协议和页面 DTO |
| `src/preload/` | 窄宿主桥接、原生对话框和 Core base URL 暴露 | Core 业务实现、Node 能力泛开放 |
| `src/renderer/app/` | 桌面运行时、导航、shell、页面 runtime provider | 后端协议权威或数据库规则 |
| `src/renderer/pages/` | 页面交互和本地派生状态 | 共享项目事实的最终写入口 |

## 5. 更新触发条件

- 新增或重排运行时层、跨进程通信方式、桌面宿主契约层、Core 生命周期资源，必须更新本文。
- 新增跨 main / renderer / worker 共享规则、协议词表、合法值集合、基础派生判断或纯工具，必须先判断归属 `src/base` 还是 `src/shared`，并在分层关系变化时更新本文。
- 改公开 API、SSE、状态写入口、数据库存储、任务事件语义，更新 [`docs/BACKEND.md`](BACKEND.md)，本文只在链路或层级改变时同步。
- 改 preload、`ProjectStore`、导航、页面运行态消费方式，更新 [`docs/FRONTEND.md`](FRONTEND.md)，本文只保留分层关系。
- 改验证命令、任务起手式或文档同步要求，更新 [`docs/WORKFLOW.md`](WORKFLOW.md)。
