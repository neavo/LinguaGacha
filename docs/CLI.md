# LinguaGacha CLI 命令模式

本文是 CLI 入口、命令协议、临时 `.lg`、资源注入、输出语义和平台启动器的唯一归宿。CLI 不承载 HTTP / SSE、数据库或 renderer 正文。

## 1. 入口边界

- CLI 只能由产品入口中的显式 `--cli` 触发，用户参数从 `--cli` 后开始读取；文件名、进程名或平台启动器名称不参与分发。
- job 期间后端 console / window 日志关闭；人类可读启动提示和入口错误走 stderr，机器状态走 stdout JSONL。
- CLI 完成导出后不自动打开输出目录。

## 2. 命令协议

全局层只保留 `--help` 与 `--version`，业务层只接受一个动词。

| 命令 | 必填参数 | 可选资源 | 产物 |
| --- | --- | --- | --- |
| `translate` | `--input` 可重复、`--output-dir`、`--source-language`、`--target-language` | `--prompt .txt`、`--glossary .json/.xlsx`、`--pre-replacement .json/.xlsx`、`--post-replacement .json/.xlsx`、`--text-preserve .json/.xlsx` | 译文写入 `--output-dir`，双语文件写入固定 `bilingual/` 子目录 |
| `analyze` | `--input` 可重复、`--output-dir`、`--source-language`、`--target-language` | `--prompt .txt` | 生成 `glossary.json` 与 `glossary.xlsx` |

- `--input` 保留传入顺序；支持格式、路径身份和去重继续由文件域处理。
- 源语言允许 `ALL`，目标语言不允许 `ALL`，两者都走共享语言值域归一。
- 解析阶段校验参数形状和资源扩展名，输入与资源的真实存在性在 job 边界统一校验。
- 翻译专属资源传给 `analyze` 属于 usage 错误，不静默忽略。
- 成功、help、version 返回 `0`，运行期错误返回 `1`，usage 错误返回 `2`。

## 3. 临时工程与设置

- 每个 job 独占一个临时 `.lg`；无论成功、任务失败还是导出失败，都撤销 transient 设置、卸载工程并删除临时目录。
- CLI 显式覆盖源语言、目标语言、完成后打开目录行为，并关闭术语表、文本保护、译前替换、译后替换、翻译提示词和分析提示词的默认预设；只有命令行资源写入本次工程。
- 未被上述覆盖的对应任务用途模型选择、并发、提示词增强、预过滤和导出相关设置沿用当前应用设置，CLI 不是全量配置隔离环境。
- `build_cli_task_input` 只把显式资源解析成项目领域输入，统一由 `ProjectLifecycleService.apply_task_input` 写入；CLI 不接触 database、meta 或 revision。
- `translate` 启动全量翻译后复用译文导出服务；`analyze` 启动全量分析后从候选池导出术语文件。
- job 通过 `TaskService.subscribe` 订阅同进程完整任务快照并等待终态，不依赖 API stream、轮询或第二套任务生命周期。

## 4. 输出协议

help / version 输出普通文本。进入 job 后，stdout 每行输出一个紧凑 JSON 对象：

| `type` | 稳定字段 | 语义 |
| --- | --- | --- |
| `started` | `command`、ISO `timestamp` | job 开始，最多一次 |
| `progress` | `command`、`status`、ISO `timestamp`、`stats` | 初始全零和与上一条相同的统计不重复输出 |
| `finished` | `command`、`status`、ISO `timestamp`、失败时的 `error.message` | job 终态，最多一次 |

`progress.stats` 固定为 `total`、`skipped`、`failed`、`completed`、`pending`、`percent`，不暴露内部 `TaskSnapshot.progress` 字段名。成功事件不重复输出调用方已知的 `--output-dir`；诊断日志只进入日志目标。

CLI job 开始前若 Bootstrap 或入口初始化失败，只写 stderr 并返回运行期错误码，不承诺 JSONL 生命周期事件。

## 5. 平台启动器与打包

- Windows 发布包提供 Go 编译的 `cli.exe` console launcher：定位同目录 `app.exe`，追加 `--cli`，继承 stdin/stdout/stderr，并返回子进程退出码。
- `afterPack` 在对应 Go module 内先运行测试再构建并复制 launcher；缺少 Go 工具链、测试失败或产物缺失都会使打包失败。
- macOS 与 Linux 不维护独立 CLI 二进制，使用主程序追加 `--cli`。
