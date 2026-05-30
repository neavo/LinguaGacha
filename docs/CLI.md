# LinguaGacha CLI 命令模式

本文是 CLI 入口、命令协议、临时 `.lg`、资源注入、输出语义和平台启动器的唯一归宿。CLI 不承载 HTTP / SSE、数据库 schema、前端运行态或用户长教程。

## 1. 入口边界

- CLI 只能由产品入口中的显式 `--cli` 触发，用户参数从 `--cli` 后开始读取，文件名、进程名或平台启动器名称不得成为产品入口的分发语义。
- 产品入口负责解析 appRoot、桌面 bundle 根和 `BackendWorkerExecution`，CLI、Bootstrap 与 worker 消费方不自行探测 worker 文件。
- CLI 通过 `BackendBootstrap(exposeApiGateway=false)` 复用后端组合根，不开放本机 HTTP / SSE Gateway。
- CLI job 期间后端 console / window 日志关闭，人类可读启动提示和错误走 stderr，机器状态走 stdout JSONL。
- `openOutputFolder` 在 CLI 模式固定为空操作，CLI 不打开输出目录。

## 2. 命令协议

全局层只保留 `--help` 与 `--version`，业务层只接受一个动词。

| 命令 | 必填参数 | 可选资源 | 产物 |
| --- | --- | --- | --- |
| `translate` | `--input` 可重复、`--output-dir`、`--source-language`、`--target-language` | `--prompt .txt`、`--glossary .json/.xlsx`、`--pre-replacement .json/.xlsx`、`--post-replacement .json/.xlsx`、`--text-preserve .json/.xlsx` | 译文文件导出到 `--output-dir` |
| `analyze` | `--input` 可重复、`--output-dir`、`--source-language`、`--target-language` | `--prompt .txt` | 分析候选导出到 `--output-dir` |

- `--input` 保留用户传入顺序，支持格式、路径身份和去重继续由文件域处理。
- 源语言允许 `ALL`，目标语言不允许 `ALL`，两者都走共享语言值域归一。
- 资源路径在解析阶段只校验非空和扩展名，真实存在性统一在 job 边界校验。
- 翻译专属资源传给 `analyze` 是 usage 错误，不能静默忽略。
- 退出码：成功、help、version 为 `0`，运行期错误为 `1`，usage 错误为 `2`。

## 3. 同步 job 链路

- 每个 CLI job 独占一个临时 `.lg` 工程，成功、失败或任务错误后都必须撤销 transient 设置、卸载工程并删除临时目录。
- CLI 不继承 GUI 默认预设，术语表、文本保护、译前替换、译后替换、翻译提示词和分析提示词预设默认关闭，只有命令行显式资源写入本次临时工程。
- 外部资源写入仍走 `ProjectDatabase` operation 与 committed event，资源影响 `quality` / `prompts` revision，任务启动使用当前 section revision 构造 `expected_section_revisions`。
- 翻译命令启动 `translation` 全量任务后调用译文导出服务，分析命令启动 `analysis` 全量任务后调用质量服务导出候选结果。
- CLI 等待任务只订阅同进程 `ApiStreamHub` 的 `task.snapshot_changed`，不得新增轮询状态或第二套任务生命周期。

## 4. 输出协议

- help / version 输出普通文本。
- job stdout 只输出一行一个紧凑 JSON，事件类型固定为 `started`、`progress`、`finished`。
- `progress.stats` 是 CLI 外部协议，字段固定为 `total`、`skipped`、`failed`、`completed`、`pending`、`percent`，不要把内部 `TaskSnapshot.progress` 字段名直接暴露为 CLI 协议。
- 成功的 `finished` 不重复输出产物路径，调用方以自己传入的 `--output-dir` 为产物位置。
- 失败的 `finished` 携带稳定 `error.message`，进程返回运行期错误码，后端诊断日志只进入日志文件。
- CLI 完成后产品入口必须主动结束 Electron 进程，避免 Windows console launcher 等待未退出子进程。

## 5. 平台启动器与打包

- Windows 发布包提供 Go 编译的 `cli.exe` console launcher，它定位同目录 `app.exe`，追加 `--cli`，继承 stdin/stdout/stderr，并返回子进程退出码。
- Windows launcher 在 `afterPack` 中构建并复制到发布目录，缺少 Go 工具链或 launcher 产物必须让打包失败。
- macOS 与 Linux 不单独维护 CLI 二进制，使用主程序追加 `--cli` 进入命令模式。
- 发布资产的平台与架构由构建工作流传入，长示例和用户教程留在 Wiki / help。

## 6. 更新触发条件

- 改 CLI 命令、参数、资源类型、扩展名、语言约束、输出路径、stdout/stderr 或退出码，更新本文。
- 改 `--cli` 分发、appRoot 解析、CLI 进程退出、worker 执行配置下传或平台启动器，更新本文。
- 改临时工程生命周期、默认预设关闭策略、资源写入、revision 推进、任务等待或导出链路，更新本文并按需同步 [`BACKEND.md`](BACKEND.md)。
