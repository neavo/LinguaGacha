# `module/Data` 规范说明

## 一句话总览
`module/Data` 是项目级数据层，**外部只能通过 `DataManager` 读写项目数据**；内部再按会话、存储、工程业务、质量规则、分析、翻译分层拆开。

## 适合 AGENT 的阅读顺序
如果任务刚好碰到这个模块，按下面顺序读，通常不用再遍历整个目录：

1. 先读 `DataManager.py`
2. 再看你碰到的是哪条业务线
3. 只补读对应子包

```text
入口层
  DataManager.py

基础层
  Core/ProjectSession.py
  Storage/LGDatabase.py

业务层
  Project/*
  Quality/*
  Analysis/*
  Translation/*
```

### 任务到模块的最短定位
| 任务类型 | 优先阅读 |
| --- | --- |
| 工程加载/卸载 | `DataManager.py` + `Project/ProjectLifecycleService.py` |
| 新建工程/导入源文件 | `DataManager.py` + `Project/ProjectService.py` |
| 工作台文件增删改 | `DataManager.py` + `Project/ProjectFileService.py` |
| 预过滤重跑 | `DataManager.py` + `Project/ProjectPrefilterService.py` |
| 规则页、提示词、文本保护 | `DataManager.py` + `Quality/QualityRuleService.py` |
| 分析进度、候选池、导入术语 | `DataManager.py` + `Analysis/AnalysisService.py` |
| 翻译任务取条目 | `DataManager.py` + `Translation/TranslationItemService.py` |
| 缓存、meta、rules、items、assets | `Core/*` |
| SQL、schema、事务细节 | `Storage/LGDatabase.py` |

## 目录结构
```text
module/Data/
├─ DataManager.py                 # 对外唯一公开入口
├─ spec.md                        # 本说明文件
├─ Core/                          # 基础数据能力
│  ├─ DataEnums.py
│  ├─ DataTypes.py
│  ├─ ProjectSession.py
│  ├─ MetaService.py
│  ├─ RuleService.py
│  ├─ ItemService.py
│  ├─ AssetService.py
│  └─ BatchService.py
├─ Storage/                       # 持久化存储
│  └─ LGDatabase.py
├─ Project/                       # 工程生命周期与文件操作
│  ├─ ProjectService.py
│  ├─ ProjectLifecycleService.py
│  ├─ ProjectPrefilterService.py
│  ├─ ProjectFileService.py
│  ├─ ExportPathService.py
│  └─ WorkbenchService.py
├─ Quality/                       # 质量规则业务
│  └─ QualityRuleService.py
├─ Analysis/                      # 分析业务
│  ├─ AnalysisService.py
│  ├─ AnalysisRepository.py
│  ├─ AnalysisCandidateService.py
│  └─ AnalysisProgressService.py
└─ Translation/                   # 翻译条目准备
   ├─ TranslationItemService.py
   └─ TranslationResetService.py
```

## 模块边界
这里最重要，后面改代码时先对照这一节。

### 对外规则
- 外部模块只依赖 `DataManager`
- 外部模块不要直接 import 内部 service
- 外部模块不要直接碰 `ProjectSession`
- 外部模块不要直接写 `LGDatabase`

### 对内规则
- `DataManager` 负责：
  - 组装内部 service
  - 提供稳定公开方法
  - 发事件
  - 管线程协调、忙碌态、任务前后置动作
- `ProjectSession` 负责：
  - 保存当前工程内存态
  - 保存缓存
  - 作为 service 间共享状态容器
- `LGDatabase` 负责：
  - schema
  - SQL
  - 序列化/反序列化
  - 数据库事务
- 各个 service 负责：
  - 单一业务面的规则整理和数据编排
  - 不直接承担 UI 事件职责

### 明确禁止
- 禁止把 SQL 散到 `LGDatabase` 之外
- 禁止把新的项目级状态再塞回 `DataManager`
- 禁止跨模块传可变对象引用，尤其是跨线程
- 禁止为了方便把新文件继续平铺回 `module/Data` 根目录

## 核心对象分工
### `DataManager`
这是总门口。

- 角色：Facade + Orchestrator
- 关键词：唯一入口、事件、线程、流程编排
- 可以做：
  - `load_project`
  - `update_batch`
  - `set_glossary`
  - `schedule_add_file`
  - `commit_analysis_task_result`
- 不该做：
  - 写 SQL
  - 持有重复缓存
  - 藏复杂业务状态

### `Core/ProjectSession.py`
这是当前工程的内存快照中心。

- 单一来源：
  - `db`
  - `lg_path`
  - `meta_cache`
  - `rule_cache`
  - `rule_text_cache`
  - `item_cache`
  - `asset_decompress_cache`
- 判断标准：
  - 如果某个状态只在当前工程加载期间有效，优先考虑放这里
  - 如果某个状态是纯流程控制而不是工程事实，别放这里

### `Storage/LGDatabase.py`
这是唯一持久化实现。

- 这里能看到：
  - `.lg` schema
  - item/rule/meta/assets 的真实存储方式
  - 分析 checkpoint / observation / aggregate 的真实落库方式
- 如果需求涉及：
  - 表结构
  - SQL 性能
  - 事务一致性
  - 兼容旧数据
  就必须看它

## 主流程脑图
### 1. 工程创建
```text
外部入口
  -> DataManager.create_project()
    -> ProjectService.create()
      -> LGDatabase.create()
      -> FileManager.parse_asset()
      -> ProjectPrefilter.apply()
      -> LGDatabase 写入初始数据
```

### 2. 工程加载
```text
外部入口
  -> DataManager.load_project()
    -> ProjectLifecycleService.load_project()
      -> ProjectSession 切换 db / lg_path
      -> MetaService 刷新缓存
      -> 迁移旧字段
    -> DataManager 发 PROJECT_LOADED
```

### 3. 规则读写
```text
规则页 / 业务模块
  -> DataManager.set_xxx()
    -> QualityRuleService / MetaService
      -> RuleService / BatchService
        -> LGDatabase
    -> DataManager 发 QUALITY_RULE_UPDATE
```

### 4. 文件增删改
```text
Workbench
  -> DataManager.schedule_xxx_file()
    -> ProjectFileService
      -> LGDatabase 修改 assets / items
      -> AnalysisService.clear_analysis_progress()
    -> DataManager 发 PROJECT_FILE_UPDATE
    -> DataManager 触发预过滤补跑
```

### 5. 分析结果提交
```text
Analyzer
  -> DataManager.commit_analysis_task_result()
    -> AnalysisService
      -> LGDatabase 写 checkpoints / observations / aggregates / meta
```

### 6. 分析候选导入术语表
```text
AnalysisPage
  -> DataManager.import_analysis_candidates()
    -> AnalysisService
      -> QualityRuleService 合并术语
      -> BatchService.update_batch()
    -> DataManager 发 QUALITY_RULE_UPDATE
```

## 子包职责速查
### `Core`
放“基础能力”，不是“业务流程”。

- `MetaService`：meta 缓存读写
- `RuleService`：rules 缓存读写
- `ItemService`：items 缓存、`Item` 转换
- `AssetService`：asset 读取、解压缓存
- `BatchService`：`items/rules/meta` 统一事务写回
- `DataTypes`：跨层传递的冻结快照类型
- `DataEnums`：数据层通用枚举

### `Project`
放工程级业务动作。

- `ProjectService`：创建工程、收集源文件、预览工程
- `ProjectLifecycleService`：加载/卸载工程、旧字段迁移
- `ProjectPrefilterService`：预过滤调度状态和单次执行
- `ProjectFileService`：文件导入、更新、重置、删除
- `ExportPathService`：导出目录后缀和路径
- `WorkbenchService`：工作台聚合快照

### `Quality`
放质量规则业务，不碰 UI 事件。

- 规则归一化
- 各种 enable 开关与 prompt/meta 收口
- 规则统计输入快照

### `Analysis`
放分析业务，不承担项目生命周期管理。

- `AnalysisService`：对外门面，只负责装配内部服务和保持公开接口稳定
- `AnalysisRepository`：分析表读写、事务内 meta 同步
- `AnalysisCandidateService`：observation 去重、aggregate 合并、候选转术语
- `AnalysisProgressService`：checkpoint 规整、覆盖率汇总、待分析项筛选
- 分析候选导入术语前的预演与过滤由 `module/QualityRule/AnalysisGlossaryImportService.py` 负责

### `Translation`
只管“翻译前把什么条目交给翻译器”和“翻译失败条目的重置”。

## 修改建议
### 新需求要放哪
- 如果是缓存或基础读写：放 `Core`
- 如果是 SQL 或 schema：放 `Storage`
- 如果是工程动作：放 `Project`
- 如果是规则业务：放 `Quality`
- 如果是分析链路：放 `Analysis`
- 如果是翻译取条目：放 `Translation`

### 什么时候要改 `DataManager`
只有下面几种情况才改：

- 需要新增对外公开方法
- 需要新增事件发射
- 需要新增跨 service 的流程编排
- 需要统一一个新的线程入口

如果只是某个子领域内部逻辑变化，优先改对应 service，不要先动 `DataManager`

## 最容易踩坑的地方
- `DataManager` 是公开入口，不等于“大杂烩”
- `ProjectSession` 是会话状态，不等于随手缓存一切
- `BatchService.update_batch()` 只覆盖 `items/rules/meta`，不要把所有写操作都硬塞进去
- `AnalysisService` 会碰专用分析表，这部分事务还是要走它自己的落库逻辑
- `ProjectFileService` 改文件后，别忘了清分析进度并补跑预过滤
- 改规则数据后，真正对 UI 刷新负责的是 `DataManager.emit_quality_rule_update()`

## 给未来 AGENT 的工作准则
如果你只想快速了解这个模块，记住下面 6 句话就够了：

1. 外部只认 `DataManager`
2. `ProjectSession` 是工程内存态
3. `LGDatabase` 是唯一 SQL 层
4. `Core` 放基础能力，`Project/Quality/Analysis/Translation` 放业务
5. service 不直接发 UI 事件，事件统一由 `DataManager` 发
6. 新需求先判断归属，再落到对应子包，不要回到根目录平铺
