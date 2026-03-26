# Agent 前置信息文档系统编纂实施计划

> **给代理执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。所有步骤使用复选框 `- [ ]` 语法跟踪。

**目标：** 在 `docs/` 下落地一套面向维护型 Agent 的前置信息文档系统，并完成首批厚写/薄写文档编纂与现有 `SPEC.md` 的职责分流。

**架构：** 先建立 `overview / modules / references / generated` 四类静态文档骨架，再优先编纂系统总览、核心概念、不变量、代码地图以及 `base`、`data` 两篇厚写文档。现有 `api/SPEC.md` 继续作为局部契约原位保留，`module/Data/spec.md` 的有效内容吸收进 `docs/modules/data.md`，随后把旧文件收口为跳转说明。

**技术栈：** Markdown、Git、PowerShell、`rg`

---

## 文件结构与职责映射

### 新建文件

- `E:/Project/LinguaGacha/docs/overview/system-overview.md`
  - 仓库总体结构、主分层、关键入口。
- `E:/Project/LinguaGacha/docs/overview/runtime-topology.md`
  - 运行时拓扑与启动链路的薄写占位文档。
- `E:/Project/LinguaGacha/docs/overview/core-concepts.md`
  - 项目核心概念、术语和语义边界。
- `E:/Project/LinguaGacha/docs/overview/invariants.md`
  - 长期不变量与禁止破坏的事实。
- `E:/Project/LinguaGacha/docs/overview/code-map.md`
  - 常见维护任务的代码入口索引。
- `E:/Project/LinguaGacha/docs/modules/base.md`
  - `base/` 模块画像、入口和边界。
- `E:/Project/LinguaGacha/docs/modules/frontend.md`
  - `frontend/` 模块总览与边界。
- `E:/Project/LinguaGacha/docs/modules/data.md`
  - `module/Data` 模块画像，吸收旧 `spec.md` 的有效内容。
- `E:/Project/LinguaGacha/docs/modules/engine.md`
  - `module/Engine` 模块总览与边界。
- `E:/Project/LinguaGacha/docs/modules/file.md`
  - `module/File` 模块总览与边界。
- `E:/Project/LinguaGacha/docs/modules/localizer.md`
  - `module/Localizer` 模块总览与边界。
- `E:/Project/LinguaGacha/docs/references/ui-framework.md`
  - UI 组件、主题和线程约束专题规则。
- `E:/Project/LinguaGacha/docs/references/localization-rules.md`
  - 本地化规则专题说明。
- `E:/Project/LinguaGacha/docs/references/resource-layout.md`
  - 图标、资源与预设文件放置规则。
- `E:/Project/LinguaGacha/docs/generated/entrypoints.md`
  - 问题类型到入口文件的索引。
- `E:/Project/LinguaGacha/docs/generated/event-index.md`
  - 事件主题与发送/消费关系索引。
- `E:/Project/LinguaGacha/docs/generated/test-map.md`
  - 模块与测试文件映射索引。

### 修改文件

- `E:/Project/LinguaGacha/AGENTS.md`
  - 增加新文档体系的入口导航，告诉 Agent 先看哪些静态文档、何时跳转到 `api/SPEC.md` 或 `docs/superpowers/*`。
- `E:/Project/LinguaGacha/module/Data/spec.md`
  - 在 `docs/modules/data.md` 建成后，收口为短跳转说明，避免双份权威内容继续漂移。

### 保留原位文件

- `E:/Project/LinguaGacha/api/SPEC.md`
  - 继续作为 `api/` 子系统的局部契约文档，不迁入 `docs/`，只在新体系中被引用。

## 执行规则

- 本计划是纯文档编纂任务，不采用 TDD。
- 每个任务使用“来源核对、路径校验、diff 自审、引用一致性检查”替代测试步骤。
- 每次只处理一组职责相近的文档，避免一次性大范围写入导致概念漂移。
- 每个任务结束后都提交一次 git commit，保证文档演进可回溯。

### 任务 1：建立文档骨架与总入口导航

**文件：**
- 新增：
  - `E:/Project/LinguaGacha/docs/overview/system-overview.md`
  - `E:/Project/LinguaGacha/docs/overview/runtime-topology.md`
  - `E:/Project/LinguaGacha/docs/overview/core-concepts.md`
  - `E:/Project/LinguaGacha/docs/overview/invariants.md`
  - `E:/Project/LinguaGacha/docs/overview/code-map.md`
  - `E:/Project/LinguaGacha/docs/modules/base.md`
  - `E:/Project/LinguaGacha/docs/modules/frontend.md`
  - `E:/Project/LinguaGacha/docs/modules/data.md`
  - `E:/Project/LinguaGacha/docs/modules/engine.md`
  - `E:/Project/LinguaGacha/docs/modules/file.md`
  - `E:/Project/LinguaGacha/docs/modules/localizer.md`
  - `E:/Project/LinguaGacha/docs/references/ui-framework.md`
  - `E:/Project/LinguaGacha/docs/references/localization-rules.md`
  - `E:/Project/LinguaGacha/docs/references/resource-layout.md`
  - `E:/Project/LinguaGacha/docs/generated/entrypoints.md`
  - `E:/Project/LinguaGacha/docs/generated/event-index.md`
  - `E:/Project/LinguaGacha/docs/generated/test-map.md`
- 修改：
  - `E:/Project/LinguaGacha/AGENTS.md`

- [ ] **Step 1: 为四类文档目录建立文件骨架**

在所有新建文件中先写入最小有效头部，统一使用下面这种起步结构：

```md
# 文档标题

## 1. 范围

## 2. 关键事实

## 3. 关键入口

## 4. 相关跳转
```

- [ ] **Step 2: 在 `AGENTS.md` 中加入静态文档导航区块**

把导航区块加到项目背景或核心模块说明之后，内容应包含这些要点：

```md
## Agent 文档导航

- 先看 `docs/overview/system-overview.md` 理解仓库总结构
- 再看 `docs/overview/core-concepts.md` 与 `docs/overview/invariants.md` 建立术语与约束模型
- 涉及模块边界时跳到 `docs/modules/*.md`
- 涉及本地 HTTP / SSE / 错误码 / 客户端对象边界时直接看 `api/SPEC.md`
- 涉及具体任务设计与执行步骤时看 `docs/superpowers/specs/*` 与 `docs/superpowers/plans/*`
```

- [ ] **Step 3: 校验骨架文件与入口导航是否齐全**

执行：

```powershell
rg --files docs/overview docs/modules docs/references docs/generated
```

预期：

- 输出包含四类目录下的全部目标文件
- 不缺 `system-overview.md`、`data.md`、`entrypoints.md`

执行：

```powershell
rg -n "Agent 文档导航|api/SPEC.md|docs/superpowers/specs" AGENTS.md
```

预期：

- 能定位到新增导航区块
- 匹配到 `api/SPEC.md` 与 `docs/superpowers/specs`

- [ ] **Step 4: 提交骨架与导航改动**

```bash
git add AGENTS.md docs/overview docs/modules docs/references docs/generated
git commit -m "docs: add agent context doc skeleton"
```

### 任务 2：编纂四篇 overview 厚写文档

**文件：**
- 修改：
  - `E:/Project/LinguaGacha/docs/overview/system-overview.md`
  - `E:/Project/LinguaGacha/docs/overview/core-concepts.md`
  - `E:/Project/LinguaGacha/docs/overview/invariants.md`
  - `E:/Project/LinguaGacha/docs/overview/code-map.md`
- 参考：
  - `E:/Project/LinguaGacha/app.py`
  - `E:/Project/LinguaGacha/AGENTS.md`
  - `E:/Project/LinguaGacha/api/SPEC.md`
  - `E:/Project/LinguaGacha/base/Base.py`
  - `E:/Project/LinguaGacha/module/Data/DataManager.py`
  - `E:/Project/LinguaGacha/module/Engine/Engine.py`
  - `E:/Project/LinguaGacha/module/File/FileManager.py`
  - `E:/Project/LinguaGacha/module/Localizer/LocalizerZH.py`

- [ ] **Step 1: 编写 `system-overview.md`**

文档至少包含以下具体段落：

```md
# 系统总览

## 1. 范围
- 本文覆盖 app、base、frontend、module、model、widget、resource、tests 的总体关系

## 2. 主分层
- app.py 是 GUI / CLI 分流入口
- base/ 提供事件、日志、路径、CLI、版本等基础设施
- frontend/ 负责界面与交互
- module/ 负责业务主逻辑
- model/ 提供对象模型
- resource/ 提供图标、预设、提示词与脚本资源

## 3. 关键入口
- 启动先看 app.py
- 看系统事件与状态先看 base/Base.py
- 看项目数据入口先看 module/Data/DataManager.py
- 看任务引擎先看 module/Engine/Engine.py
- 看文件读写先看 module/File/FileManager.py

## 4. 相关跳转
- 模块细节跳转到 docs/modules/*.md
- 接口边界跳转到 api/SPEC.md
```

- [ ] **Step 2: 编写 `core-concepts.md` 与 `invariants.md`**

`core-concepts.md` 至少明确这些概念：

```md
- 工程加载态
- 引擎忙碌态
- 任务快照
- 事件 topic / event payload
- 单一来源
- 单一写入口
- 冻结快照与跨线程载荷
```

`invariants.md` 至少明确这些不变量：

```md
- 同一业务语义的数据只允许一个权威来源
- 状态变更只能发生在负责该数据的模块内
- 后台线程不得直接操作 UI
- 组件间通信使用 Base.emit / Base.subscribe
- 用户可见文本必须走 Localizer
- 外部读写项目数据只认 DataManager
```

- [ ] **Step 3: 编写 `code-map.md`**

至少建立下面这些问题到入口文件的映射表：

```md
| 问题类型 | 先看文件 |
| --- | --- |
| 应用启动与退出 | `app.py` |
| 事件与全局状态 | `base/Base.py` `base/EventManager.py` |
| 项目加载与数据读写 | `module/Data/DataManager.py` |
| 引擎任务调度 | `module/Engine/Engine.py` |
| 文件导入导出 | `module/File/FileManager.py` |
| 本地化文本 | `module/Localizer/LocalizerZH.py` `module/Localizer/LocalizerEN.py` |
| 本地 API / SSE | `api/SPEC.md` |
```

- [ ] **Step 4: 校验四篇 overview 文档的交叉引用**

执行：

```powershell
rg -n "api/SPEC.md|docs/modules|DataManager|Engine.py|Localizer" docs/overview
```

预期：

- 四篇文档都出现了实际代码路径或新文档跳转
- `code-map.md` 明确引用 `api/SPEC.md`

- [ ] **Step 5: 提交 overview 厚写文档**

```bash
git add docs/overview
git commit -m "docs: add overview context docs"
```

### 任务 3：编纂 `base` 与 `data` 模块厚写文档，并处理旧 `module/Data/spec.md`

**文件：**
- 修改：
  - `E:/Project/LinguaGacha/docs/modules/base.md`
  - `E:/Project/LinguaGacha/docs/modules/data.md`
  - `E:/Project/LinguaGacha/module/Data/spec.md`
- 参考：
  - `E:/Project/LinguaGacha/base/Base.py`
  - `E:/Project/LinguaGacha/base/BasePath.py`
  - `E:/Project/LinguaGacha/base/EventManager.py`
  - `E:/Project/LinguaGacha/base/LogManager.py`
  - `E:/Project/LinguaGacha/base/CLIManager.py`
  - `E:/Project/LinguaGacha/base/VersionManager.py`
  - `E:/Project/LinguaGacha/module/Data/DataManager.py`
  - `E:/Project/LinguaGacha/module/Data/spec.md`

- [ ] **Step 1: 编写 `docs/modules/base.md`**

文档至少包含以下模块画像信息：

```md
## 1. 模块职责
- `base/` 提供事件、状态、日志、路径、CLI、版本等全局基础设施

## 2. 权威入口
- `Base.py`
- `BasePath.py`
- `EventManager.py`
- `LogManager.py`
- `CLIManager.py`
- `VersionManager.py`

## 3. 不负责什么
- 不承载具体业务规则
- 不直接持有项目业务数据

## 4. 长期约束
- 事件通信通过基础事件机制完成
- 日志统一走 `LogManager`
```

- [ ] **Step 2: 把旧 `module/Data/spec.md` 的有效内容吸收进 `docs/modules/data.md`**

`docs/modules/data.md` 至少要把下列现有内容收口进去：

```md
- 一句话总览：外部只能通过 `DataManager` 读写项目数据
- 阅读顺序：先 `DataManager.py`，再按业务线深入
- 目录结构：Core / Storage / Project / Quality / Analysis / Translation
- 对外规则：外部模块只依赖 `DataManager`
- 对内规则：`ProjectSession`、`LGDatabase`、各 service 的职责分工
- 常见任务到入口文件的最短定位
- 最容易踩坑的地方
```

同时新增一节“与新文档体系的关系”，明确：

```md
- 系统级概念看 `docs/overview/core-concepts.md`
- 长期约束看 `docs/overview/invariants.md`
- 本文只负责 `module/Data` 的模块画像
```

- [ ] **Step 3: 将 `module/Data/spec.md` 收口为跳转说明**

把旧文件改成短说明，内容控制在一个小节内，例如：

```md
# `module/Data` 规范说明

`module/Data` 的长期模块画像已经迁移到 `docs/modules/data.md`。

- 查看模块职责、入口、边界：`docs/modules/data.md`
- 查看系统级概念：`docs/overview/core-concepts.md`
- 查看长期不变量：`docs/overview/invariants.md`
```

- [ ] **Step 4: 校验数据层权威位置是否收口**

执行：

```powershell
rg -n "外部只能通过 `DataManager`|ProjectSession|LGDatabase|docs/modules/data.md" docs/modules/data.md module/Data/spec.md
```

预期：

- `docs/modules/data.md` 包含数据层核心规则与职责
- `module/Data/spec.md` 只剩跳转说明，不再保留完整双份内容

- [ ] **Step 5: 提交 `base` / `data` 文档与旧 spec 迁移**

```bash
git add docs/modules/base.md docs/modules/data.md module/Data/spec.md
git commit -m "docs: migrate data module context docs"
```

### 任务 4：编纂剩余模块文档与专题 references 文档

**文件：**
- 修改：
  - `E:/Project/LinguaGacha/docs/modules/frontend.md`
  - `E:/Project/LinguaGacha/docs/modules/engine.md`
  - `E:/Project/LinguaGacha/docs/modules/file.md`
  - `E:/Project/LinguaGacha/docs/modules/localizer.md`
  - `E:/Project/LinguaGacha/docs/references/ui-framework.md`
  - `E:/Project/LinguaGacha/docs/references/localization-rules.md`
  - `E:/Project/LinguaGacha/docs/references/resource-layout.md`
- 参考：
  - `E:/Project/LinguaGacha/frontend/AppFluentWindow.py`
  - `E:/Project/LinguaGacha/module/Engine/Engine.py`
  - `E:/Project/LinguaGacha/module/File/FileManager.py`
  - `E:/Project/LinguaGacha/module/Localizer/LocalizerZH.py`
  - `E:/Project/LinguaGacha/module/Localizer/LocalizerEN.py`
  - `E:/Project/LinguaGacha/base/BaseIcon.py`

- [ ] **Step 1: 编写四篇薄写模块文档**

每篇至少包含这四个固定小节：

```md
## 1. 模块职责
## 2. 权威入口
## 3. 长期边界
## 4. 相关跳转
```

具体最低内容要求：

```md
- frontend.md：`AppFluentWindow.py` 是总导航入口；页面目录分布；UI 不直接碰 Core 单例的边界
- engine.md：`Engine.py` 是总入口；任务类型入口；与 Data / API / 前端的关系
- file.md：`FileManager.py` 是统一读写入口；工程文件改动优先走 DataManager / ProjectFileService
- localizer.md：所有用户可见文本走 Localizer；ZH / EN 行数保持一致；动态获取方式
```

- [ ] **Step 2: 编写三篇 references 文档**

每篇至少包含“适用范围、硬规则、权威源文件、相关跳转”四个部分，其中：

```md
- ui-framework.md：qfluentwidgets 优先、亮暗主题适配、线程与 UI 隔离、事件总线通信
- localization-rules.md：文本不得硬编码、优先复用现有词条、双语文件同步维护
- resource-layout.md：图标优先 `base/BaseIcon.py`，其他美术资源放 `resource/`
```

- [ ] **Step 3: 校验模块文档与 references 文档没有职责重叠**

执行：

```powershell
rg -n "^## 1\\. 模块职责|^## 2\\. 权威入口|qfluentwidgets|Localizer|BaseIcon" docs/modules docs/references
```

预期：

- `docs/modules/*.md` 都有统一结构
- `docs/references/*.md` 写的是规则，不是模块画像

- [ ] **Step 4: 提交剩余模块与 references 文档**

```bash
git add docs/modules/frontend.md docs/modules/engine.md docs/modules/file.md docs/modules/localizer.md docs/references
git commit -m "docs: add module and reference context docs"
```

### 任务 5：编纂 generated 索引文档并完成全局一致性收口

**文件：**
- 修改：
  - `E:/Project/LinguaGacha/docs/generated/entrypoints.md`
  - `E:/Project/LinguaGacha/docs/generated/event-index.md`
  - `E:/Project/LinguaGacha/docs/generated/test-map.md`
  - `E:/Project/LinguaGacha/docs/overview/runtime-topology.md`
- 参考：
  - `E:/Project/LinguaGacha/base/Base.py`
  - `E:/Project/LinguaGacha/base/EventManager.py`
  - `E:/Project/LinguaGacha/tests`
  - `E:/Project/LinguaGacha/api/SPEC.md`

- [ ] **Step 1: 编写 `entrypoints.md`**

至少包含下面这张索引表：

```md
| 问题类型 | 入口文件 |
| --- | --- |
| 应用启动 | `app.py` |
| 全局事件与状态 | `base/Base.py` `base/EventManager.py` |
| 数据层 | `module/Data/DataManager.py` |
| 引擎 | `module/Engine/Engine.py` |
| 文件读写 | `module/File/FileManager.py` |
| 本地 API | `api/SPEC.md` |
```

- [ ] **Step 2: 编写 `event-index.md` 与 `test-map.md`**

`event-index.md` 至少列出：

```md
| 主题或事件 | 主要发送者 | 主要消费者 | 备注 |
| --- | --- | --- | --- |
| `PROJECT_LOADED` 或对应工程加载事件 | `DataManager` | 前端页面 | 项目加载态变化 |
| `QUALITY_RULE_UPDATE` | `DataManager` | 质量/校对相关页面 | 规则变更 |
| `task.status_changed` | API / 状态桥接层 | 前端页面 | 任务状态 |
```

`test-map.md` 至少列出：

```md
| 模块 | 优先测试目录或文件 |
| --- | --- |
| `frontend` | `tests/frontend/` |
| `module/Data` | `tests/module/data/` |
| `api` | `tests/api/` |
```

- [ ] **Step 3: 薄写 `runtime-topology.md` 并完成全局交叉链接检查**

`runtime-topology.md` 至少写明：

```md
- GUI 模式由 `app.py` 启动应用与本地 API 线程
- CLI 模式不启动本地 API 服务
- 后台线程不直接操作 UI
- 详细 API 契约看 `api/SPEC.md`
```

执行：

```powershell
rg -n "api/SPEC.md|docs/overview|docs/modules|docs/references|docs/generated" docs AGENTS.md
```

预期：

- 新旧文档之间形成稳定跳转
- `api/SPEC.md` 只被引用，不被重复复制

- [ ] **Step 4: 做全局 diff 自审并提交最终文档集合**

执行：

```powershell
git diff --stat
```

预期：

- 只包含本次目标文档与 `AGENTS.md`、`module/Data/spec.md`
- 没有意外改动到业务代码

提交：

```bash
git add AGENTS.md docs module/Data/spec.md
git commit -m "docs: complete agent precontext doc system"
```

## 自审清单

- [ ] 设计 spec 中要求的四类目录都已建立
- [ ] 六篇厚写文档都已达到“无需翻太多源码也能先建立模型”的标准
- [ ] `api/SPEC.md` 未被迁移，只被引用
- [ ] `module/Data/spec.md` 已不再与 `docs/modules/data.md` 双份竞争权威
- [ ] 所有文档都包含真实代码路径，不写空泛口号
- [ ] 所有文档都明确区分“系统事实”和“任务步骤”

## 执行备注

- 若执行过程中发现某篇薄写文档在真实阅读后已经具备厚写条件，可以在对应任务内直接加厚，但不要扩展到本计划之外的新专题。
- 若发现新的 `SPEC.md`，先按“局部契约型 / 前置上下文型”分类，再决定是否纳入本计划。
