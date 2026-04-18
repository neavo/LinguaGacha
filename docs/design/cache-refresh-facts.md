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
- 文件操作运行态 `file_op_running`（由 API 响应层补入）

当前工作台相关聚合逻辑见：

- [WorkbenchService.py](/E:/Project/LinguaGacha/module/Data/Project/WorkbenchService.py:16)
- [WorkbenchAppService.py](/E:/Project/LinguaGacha/api/Application/WorkbenchAppService.py:173)

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

截至当前实现，**文件级与条目级场景都已经具备差异刷新机制**。

- 文件新增、替换、重置、删除，以及文件重排时，后端会先完成文件操作和预过滤收尾，再发结构化 SSE 事件
- 校对保存、批量替换、重译、翻译批量提交、`translation_reset_failed` 与可精确收敛的规则变更（包括分析候选导入术语表）当前都会发条目级或文件级结构化 SSE 事件
- 前端收到事件后，会按 `scope` 决定优先走 `/api/workbench/file-patch`、`/api/proofreading/file-patch` 或 `/api/proofreading/entry-patch`
- 只有 `scope = global`、本地缓存未就绪、补丁引用不完整，或补丁请求失败时，页面才会退回整页快照刷新

对应代码见：

- 工作台补丁入口：[use-workbench-live-state.ts](../../frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts)
- 校对页补丁入口：[use-proofreading-page-state.ts](../../frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts)
- 数据层发射点：[DataManager.py](../../module/Data/DataManager.py)

### 运行时失效信号

渲染层运行时目前不再只维护裸 tick，而是维护两个结构化页面变更信号：

- `workbench_change_signal`
- `proofreading_change_signal`

对应代码见 [desktop-runtime-context.tsx](../../frontend/src/renderer/app/state/desktop-runtime-context.tsx)。

由此可确认：

- 运行时信号的权威字段已经变成 `seq + payload`，而不是单纯的“递增次数”。
- `payload` 当前稳定字段为：
  - 工作台：`reason`、`scope`、`rel_paths`、`removed_rel_paths`、`order_changed`
  - 校对页：`reason`、`scope`、`item_ids`、`rel_paths`、`removed_rel_paths`
- 当前失效模型已经支持“文件级”“顺序级”与“条目级 patch”。

### 页面主动刷新路径

除结构化变更信号外，页面仍会在以下时机主动重拉整页快照：

#### 工作台

- 工程加载后
- 工程切换后
- 收到 `scope = global` 的工作台变更信号后
- 文件级补丁合并失败后

对应代码见：

- [use-workbench-live-state.ts](../../frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts)

#### 校对页

- 工程加载后
- 工程切换后
- 收到 `scope = global` 的校对页变更信号后
- 文件级或条目级补丁合并失败后

对应代码见：

- [use-proofreading-page-state.ts](../../frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts)

## 业务影响范围事实

下表中的“影响范围”描述的是基于当前业务逻辑确认的天然影响范围，不等同于当前实现的刷新方式。

| 操作 | 工作台影响范围 | 校对页影响范围 | 当前实现行为 | 备注 |
| --- | --- | --- | --- | --- |
| 工程加载 / 切换 / 卸载 | 全局 | 全局 | 两页都清空并重拉 | 工程身份变更 |
| `source_language` 变化 | 全局 | 全局 | 当前优先等待预过滤写回后统一整页刷新；只有预过滤未成功接管时，才退回即时校对整页刷新 | 会影响预过滤结果与校对检查语义 |
| `mtool_optimizer_enable` 变化 | 全局 | 全局 | 当前走整页刷新 | 会改变大量 `RULE_SKIPPED` 状态 |
| `target_language` 变化 | 无 | 无 | 当前只同步工程语言 meta，不触发页面刷新或预过滤 | 当前工作台/校对快照计算并不真实依赖它 |
| `check_kana_residue` 变化 | 无 | 无 | 当前不触发校对失效 | 该开关仍属于配置项，但当前校对快照链不消费 |
| `check_hangeul_residue` 变化 | 无 | 无 | 当前不触发校对失效 | 该开关仍属于配置项，但当前校对快照链不消费 |
| `check_similarity` 变化 | 无 | 无 | 当前不触发校对失效 | 该开关仍属于配置项，但当前校对快照链不消费 |
| 术语表内容变化 | 文件级 | 条目级 | 当前会按 impact 发 `proofreading scope=entry + workbench scope=file`，分析候选导入术语表也已走同一口径 | 只影响命中相关术语的条目 |
| 术语表启用开关变化 | 文件级 | 条目级 | 当前会按 impact 发 `proofreading scope=entry + workbench scope=file` | 只影响命中术语检查的条目 |
| 前置替换规则内容变化 | 文件级 | 条目级 | 当前会按 impact 发 `proofreading scope=entry + workbench scope=file` | 只影响命中相关模式的条目 |
| 前置替换启用开关变化 | 文件级 | 条目级 | 当前会按 impact 发 `proofreading scope=entry + workbench scope=file` | 只影响命中相关模式的条目 |
| 后置替换规则内容变化 | 文件级 | 条目级 | 当前会按 impact 发 `proofreading scope=entry + workbench scope=file` | 只影响命中相关模式的条目 |
| 后置替换启用开关变化 | 文件级 | 条目级 | 当前会按 impact 发 `proofreading scope=entry + workbench scope=file` | 只影响命中相关模式的条目 |
| 文本保护条目内容变化 | 文件级 | 条目级 | 当前仅在 `CUSTOM` 模式下按 regex 候选集发差异刷新 | 非 `CUSTOM` 模式下不再触发无意义刷新 |
| 文本保护模式变化 | 文件级 | 全局 | 当前走全局失效 | 会整体改变检查器行为 |
| 新增文件 | 文件级 | 文件级 | 工作台与校对页都先收结构化事件，再各自请求一次文件补丁 | 影响单文件条目集 |
| 替换文件 | 文件级 | 文件级 | 工作台与校对页都先收结构化事件，再各自请求一次文件补丁 | 影响单文件条目集 |
| 重置文件 | 文件级 | 文件级 | 工作台与校对页都先收结构化事件，再各自请求一次文件补丁 | 影响单文件状态回滚 |
| 删除文件 | 文件级 | 文件级 | 工作台与校对页都先收结构化事件，再各自请求一次文件补丁 | 影响文件集合与该文件下条目 |
| 多文件删除 / 重置 / 替换 | 文件级 | 文件级 | 前端走批量接口；后端只发一次事件；两页各自只请求一次文件补丁 | 当前默认全成或全败 |
| 文件重排 | 文件级 | 无 | 工作台收 `scope = order` 事件后请求一次文件补丁；校对页不刷新 | 只影响工作台文件顺序 |
| 校对页单条保存 | 文件级 | 条目级 | 当前会立即请求一次 `entry-patch`，工作台同步走 `file-patch` | 可能改变条目 `status` |
| 校对页批量保存 | 文件级 | 条目级 | 当前会立即请求一次 `entry-patch`，工作台同步走 `file-patch` | 可能改变多个条目 `status` |
| 校对页批量替换 | 文件级 | 条目级 | 当前会立即请求一次 `entry-patch`，工作台同步走 `file-patch` | 可能改变多个条目 `status` |
| 校对页重译 | 文件级 | 条目级 | 当前会立即请求一次 `entry-patch`，工作台同步走 `file-patch` | 可能改变多个条目 `status/retry_count` |
| 翻译任务完成 | 文件级 | 条目级 | 当前由批量提交入口直接补发差异刷新，不再等任务终态整页重拉 | 实际是批量条目状态变化 |
| `translation_reset_failed` | 文件级 | 条目级 | 当前会直接补发 `entry/file` 差异刷新 | 只影响失败条目 |
| `translation_reset_all` | 全局 | 全局 | 当前按整页处理 | 大量状态回滚并伴随预过滤 |
| 分析任务完成 | 无 | 无 | 当前不再因为任务终态主动刷新两页 | 当前两页快照不真实依赖分析进度 |
| 分析重置 | 无 | 无 | 当前不再因为任务终态主动刷新两页 | 当前两页快照不真实依赖分析进度 |
| 提示词变更 | 无 | 无 | 无直接刷新价值 | 当前两页快照不依赖提示词内容 |
| 应用语言变化 | 无 | 无 | 无业务刷新价值 | 只影响界面语言 |
| 最近项目变化 | 无 | 无 | 无业务刷新价值 | 不影响当前工程数据 |

## 已确认的不一致与实现偏差

### 1. 当前实现仍然保留全局兜底刷新

当前仍会整页重拉的场景包括：

- 工程加载与工程切换。
- 显式 `scope = global` 的结构化失效事件。
- 文件级或条目级补丁合并失败时的兜底回退。

对应代码见：

- [use-workbench-live-state.ts](../../frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts)
- [use-proofreading-page-state.ts](../../frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts)

### 2. 当前实现已经补齐条目级工作台联动

当前以下链路都会在写入成功后同步补发工作台 `scope = file` 刷新：

- 校对页保存、批量替换、重译。
- 翻译批量提交。
- `translation_reset_failed`。
- 可精确收敛的规则变更。

### 3. `target_language` 已从页面刷新链和预过滤比较口径中剥离

当前已确认：

- `ProjectPrefilter.apply()` 实际过滤判定只使用 `source_language` 与 `mtool_optimizer_enable`
- `ResultChecker` 的当前校对检查逻辑不以 `target_language` 作为主要判断输入
- `DataManager` 当前只会把 `target_language` 同步回已加载工程的语言 meta 镜像，不再因为它触发页面刷新或预过滤

由此可确认：

- `target_language` 仍是合法的工程摘要字段。
- 但它不再属于工作台/校对页缓存的高影响配置。

### 4. 部分校对开关已从校对页刷新链移除

当前以下开关不会再触发校对页失效：

- `check_kana_residue`
- `check_hangeul_residue`
- `check_similarity`

同时已确认：

- 当前 `ResultChecker` 代码本身并未直接读取这些配置开关
- 它们虽然仍属于配置项，但不构成当前校对页快照的真实依赖

由此可确认：

- 当前“配置变更 -> 页面刷新”的判定口径已经收紧到真实依赖。
- 这些开关后续若要重新进入刷新链，前提应当是校对快照计算链真实消费了它们。

## 关键代码入口

### 工作台

- 快照构建与 entry patch：[WorkbenchService.py](../../module/Data/Project/WorkbenchService.py)
- 页面缓存刷新与补丁合并：[use-workbench-live-state.ts](../../frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts)
- 文件操作写入：[ProjectFileService.py](../../module/Data/Project/ProjectFileService.py)

### 校对页

- 快照构建：[ProofreadingSnapshotService.py](../../module/Data/Proofreading/ProofreadingSnapshotService.py)
- 条目筛选：[ProofreadingFilterService.py](../../module/Data/Proofreading/ProofreadingFilterService.py)
- 批量检查：[ResultChecker.py](../../module/ResultChecker.py)
- 页面缓存刷新与补丁合并：[use-proofreading-page-state.ts](../../frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts)
- 校对写入：[ProofreadingMutationService.py](../../module/Data/Proofreading/ProofreadingMutationService.py)
- 校对重译：[ProofreadingRetranslateService.py](../../module/Data/Proofreading/ProofreadingRetranslateService.py)

### 事件与运行时

- 事件桥接：[EventBridge.py](../../api/Bridge/EventBridge.py)
- 运行时结构化变更信号：[desktop-runtime-context.tsx](../../frontend/src/renderer/app/state/desktop-runtime-context.tsx)
- 数据层刷新发射点：[DataManager.py](../../module/Data/DataManager.py)
