# LinguaGacha 数据域文档

## 一句话总览
LinguaGacha 的 Python Core 以“工程事实、任务执行、文件格式、模型配置”四块稳定域协作。本文回答的不是目录长什么样，而是：`Data / Engine / File / Model` 分别拥有什么权威职责，项目级状态应该落在哪里，唯一写入口怎么判断，SQL 为什么只能落在 `module/Data/Storage/LGDatabase.py`，以及哪些非显然规则会影响未来维护。

## `Data / Engine / File / Model` 的职责边界

| 领域 | 权威入口 | 稳定职责 | 不该做什么 |
| --- | --- | --- | --- |
| `module/Data` | `DataManager.py` | 工程事实、规则、分析、翻译结果、校对辅助、项目运行态编码 | 不持有后台任务执行骨架，不散落 SQL |
| `module/Engine` | `Engine.py` + `TaskRunnerLifecycle.py` | 后台任务生命周期、请求调度、停止、重试、进度与终态语义 | 不持有工程真相，不直接定义 HTTP 壳 |
| `module/File` | `FileManager.py` | 文件格式分发、解析、资产读取、目标格式写回 | 不持有工程生命周期、事务与项目加载态 |
| `module/Model` | `Manager.py` + `Types.py` | 模型配置类型、模板补齐、分组排序、激活模型回退 | 不承载页面快照，不定义 API 响应壳 |

```mermaid
flowchart TD
    A["API / AppService"] --> B["DataManager"]
    A --> C["Engine"]
    B --> D["Project / Quality / Analysis / Translation / Proofreading"]
    B --> E["FileManager"]
    B --> F["module/Data/Storage/LGDatabase.py"]
    A --> G["Model Manager"]
    C --> H["DataManager commit / Base.Event"]
```

## 状态拥有者与唯一写入口

| 状态或语义 | 权威来源 | 唯一写入口或协调入口 |
| --- | --- | --- |
| 已加载工程、items、rules、meta、assets 缓存 | `ProjectSession` | `DataManager` 协调各领域 service |
| 工程创建、加载、卸载 | `Project/ProjectService.py`、`ProjectLifecycleService.py` | `DataManager` |
| 工作台文件集合与运行态编码 | `Project/ProjectFileService.py`、`ProjectRuntimeService.py` | `DataManager` |
| 规则、提示词、预设 | `Quality/*` | `DataManager` |
| 分析候选、checkpoint、分析结果 | `Analysis/*` | `DataManager` |
| 校对保存、重翻、校对 revision | `Proofreading/*` | `ProofreadingAppService` 组合这些服务 |
| 全局忙碌态与实时请求数 | `Engine.status`、`request_in_flight_count` | `Engine` |
| 文件格式解析与写回 | `FileManager.py` | `module/File` |
| 模型列表整理、模板补齐、排序与默认回退 | `module/Model/Manager.py` | `module/Model` |

判断规则：
- 如果它是工程事实、规则、条目、分析结果、校对辅助或导出前持久化事实，优先判断是否属于 `module/Data`。
- 如果它是任务生命周期、请求节奏、停止与重试，属于 `module/Engine`。
- 如果它是格式识别、提取条目或写回目标文件，属于 `module/File`。
- 如果它是模型配置对象、模板选择、排序或激活模型回退，属于 `module/Model`。
- 如果它只是页面筛选、弹窗开关、表格交互态，不属于 Python Core，留在前端页面本地状态。

## SQL 唯一落点

- SQL、schema、事务与 `.lg` 文件存储细节只允许落在 `module/Data/Storage/LGDatabase.py`。
- `ProjectSession` 是会话状态容器，不承担 SQL。
- API 层不得直接持有数据库连接，也不得直接持有 `ProjectSession`。
- 若某个新需求看起来需要“在 API 里顺手写一条 SQL”，说明落点已经错了，应回到 `module/Data` 或 `module/Data/Storage/LGDatabase.py` 设计。

## 典型数据流

### 工程加载与运行态编码

```mermaid
flowchart TD
    A["DataManager"] --> B["ProjectLifecycleService"]
    B --> C["ProjectSession"]
    C --> D["ProjectRuntimeService"]
    D --> E["API bootstrap / project.patch"]
    E --> F["ProjectStore"]
```

稳定事实：
- `DataManager` 是工程级数据门面，负责会话、规则、分析、翻译、工作台事件与跨 service 编排。
- `ProjectRuntimeService` 负责把工程事实编码成 bootstrap block 与运行态 patch 可复用记录。
- 设置里的 `source_language` 与 `mtool_optimizer_enable` 会影响预过滤与校对运行态；`target_language` 只同步工程摘要镜像。

### 后台任务与数据提交

```mermaid
flowchart TD
    A["TaskAppService / Base.Event"] --> B["Engine"]
    B --> C["TaskPipeline"]
    C --> D["TaskRequester"]
    C --> E["commit loop"]
    E --> F["DataManager / AnalysisService / TranslationItemService"]
    F --> G["module/Data/Storage/LGDatabase.py"]
```

稳定事实：
- `Engine` 负责执行骨架，`DataManager` 负责落库与工程事实更新。
- `TaskPipeline` 的 commit loop 是唯一允许生成 retry context 的地方。
- 停止语义是先切到 `STOPPING`，再由流水线与超时收尾，不是立刻中断网络 IO。
- 翻译任务终态只保存项目事实；译文文件写出属于用户确认后的显式导出动作，不挂在任务完成收尾上。

### 文件导入与导出

```mermaid
flowchart TD
    A["输入路径或 asset bytes"] --> B["FileManager"]
    B --> C["具体格式处理器"]
    C --> D["list[Item] / Project"]
    D --> E["DataManager"]
    E --> F["翻译结果"]
    F --> B
    B --> G["目标文件 / 双语文件 / 导出目录"]
```

稳定事实：
- `FileManager.read_from_path()` 和 `parse_asset()` 是格式分发入口。
- `write_to_path()` 在 `DataManager.timestamp_suffix_context()` 内统一调用具体 writer。
- 输出路径规则由 `DataManager` 决定，具体 writer 只执行目标格式写回。

## 非显然规则速查

### 数据域
- `Config` 是运行时语言设置的权威来源；工程 `.lg` 中的 `source_language` / `target_language` 只是镜像摘要。
- 分析候选导入术语的预演和筛选属于前端 planner；Python 数据层保留候选聚合、候选数缓存和分析结果持久化。
- `translation reset` 与 `analysis reset` 属于同步 mutation，不是后台任务链路。
- 校对 `save-item`、`save-all`、`replace-all` 属于同步 mutation；`retranslate-items` 仍是任务型链路。

### 迁移入口

| 场景 | 迁移入口 | 保持在原领域的内容 |
| --- | --- | --- |
| 启动期 userdata/config/preset 布局升级 | `module/Migration/UserDataMigrationService.py` | 配置读写仍由 `Config` 与路径 resolver 提供权威路径 |
| `.lg` 打开期 schema 与项目状态升级 | `module/Migration/ProjectSchemaMigrationService.py` | 建表、索引和 SQL 细节仍只落在 `module/Data/Storage/LGDatabase.py` |
| 工程加载期 meta/rule 旧字段升级 | `module/Migration/ProjectMetaMigrationService.py`、`module/Migration/ProjectRuleMigrationService.py` | `ProjectLifecycleService` 只维持加载时机、cache 刷新和清理 |
迁移目录只承接会写回旧数据、旧磁盘布局或旧配置事实的行为；读取兼容、payload 归一和文件格式 fallback 保留在原领域。例如 `LGDatabase.get_rules()` 的旧规则读取兼容、`Item/DataManager` 的状态边界归一，以及 EPUB/RenPy/TRANS writer fallback 都不是迁移入口。

### 引擎域
- `Engine.status` 是全局忙碌态的唯一权威来源，翻译与分析不会并行运行。
- `request_in_flight_count` 表示“真正发出去的请求数”，不是限流器上限，也不是队列长度。
- 对 API / 前端暴露的终态仍由桥接层解释为 `DONE / ERROR / IDLE`。

### 文件域

| 场景 | 当前规则 |
| --- | --- |
| `.xlsx` 解析 | `parse_asset()` 显式先试 `WOLFXLSX` 再回退 `XLSX`；整目录读取时两个 reader 都会遍历 `.xlsx`，再由 `XLSX.read_from_stream()` 主动跳过 WOLF 表头完成分流 |
| `.json` 解析 | 先尝试 `KVJSON`，返回空条目时再回退到 `MESSAGEJSON` |
| `.trans` | 会按 `project.gameEngine` 二次分发到不同处理器 |
| EPUB 写回 | 所有条目都带 `extra_field.epub.parts` 时走 AST writer，否则统一走 legacy writer |

### 模型域
- `module/Model/Manager.py` 是模型列表整理、分组排序、模板补齐和激活模型回退的唯一规则入口。
- 内置模型预设固定读取 `resource/model/preset` 单套资源，UI 语言切换不改变模型预设集合，也不会把现有 `PRESET` 模型改写成自定义模型。
- 新增模型供应商或模板时，优先扩展 `ModelType`、模板映射和预设资源，不把分支散到调用方。

## 新状态应归属哪里的判断规则

| 你想新增的东西 | 优先归宿 | 说明 |
| --- | --- | --- |
| 工程级持久化事实、revision、条目状态、规则快照 | `module/Data` | 由 `DataManager` 协调，必要时下沉到具体 service |
| 后台任务执行态、并发节奏、停止请求、重试队列 | `module/Engine` | 保持任务语义集中 |
| 文件解析中间态、写回兼容逻辑、格式判定顺序 | `module/File` | 保持格式规则集中 |
| 模型配置字段、模板选择、排序与默认回退 | `module/Model` | 保持模型配置语义集中 |
| 页面筛选、弹窗开关、局部交互状态 | 前端页面本地状态 | 不进入 Python Core |

红线：
- 不要把新的项目级状态顺手塞进 `DataManager`，先判断它是不是某个领域 service、更底层会话容器，或者根本应留在前端。
- 不要把新的 SQL、事务或 schema 逻辑放到 `module/Data/Storage/LGDatabase.py` 之外。
- 不要把共享任务语义写回 `module/Data`，也不要把工程事实塞进 `module/Engine`。

## 什么时候必须更新本文

- `Data / Engine / File / Model` 的职责边界变化
- `DataManager`、`ProjectSession`、`Engine.status`、`FileManager`、`Manager.py` 的权威入口变化
- SQL 落点、文件格式分发优先级、模型模板规则变化
- 同步 mutation、任务终态或工程事实流向变化
