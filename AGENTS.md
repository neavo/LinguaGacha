# LinguaGacha Agent Guidelines
本文档用于约束在本仓库工作的 Agent 的行为、命令与代码风格

## 1. 项目背景
- **简介**: 基于 LLM 的次世代视觉小说、电子书及字幕翻译工具
- **技术栈**: Python 3.14, PySide6, PySide6-Fluent-Widgets

## 2. 核心原则（严格遵循）
1. **第一性原理**: 先搞清楚数据流/不变量/模块边界，再实际手动实现任务目标
2. **KISS & YAGNI**: 保持简单，拒绝过度设计，除非必要，避免防御性编程
3. **正交数据流**: 每类数据必须有唯一来源与唯一写入入口，跨模块只通过显式接口/事件交换，**禁止跨线程/跨模块传递可变对象的引用**

## 3. 环境与指令
### 3.1 安装与运行
所有指令必须通过 uv 执行
- **安装依赖**: `uv sync`
- **升级依赖**: `uv sync -U`
- **启动应用**: `uv run app.py`

### 3.2 Lint & Format
用 Ruff 做 lint + format + import 排序，改哪扫哪，勿扩大范围
- `uv run ruff check --fix <file_path>`
- `uv run ruff format <file_path>`

### 3.3 自动化测试
- **安装依赖**: `uv sync --extra test`
- **详细规范**: 使用技能 `pytest-ruler`

## 4. 代码规范
### 4.1 注释
- 所有类、方法以及关键逻辑 **必须** 写注释解释 **为什么**
- **优先** 使用 `# …` 形式的注释

### 4.2 控制流
优先使用显式的 `if-else` 结构以保持逻辑清晰易读，当嵌套超过两层时优先使用 `elif` 拉平分支结构

### 4.3 DRY
重复 < 3 次可接受（可读性 > 抽象），仅在重复 >= 3 次时提取函数

### 4.4 命名规范
- **通用**: 遵循现有文件风格，默认 `snake_case`
- **禁止首位下划线**: 不要用 `_get_data`、`_internal_method`、`_data`
- **类**: `PascalCase`（如 `AppFluentWindow`）
- **常量**: `UPPER_SNAKE_CASE`（如 `Base.Event.PROJECT_LOADED`）
- **禁止魔术值**: 用常量或枚举（如 `StrEnum`）代替字符串/数字

### 4.5 类型提示
- **强制**: 所有函数必须标注参数/返回值类型，类/实例属性与 `@dataclass` 字段必须标注类型
- **局部变量**: 在类型不明显或能明显提升可读性时标注
- **第三方/动态类型**: 仅当第三方库确实缺少类型信息时，才允许用 `Any` / `cast()` / `Protocol` 兜底
- **现代语法**: 优先 `A | None`、`list[str]`，少用 `Optional[A]`、`List[str]`
- **数据载体**: 优先用 `dataclasses`，跨线程传递用 `@dataclass(frozen=True)`

### 4.6 错误处理与日志
- **日志接口**: 统一使用 `LogManager.get().debug/info/warning/error(msg, e)` 记录日志
- **记录异常**: 需记录异常时，必须将 `e` 传入日志方法以自动提取堆栈；禁止手动 `traceback.format_exc()`
- **静默忽略**: 仅对"预期且无害"的情况允许 `except: pass`（不记录日志），但必须注释说明原因
- **致命异常**: 不可恢复的异常无需捕获，直接冒泡由顶层机制统一记录堆栈并退出
- **级别选择**: `error` 用于影响功能的错误；`warning` 用于可恢复/降级场景；`info` 用于正常流程
- **异常链**: 需要包装语义时用 `raise … from e` 保留原始堆栈

### 4.7 前端开发
- **UI 库**: 尽可能使用 `qfluentwidgets` 组件
- **主题适配**: 必须支持亮/暗主题，避免硬编码颜色
- **多线程**: UI 耗时操作必须放在 `threading.Thread`
- **线程与 UI**: 后台线程不要直接操作 UI，通过事件总线回到 UI 层刷新
- **组件通信**: 组件间通信必须使用事件总线（`Base.emit` / `Base.subscribe`）
- **资源管理**: 图标优先使用 `base/BaseIcon.py`，其他美术资源放 `resource/` 并通过配置或相对路径引用

### 4.8 本地化 `module/Localizer`
- **禁止硬编码**: 所有用户可见的界面文本（Toast/Dialog/界面文案）必须在 `Localizer**.py` 中定义
- **行数对齐**: 修改时必须保持 ZH、EN 文件行数一致
- **动态获取**: 使用 `Localizer.get().your_variable_name`
- **优先复用**: 优先复用全局通用文本或相近语义的文本

### 4.9 正交数据流
- **单一来源**: 同一业务语义的数据只允许一个权威来源
- **单一写入**: 状态变更只能发生在负责该数据的模块内，调用方只能通过公开 API/事件请求变更
- **跨模块载荷**: 事件/回调只传 `id` 或不可变快照，禁止传递可变对象引用

### 4.10 模块级符号
- 模块对外只暴露"类"，常量/枚举等应设计为类属性

### 4.11 标准库优先
- 优先使用标准库内置方法，仅在标准库无法满足业务需求时允许自行实现或使用第三方库

## 5. 核心模块说明
### 5.1 事件系统 `base/Base.py`
应用通过 `EventManager` 实现组件解耦：
```python
# 发送事件
self.emit(Base.Event.TRANSLATION_DONE, {"result": "success"})
# 订阅事件
self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
```

### 5.2 存储系统 `module/Data`
- **DataManager**: 数据单例入口，负责 `load_project` / `unload_project` / `open_db` / `close_db`
- **ProjectSession**: 会话状态的单一来源，禁止跨模块共享可变对象引用
- **LGDatabase**: `.lg` 的 SQLite 访问类（schema + SQL + 序列化）
- **批量写入**: 统一走 `DataManager.update_batch(…)`

### 5.3 文件处理 `module/File`
- **FileManager**: 统一的文件读写入口

### 5.4 配置系统 `module/Config.py`
- 应用配置的单一来源，通过 `Config.get()` 获取

## 6. 项目结构
```
app.py              # 应用入口
base/               # 核心基类、事件、日志管理
  Base.py           # 事件枚举、状态枚举、基类方法
  EventManager.py   # 事件总线实现
  LogManager.py     # 日志管理
frontend/           # UI 页面实现
  AppFluentWindow.py
  Translation/      # 翻译相关页面
  Setting/          # 设置相关页面
module/             # 业务模块
  Config.py         # 配置管理
  Data/             # 数据存储
  Engine/           # 翻译引擎
  File/             # 文件处理
  Localizer/        # 多语言
tests/              # 自动化测试
widget/             # 自定义控件
resource/           # 静态资源
  preset/           # 内置翻译提示词、术语表等预设
```

## 7. 工作流程
1. **理解需求**: 定位相关逻辑或 UI 页面
2. **分析流向**: 查看继承关系、事件监听，理解数据流向和业务逻辑
3. **实施变更**: 按计划逐步完成任务，每完成一个步骤立即更新任务进度状态
4. **代码审查**: 完成变更后，审视代码差异 (Diff)，检查逻辑正确性与潜在隐患
5. **测试验证**: 运行 `uv run pytest` 验证自动化测试，GUI 逻辑列出最小手动测试路径
6. **格式与检查**（仅对有业务变更的文件）：
   - 使用 Ruff 检查和格式化代码
   - 检查与修正函数、变量的命名规范
   - 清理冗余的空行、代码、注释、本地化字段等
