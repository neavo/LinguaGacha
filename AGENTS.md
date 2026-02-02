# LinguaGacha Agent Guidelines
本文档用于约束在本仓库工作的 Agent 的行为、命令与代码风格

## 1. 项目背景
- **简介**: 基于 LLM 的次世代视觉小说、电子书及字幕翻译工具
- **技术栈**: Python 3.14, PyQt5, PyQt-Fluent-Widgets

## 2. 核心原则
1. **第一性原理**: 立足于第一性原理剖析问题，善用工具以提升效率
2. **事实为准**: 即使用户建议与事实不符，也必须以事实为准，坦率指出
3. **KISS & YAGNI**: 保持简单，拒绝过度设计，除非必要，避免防御性编程
4. **正交数据流**: 每类数据必须有唯一来源与唯一写入入口，跨模块只通过显式接口/事件交换，禁止共享可变状态或互相读写内部字段

## 3. 环境与指令
所有指令必须通过 `uv` 执行
### 3.1 安装与运行
- **安装依赖**: `uv sync`
- **升级依赖**: `uv sync -U`
### 3.2 Lint&Format
用 Ruff 做 lint + format + import 排序，改哪扫哪，勿扩大范围
- `uv run ruff check --fix <file_path>`
- `uv run ruff format <file_path>`
注意：
- `pyproject.toml` 配置 `extend-exclude = ["module/Localizer/"]`，Localizer 文件不会被 Ruff 正常约束
- `pyproject.toml` 配置 `quote-style = "double"`
- `pyproject.toml` 配置 `isort.force-single-line = true`

## 4. 代码规范
### 4.1 注释
关键逻辑 **必须** 写单行注释解释 **为什么**，而不是做什么
### 4.2 控制流
避免深层嵌套，**优先使用 Early Returns**
### 4.3 DRY
重复 < 3 次可接受（可读性 > 抽象），仅在重复 ≥ 3 次时提取函数
### 4.4 命名规范
- **通用**: 遵循现有文件风格，默认 `snake_case`
- **禁止**: **首位下划线** 命名函数或变量
  - ❌ `_get_data`, `_internal_method`, `_data`
  - ✅ `get_user_profile`, `fetch_status`, `__init__`
- **类**: `PascalCase`（如 `AppFluentWindow`）
- **常量**: `UPPER_SNAKE_CASE`（如 `Base.Event.PROJECT_LOADED`）
- **禁止魔术值**: 用常量或枚举（如 `StrEnum`）代替字符串/数字
### 4.5 类型提示
- **强制**: 所有函数必须标注参数/返回值类型，类/实例属性与 `@dataclass` 字段必须标注类型
- **局部变量**: 在类型不明显或能明显提升可读性时标注（复杂容器、`Optional/Union`、跨线程/跨模块载荷）
- **第三方/动态类型**: 缺少类型信息时允许用 `Any` / `cast()` / `Protocol` 做最小范围标注，优先现代类型语法（如 `A | None`、`list[str]`）
- 数据载体优先用 `dataclasses`，跨线程/跨模块传递优先用 `@dataclass(frozen=True)` 作为不可变快照
### 4.6 错误处理与日志
- 捕获异常时必须保留堆栈：`self.error("Message", e)` 或 `LogManager.get().error("Message", e)`
- 默认不要用内置 `print()`，统一走 `Base`/`LogManager`（CLI 退出倒计时、崩溃兜底等极少数入口可例外）
- 不要捕获 `BaseException`，默认只捕获 `Exception`（让 `KeyboardInterrupt` 等中断信号自然冒泡）
- 不要吞异常，如需降级处理，至少记录一次 error/warning
### 4.7 Imports
- 每个 import 单独一行
### 4.8 前端开发
- **UI 库**: 尽可能使用 `qfluentwidgets` 组件
- **主题适配**: 必须支持亮/暗主题，避免硬编码颜色
- **多线程**: UI 耗时操作必须放在 `threading.Thread`
- **线程与 UI**: 后台线程不要直接操作 UI，通过事件总线回到 UI 层刷新
- **通信**: 组件间通信必须使用事件总线（`Base.emit` / `Base.subscribe`）
- **资源管理**: UI 图片、图标统一放 `resource/` 并通过配置或相对路径引用
### 4.9 本地化 `module/Localizer`
- **禁止硬编码**: 除 `argparse` 的 help/usage 等 CLI 元信息外，所有用户可见的日志与界面文本必须在 `Localizer**.py` 中定义
- **行数对齐**: 修改时必须保持 ZH、EN 文件行数一致
- **动态获取**: 使用 `Localizer.get().your_variable_name`
- **优先复用**: 优先复用全局通用文本或者相同模块下相近语义的文本，避免重复定义
### 4.10 正交数据流
- **单一来源**: 同一业务语义的数据只允许一个权威来源，其他位置只能缓存或派生，且必须可由来源确定性重建
- **单一写入**: 状态变更只能发生在负责该数据的模块/服务内，调用方只能通过公开 API/事件请求变更
- **跨模块载荷**: 事件/回调只传 `id` 或不可变快照，禁止传递可变对象引用、线程/文件句柄、数据库连接等
### 4.11 模块级符号
- 模块对外只暴露“类 + 必要类型定义”，常量/枚举等应设计为类属性
- ✅ 纯定义/只读元信息（`Enum/StrEnum`、`dataclass`、type alias、异常、`Protocol`、`__all__`、`__version__`）
- ❌ 模块级可变状态（缓存/锁/单例实例/连接/句柄等）与长期对外工具函数
- **例外**: 入口/纯函数（`main`、`excepthook` 等）允许模块级，必须无副作用，并在附近用单行注释说明“为什么”
### 4.12 缓存
- 优先使用 `functools.lru_cache` / `functools.cache` / `functools.cached_property`
- 缓存必须可控增长且可清理，生命周期应绑定到会话/任务/实例
- key 必须不可变；资源型对象必须有显式释放路径

## 5. 核心模块说明
### 5.1 事件系统 `base/Base.py`
应用通过 `EventManager` 实现组件解耦：
- **新增事件**: 在 `Base.Event` 枚举中定义
- **使用示例**:
```python
self.emit(Base.Event.TRANSLATION_DONE, {"result": "success"})
self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
```
### 5.2 存储系统 `module/Data`
- **DataManager**: 数据单例入口（唯一对外入口），负责 `load_project` / `unload_project` / `open_db` / `close_db`，并委派到各 `*Service`
- **ProjectSession**: 会话状态（`db` / `lg_path` / 锁 / 缓存）的单一来源，禁止跨模块共享可变对象引用
- **LGDatabase**: `.lg` 的 SQLite 访问类（schema + SQL + 序列化）；表包含 `meta` / `assets` / `items` / `rules`
- **数据形态**: `meta`/`rules`/`items` 以 JSON 文本存储（`ensure_ascii=False`），`assets` 以 Zstd 压缩 BLOB 存储并提供解压缓存
- **批量写入**: 需要事务一致性的更新统一走 `DataManager.update_batch(...)`（单次事务 commit，避免分散写入导致缓存与事件不同步）
- **翻译期连接**: 翻译期间调用 `open_db()` 开启长连接/WAL，结束 `close_db()` 触发 checkpoint 清理；非翻译期按需短连接读写
### 5.3 文件处理 (`module/File`)
- **FileManager**: 统一的文件读写入口

## 6. 工作流程
1. 理解需求：定位相关逻辑或 UI 页面
2. 分析流向：查看继承关系、事件监听，理解数据流向和业务逻辑
3. 实施变更：按计划逐步完成任务，每完成一个步骤立即更新任务进度状态
4. 代码审查：完成变更后，审视代码差异 (Diff)，检查逻辑正确性与潜在隐患
5. 测试验证：
- **脚本优先**: 不依赖 GUI 的逻辑编写验证脚本并执行验证，仅当无法脚本化时才允许手动验证
- **手动兜底**: 对依赖 GUI 的逻辑，列出最小手动测试路径与期望结果（页面/按钮/输入/输出）
6. 格式与检查（仅对有业务变更的文件）：
- 使用 Ruff 检查和格式化代码
- 检查与修正函数、变量的命名规范
- 清理冗余的空行、代码、注释、本地化字段等

## 7. 常用文件路径
- `app.py`: 应用入口
- `base/Base.py`: 核心基类、事件定义、任务状态
- `module/`: 业务模块
- `frontend/`: 页面实现
- `widget/`: 自定义控件
- `resource/preset/`: 内置翻译提示词、术语表等预设
