# LinguaGacha Agent Guidelines
本文档用于约束在本仓库工作的 Agent 的行为、命令与代码风格，**必须严格遵循**

## 0. 文档入口
- 仓库结构、模块关系与阅读路径：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 前端页面结构、入口与状态约束：[`docs/FRONTEND.md`](docs/FRONTEND.md)
- 文档体系规则、命名与互链规范：[`docs/DOCS.md`](docs/DOCS.md)

## 1. 项目背景
- **简介**: 基于 LLM 的次世代视觉小说、电子书及字幕翻译工具
- **技术栈**: Python 3.14, PySide6, PySide6-Fluent-Widgets

## 2. 核心原则
- **第一性原理**: 先搞清楚数据流/不变量/模块边界/使用场景，再实际手动实现任务目标
- **KISS & YAGNI**: 保持简单，避免过度封装，避免防御性编程，避免保留兼容层，确有必要时必须先征得用户确认
- **正交数据流**: 每类数据必须有唯一来源与唯一写入入口，跨模块只通过显式接口/事件交换，**禁止跨线程/跨模块传递可变对象的引用**

## 3. 环境与指令
- **依赖安装**：`uv sync -U --extra test`
- **启动应用**: `uv run app.py`
- **代码检查**: `uv run ruff format <file_path>` `uv run ruff check --fix <file_path>`

## 4. 代码规范
### 4.1 注释
使用 `# …` 形式的注释，所有类、方法以及关键逻辑 **必须写注释解释为什么**

### 4.2 控制流
使用显式的 `if-else` 结构以保持逻辑清晰易读，当选择枝嵌套时则 `elif` 拉平分支结构，避免使用早回

### 4.3 命名规范
- **通用**: 遵循现有文件风格，默认 `snake_case`
- **禁止首位下划线**: 不要用 `_get_data`、`_internal_method`、`_data`
- **类**: `PascalCase`（如 `AppFluentWindow`）
- **常量**: `UPPER_SNAKE_CASE`（如 `Base.Event.PROJECT_LOADED`）
- **禁止魔术值**: 用常量或枚举（如 `StrEnum`）代替字符串/数字

### 4.4 类型提示
- **强制**: 所有函数必须标注参数/返回值类型，类/实例属性与 `@dataclass` 字段必须标注类型
- **局部变量**: 在类型不明显或能明显提升可读性时标注
- **第三方/动态类型**: 仅当第三方库确实缺少类型信息时，才允许用 `Any` / `cast()` / `Protocol` 兜底
- **现代语法**: 优先 `A | None`、`list[str]`，少用 `Optional[A]`、`List[str]`
- **数据载体**: 优先用 `dataclasses`，跨线程传递用 `@dataclass(frozen=True)`

### 4.5 错误处理与日志
- **日志接口**: 统一使用 `LogManager.get().debug/info/warning/error(msg, e)` 记录日志
- **记录异常**: 需记录异常时，必须将 `e` 传入日志方法以自动提取堆栈；禁止手动 `traceback.format_exc()`
- **静默忽略**: 仅对"预期且无害"的情况允许 `except: pass`（不记录日志），但必须注释说明原因
- **致命异常**: 不可恢复的异常无需捕获，直接冒泡由顶层机制统一记录堆栈并退出
- **级别选择**: `error` 用于影响功能的错误；`warning` 用于可恢复/降级场景；`info` 用于正常流程
- **异常链**: 需要包装语义时用 `raise … from e` 保留原始堆栈

### 4.6 前端开发
- **UI 库**: 尽可能使用 `qfluentwidgets` 组件
- **主题适配**: 必须支持亮/暗主题，避免硬编码颜色
- **多线程**: UI 耗时操作必须放在 `threading.Thread`
- **线程与 UI**: 后台线程不要直接操作 UI，通过事件总线回到 UI 层刷新
- **组件通信**: 组件间通信必须使用事件总线（`Base.emit` / `Base.subscribe`）
- **资源管理**: 图标优先使用 `base/BaseIcon.py`，其他美术资源放 `resource/` 并通过配置或相对路径引用

### 4.7 本地化 `module/Localizer`
- **禁止硬编码**: 所有用户可见的界面文本（Toast/Dialog/界面文案）必须在 `Localizer**.py` 中定义
- **行数对齐**: 修改时必须保持 ZH、EN 文件行数一致
- **动态获取**: 使用 `Localizer.get().your_variable_name`
- **优先复用**: 优先复用全局通用文本或相近语义的文本

### 4.8 正交数据流
- **单一来源**: 同一业务语义的数据只允许一个权威来源
- **单一写入**: 状态变更只能发生在负责该数据的模块内，调用方只能通过公开 API/事件请求变更
- **跨模块载荷**: 事件/回调只传 `id` 或不可变快照，禁止传递可变对象引用

### 4.9 模块级符号
- 模块对外只暴露"类"，常量/枚举等应设计为类属性

### 4.10 标准库优先
- 优先使用标准库内置方法，仅在标准库无法满足业务需求时允许自行实现或使用第三方库

## 5. 核心模块说明
### 5.1 应用入口 `app.py`
- 先看这里理解应用怎么启动、怎么在 GUI / CLI 之间分流，以及退出时怎么清理工程状态

### 5.2 基础设施 `base`
- `Base.py` 看事件、状态和基础能力
- `BasePath.py` 负责解析运行时路径
- `EventManager.py` 看事件怎么传
- `LogManager.py` 看日志怎么记
- `CLIManager.py` / `VersionManager.py` 看命令行和更新相关入口

### 5.3 前端层 `frontend`
- `AppFluentWindow.py` 是总导航入口
- 具体功能页按目录找：`Project`、`Model`、`Translation`、`Analysis`、`Proofreading`、`Workbench`、`Quality`、`Setting`、`Extra`
- 看页面逻辑时，顺手确认工程加载态和引擎忙碌态会不会影响按钮、跳转和只读状态

### 5.4 数据层 `module/Data`
- 外部只认 `DataManager`
- 读到 `DataManager` 后，再按领域继续找 `Project / Quality / Analysis / Translation`
- 如果问题涉及缓存、会话状态或 SQL，再往 `Core / ProjectSession / LGDatabase` 深挖

### 5.5 任务引擎 `module/Engine`
- 先看 `Engine.py`，再按任务类型进 `APITest / Analysis / Translation`
- 看到调度、限流、请求发送、生命周期问题时，再看 `Task*` 系列模块

### 5.6 文件层 `module/File`
- `FileManager.py` 是统一读写入口
- 具体格式支持到对应实现里找
- 工程内文件增删改优先看 `DataManager` 和 `ProjectFileService`，不要直接绕开数据层

### 5.7 配置与本地化 `module/Config.py` / `module/Localizer`
- `Config` 是配置单一来源
- `Localizer` 是界面文案单一入口
- 只要改了用户可见文本，就同步检查 `LocalizerZH.py` 和 `LocalizerEN.py`

## 6. 项目结构
```
app.py                 # 应用入口
base/                  # 事件、日志、版本、CLI 等基础设施
frontend/              # 各页面 UI
  Project / Model / Translation / Analysis / Proofreading
  Workbench / Quality / Setting / Extra
module/                # 业务主逻辑
  Data / Engine / File / Localizer
  Filter / Fixer / QualityRule / Response / Text / Utils
model/                 # 数据模型
widget/                # 通用控件
resource/              # 图标、预设、提示词模板、更新脚本
buildtools/            # 构建和辅助脚本
tests/                 # 自动化测试
```

## 7. 工作流程
1. **理解需求**: 定位相关逻辑或 UI 页面
2. **分析流向**: 查看继承关系、事件监听，理解数据流向和业务逻辑
3. **实施变更**: 按计划逐步完成任务，每完成一个步骤立即更新任务进度状态；如果判断必须保留兼容层，必须先在计划中明确写出必要性、影响范围与后续清理方案，并在实施前得到用户确认
4. **代码审查**: 完成变更后，审视代码差异 (Diff)，检查逻辑正确性与潜在隐患
5. **测试验证**: 运行 `uv run pytest` 验证自动化测试，GUI 逻辑列出最小手动测试路径
6. **格式与检查**（仅对有业务变更的文件）：
   - 使用 Ruff 检查和格式化代码
   - 检查与修正函数、变量、常量命名
   - 清理冗余空行、死代码、无效注释与未使用的本地化字段
