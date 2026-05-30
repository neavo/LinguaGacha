# LinguaGacha 架构边界

本文只记录跨层维护会误判的稳定事实，命令、协议、前端运行态与验证流程分别进入各自文档。产品语义与设计权威不在 `docs/` 五份长期文档内吸收。

## 1. 权威归宿

| 问题 | 唯一归宿 |
| --- | --- |
| 系统分层、运行时主链路、跨层边界 | 本文 |
| CLI 入口、命令、临时工程、资源、输出、平台启动器 | [`CLI.md`](CLI.md) |
| 后端 API / SSE、状态拥有者、任务、数据库、`.lg` 存储 | [`BACKEND.md`](BACKEND.md) |
| Electron / preload / renderer、共享状态、页面 query、导航、样式消费 | [`FRONTEND.md`](FRONTEND.md) |
| 阅读路径、验证矩阵、文档同步和交付自检 | [`WORKFLOW.md`](WORKFLOW.md) |

同一规则只能有一个权威归宿，其它文档只保留短引用。

## 2. 运行时主边界

- `src/index.ts` 是唯一产品入口，只按显式 `--cli` 分发 GUI 或 CLI，入口层只解析应用根、桌面 bundle 根和 `BackendWorkerExecution`，不持有业务服务、命令语义或窗口状态。
- GUI 与后端能力层同在 Electron 主进程，当前没有独立 backend 子进程，也没有 database HTTP 服务。
- GUI 使用 `BackendBootstrap(exposeApiGateway=true)` 暴露本机 `/api/*` 与 SSE，CLI 使用 `BackendBootstrap(exposeApiGateway=false)` 直接消费同一 `BackendServices` 与同进程 `ApiStreamHub`，不启动 Gateway。
- 发布态后端 worker 执行入口由产品入口构造为 `worker_threads`，`in_process` 只允许测试或源码运行显式选择，不作为 worker 失败回退。
- `BackendServices` 是 Gateway 与 CLI job 共用的组合根，数据库、cache、worker client、stream hub、内部事件总线、任务引擎和领域服务都只在组合根内装配。
- `src/domain` 只承载跨层实体、值对象、合法值集合和贴身判断规则，不反向依赖 backend、frontend 或 Electron。
- `src/shared` 只承载跨运行时纯规则、协议词表、reader 与工具，不得依赖 React、DOM、Electron、Node FS、SQLite、服务单例或可变全局状态。
- `src/native` 收口真实磁盘 IO、路径身份和平台路径策略，backend / worker 不绕过它直接处理平台差异。
- `src/gui` 是桌面宿主、IPC、preload、窗口和外链策略边界，renderer 只能通过 `window.desktopApp` 与后端 API base URL 接触宿主能力。

## 3. 两条启动链

**GUI**

1. 产品入口解析桌面 bundle 根并构造 worker 执行配置。
2. `gui-entry` 在 Electron ready 后启动 `BackendBootstrap`。
3. Bootstrap 依次初始化日志、启动期迁移、设置、数据库、`BackendServices`，再按需启动 Gateway。
4. GUI 拿到 `apiBaseUrl` 后创建日志窗口与主窗口，并通过 preload 暴露给 renderer。
5. renderer 由 `desktop-api.ts` 探测 `/api/health` 后进入状态初始读取。

**CLI**

1. 产品入口只读取 `--cli` 后的用户参数。
2. `src/cli` 解析单一动词命令并启动无 Gateway 的 Bootstrap。
3. job 创建一次性临时 `.lg`，把输入、语言和显式资源写入后端事实链路。
4. job 通过 `TaskService` 启动任务，订阅 `task.snapshot_changed` 等待终态，再导出到 `--output-dir`。

## 4. 项目事实主链路

- loaded 工程身份归 `ProjectSessionState`，热读数据归 `CacheManager`，任务运行态归 `TaskRunState` / `TaskSnapshotBuilder`，项目事实与 task snapshot 不互相缓存。
- 项目数据 section 固定为 `project`、`files`、`items`、`quality`、`prompts`、`analysis`、`proofreading`。
- 运行态项目写入的顺序是：数据库事务成功 → 后端内部 committed event → cache 更新 → 公开项目变更事件 / HTTP 写入结果。前端把 HTTP 写入结果和 SSE 都当作刷新信号，事实仍由后端 query 返回。
- 非 engine 的重型无状态计算进入 `src/backend/worker`，任务规划、work unit、运行锁、limiter、artifact commit 仍归 `src/backend/engine`。
- provider SDK、出站请求策略和请求结果归一归 `src/backend/llm`，任务编排层只消费归一后的 LLM 能力。

## 5. 更新触发条件

- 改 GUI / CLI 分发、进程边界、Gateway 暴露方式、Bootstrap 生命周期或 worker 执行入口，更新本文。
- 改 `src/domain`、`src/shared`、`src/native`、GUI 宿主契约或跨层依赖方向，更新本文。
- 改 API、SSE、状态写入口、数据库、任务事件、前端运行态或 CLI 命令时，更新对应专题文档，本文只在主链路或层级关系变化时同步。
