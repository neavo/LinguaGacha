# Cache Refresh Facts

## 文档目的

本文只记录截至当前代码实现已确认的缓存刷新相关事实，供后续 Agent 在不重复前置讨论的情况下继续分析或实施改动。

本文不是计划、方案或任务清单，不包含阶段划分、优先级或待办事项。

## 范围

本文只覆盖以下内容：

- 工作台缓存的真实依赖与当前刷新行为
- 校对页缓存的真实依赖与当前刷新行为
- 已确认会影响两页缓存的业务操作
- 业务影响范围与当前实现行为之间已确认的不一致

本文不覆盖以下内容：

- 具体改造步骤
- API 最终设计
- 事件协议演进方案
- 长期文档维护策略

## 页面快照的真实依赖

### 工作台

工作台快照由以下业务对象聚合得到：

- 资产路径列表 `asset_paths`
- 条目列表中的 `file_path`
- 条目列表中的 `file_type`
- 条目列表中的 `status`
- 文件操作运行态 `file_op_running`

当前工作台快照聚合逻辑见 [WorkbenchService.py](/E:/Project/LinguaGacha/module/Data/Project/WorkbenchService.py:16)。

由此可确认：

- 工作台是否需要刷新，核心取决于文件集合、文件顺序以及条目状态聚合结果是否变化。
- 单条条目的 `dst` 文本变化本身不会直接影响工作台，只有它进一步导致 `status`、`file_path` 或文件集合变化时才会影响工作台。

### 校对页

校对页快照由以下业务对象与派生结果构成：

- 全量条目 `items_all`
- 经过 `build_review_items()` 后进入校对范围的 review 条目集合
- 基于当前配置与规则构建的 `ResultChecker`
- 对 review 条目批量计算得到的 `warning_map`
- 基于 warning 结果派生出的失败术语缓存、默认筛选项与摘要

当前校对页快照构建逻辑见：

- [ProofreadingSnapshotService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingSnapshotService.py:93)
- [ProofreadingFilterService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingFilterService.py:121)
- [ResultChecker.py](/E:/Project/LinguaGacha/module/ResultChecker.py:211)

由此可确认：

- 校对页缓存不是单纯的条目列表缓存，而是“条目集合 + 检查器结果 + 默认筛选派生结果”的组合缓存。
- 影响校对页的既可能是条目内容变化，也可能是规则、开关、语言设置等检查语义变化。

## 当前实现事实

### 总体行为

截至当前实现，两页都没有真正意义上的差异刷新机制。

- 失效后，前端通常会把缓存标记为过期
- 随后重新请求整份快照
- 再用返回结果全量重建页面缓存

对应代码见：

- 工作台：[use-workbench-live-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts:813)
- 校对页：[use-proofreading-page-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts:645)

### 运行时失效信号

渲染层运行时目前只维护两个整页失效 tick：

- `workbench_invalidation_tick`
- `proofreading_invalidation_tick`

对应代码见 [desktop-runtime-context.tsx](/E:/Project/LinguaGacha/frontend/src/renderer/app/state/desktop-runtime-context.tsx:456)。

由此可确认：

- 当前失效模型是“页面级别”的，而不是“文件级别”或“条目级别”的。
- 即使后端事件 payload 中携带了 `keys`、`rel_path`、`rule_types` 等差异线索，当前页面缓存层也没有消费这些差异信息做局部 patch。

### 页面主动刷新路径

除失效 tick 外，页面还会在以下时机主动重拉整页快照：

#### 工作台

- 工程加载后
- 工程切换后
- 任意任务从忙碌态回到空闲态后
- 工作台内文件操作完成后

对应代码见：

- [use-workbench-live-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts:877)
- [use-workbench-live-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts:905)
- [use-workbench-live-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts:1144)

#### 校对页

- 工程加载后
- 工程切换后
- 任意任务从忙碌态回到空闲态后
- 收到校对页失效 tick 后

对应代码见：

- [use-proofreading-page-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts:1156)
- [use-proofreading-page-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts:1185)
- [use-proofreading-page-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts:1198)

## 业务影响范围事实

下表中的“影响范围”描述的是基于当前业务逻辑确认的天然影响范围，不等同于当前实现的刷新方式。

| 操作 | 工作台影响范围 | 校对页影响范围 | 当前实现行为 | 备注 |
| --- | --- | --- | --- | --- |
| 工程加载 / 切换 / 卸载 | 全局 | 全局 | 两页都清空并重拉 | 工程身份变更 |
| `source_language` 变化 | 全局 | 全局 | 当前走整页刷新 | 会影响预过滤结果与校对检查语义 |
| `mtool_optimizer_enable` 变化 | 全局 | 全局 | 当前走整页刷新 | 会改变大量 `RULE_SKIPPED` 状态 |
| `target_language` 变化 | 无 | 无 | 当前被纳入刷新链 | 当前工作台/校对快照计算并不真实依赖它 |
| `check_kana_residue` 变化 | 无 | 全局 | 当前会触发校对失效 | 业务语义上是校对检查开关 |
| `check_hangeul_residue` 变化 | 无 | 全局 | 当前会触发校对失效 | 业务语义上是校对检查开关 |
| `check_similarity` 变化 | 无 | 全局 | 当前会触发校对失效 | 业务语义上是校对检查开关 |
| 术语表内容变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中相关术语的条目 |
| 术语表启用开关变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中术语检查的条目 |
| 前置替换规则内容变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中相关模式的条目 |
| 前置替换启用开关变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中相关模式的条目 |
| 后置替换规则内容变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中相关模式的条目 |
| 后置替换启用开关变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中相关模式的条目 |
| 文本保护条目内容变化 | 无 | 条目级 | 当前整页失效后全量重建 | 只影响命中相关保护规则的条目 |
| 文本保护模式变化 | 无 | 全局 | 当前整页失效后全量重建 | 会整体改变检查器行为 |
| 新增文件 | 文件级 | 文件级 | 工作台页主动整页重拉；校对页整页失效后重拉 | 影响单文件条目集 |
| 替换文件 | 文件级 | 文件级 | 工作台页主动整页重拉；校对页整页失效后重拉 | 影响单文件条目集 |
| 重置文件 | 文件级 | 文件级 | 工作台页主动整页重拉；校对页整页失效后重拉 | 影响单文件状态回滚 |
| 删除文件 | 文件级 | 文件级 | 工作台页主动整页重拉；校对页整页失效后重拉 | 影响文件集合与该文件下条目 |
| 文件重排 | 文件级 | 无 | 工作台页主动整页重拉 | 只影响工作台文件顺序 |
| 校对页单条保存 | 条目级 | 条目级 | 校对页整页重拉；工作台未统一联动 | 可能改变条目 `status` |
| 校对页批量保存 | 条目级 | 条目级 | 校对页整页重拉；工作台未统一联动 | 可能改变多个条目 `status` |
| 校对页批量替换 | 条目级 | 条目级 | 校对页整页重拉；工作台未统一联动 | 可能改变多个条目 `status` |
| 校对页重译 | 条目级 | 条目级 | 校对页整页重拉；工作台未统一联动 | 可能改变多个条目 `status/retry_count` |
| 翻译任务完成 | 条目级 | 条目级 | 两页都会整页重拉；工作台还会收到统一失效 | 实际是批量条目状态变化 |
| `translation_reset_failed` | 条目级 | 条目级 | 当前按整页处理 | 只影响失败条目 |
| `translation_reset_all` | 全局 | 全局 | 当前按整页处理 | 大量状态回滚并伴随预过滤 |
| 分析任务完成 | 无 | 无 | 两页都会因任务终态主动刷新 | 当前两页快照不真实依赖分析进度 |
| 分析重置 | 无 | 无 | 两页都会因任务终态主动刷新 | 当前两页快照不真实依赖分析进度 |
| 提示词变更 | 无 | 无 | 无直接刷新价值 | 当前两页快照不依赖提示词内容 |
| 应用语言变化 | 无 | 无 | 无业务刷新价值 | 只影响界面语言 |
| 最近项目变化 | 无 | 无 | 无业务刷新价值 | 不影响当前工程数据 |

## 已确认的不一致与实现偏差

### 1. 当前实现存在明显的整页过刷

已确认的过刷包括：

- 当前两页没有差异刷新，默认都是整页重拉。
- 工作台会在任意任务从忙碌态回到空闲态后整页刷新，即使该任务结果与工作台快照无关。
- 校对页也会在任意任务从忙碌态回到空闲态后整页刷新，即使该任务结果与校对快照无关。

对应代码见：

- [use-workbench-live-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts:905)
- [use-proofreading-page-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts:1185)

### 2. 当前实现存在工作台联动缺口

校对页保存、批量替换、重译都会改变条目 `status`，并同步工程翻译状态统计：

- [ProofreadingMutationService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingMutationService.py:69)
- [ProofreadingRetranslateService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingRetranslateService.py:115)

但这条写入链当前没有统一补发工作台刷新事件。

由此可确认：

- 业务上这些操作会影响工作台统计。
- 当前实现中，工作台并没有通过统一失效事件稳定感知这类变化。

### 3. `target_language` 当前被纳入高影响配置，但真实计算并未使用它

当前 `target_language` 被纳入：

- 预过滤相关配置键
- 校对相关配置键

见 [DataManager.py](/E:/Project/LinguaGacha/module/Data/DataManager.py:67)。

但当前已确认：

- `ProjectPrefilter.apply()` 实际过滤判定只使用 `source_language` 与 `mtool_optimizer_enable`，见 [ProjectPrefilter.py](/E:/Project/LinguaGacha/module/Filter/ProjectPrefilter.py:50)
- `ResultChecker` 的当前校对检查逻辑不以 `target_language` 作为主要判断输入，见 [ResultChecker.py](/E:/Project/LinguaGacha/module/ResultChecker.py:91)

由此可确认：

- `target_language` 目前被纳入刷新链，并不是基于两页当前真实依赖得出的。

### 4. 部分校对开关在刷新链中被视为高影响项，但当前检查器未实际消费

当前以下开关会触发校对页失效：

- `check_kana_residue`
- `check_hangeul_residue`
- `check_similarity`

见 [DataManager.py](/E:/Project/LinguaGacha/module/Data/DataManager.py:74)。

但当前 `ResultChecker` 代码本身并未直接读取这些配置开关，见 [ResultChecker.py](/E:/Project/LinguaGacha/module/ResultChecker.py:91)。

由此可确认：

- 当前“触发刷新”与“刷新后结果是否真实变化”之间存在实现偏差。
- 即使发生整页重建，这些开关也不一定会改变当前校对结果。

## 关键代码入口

### 工作台

- 快照构建：[WorkbenchService.py](/E:/Project/LinguaGacha/module/Data/Project/WorkbenchService.py:16)
- 页面缓存刷新：[use-workbench-live-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts:813)
- 文件操作写入：[ProjectFileService.py](/E:/Project/LinguaGacha/module/Data/Project/ProjectFileService.py:42)

### 校对页

- 快照构建：[ProofreadingSnapshotService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingSnapshotService.py:93)
- 条目筛选：[ProofreadingFilterService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingFilterService.py:121)
- 批量检查：[ResultChecker.py](/E:/Project/LinguaGacha/module/ResultChecker.py:211)
- 页面缓存刷新：[use-proofreading-page-state.ts](/E:/Project/LinguaGacha/frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts:645)
- 校对写入：[ProofreadingMutationService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingMutationService.py:105)
- 校对重译：[ProofreadingRetranslateService.py](/E:/Project/LinguaGacha/module/Data/Proofreading/ProofreadingRetranslateService.py:57)

### 事件与运行时

- 事件桥接：[EventBridge.py](/E:/Project/LinguaGacha/api/Bridge/EventBridge.py:13)
- 运行时失效 tick：[desktop-runtime-context.tsx](/E:/Project/LinguaGacha/frontend/src/renderer/app/state/desktop-runtime-context.tsx:456)
- 数据层刷新发射点：[DataManager.py](/E:/Project/LinguaGacha/module/Data/DataManager.py:212)
