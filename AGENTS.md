# LinguaGacha Agent Guidelines
本文档定义了 LinguaGacha 仓库 AI Agent 的操作标准、代码风格和工作流，专为 AI Agent 设计，请严格遵守

## 1. 项目背景
- **简介**: 基于 LLM 的次世代视觉小说、电子书及字幕翻译工具
- **技术栈**: Python 3.12, PyQt5, PyQt-Fluent-Widgets
- **包管理**: `uv` (Python package and project manager)
- **语言规则**: **所有** 注释、思考过程及沟通 **必须使用简体中文**

## 2. 环境与指令
所有指令必须通过 `uv` 执行
### 安装与运行
- **安装依赖**: `uv sync -U`
- **运行应用**: `uv run app.py`
### 质量控制 (强制)
结束任务前 **必须且仅对有实际业务逻辑变化的文件** 进行检查和修复
- **Lint & Fix**: `uv run ruff check --fix`
- **Format**: `uv run ruff format`
### 自动化测试
- **测试建议**: 对于复杂的业务逻辑，建议编写 unit tests 验证

## 3. 核心原则
1. **第一性原理**: 立足于第一性原理剖析问题，善用工具以提升效率
2. **事实为准**: 以事实为最高准则，若发现规则或代码有误，请坦率承认并修正
3. **KISS & YAGNI**: 保持简单，拒绝过度设计，除非必要，避免防御性编程
4. **清理**: 冗余的空行、代码、注释、未使用的本地化字段或其他不再需要的资源应立即清理

## 4. 代码规范
### 注释: 关键逻辑 **必须** 写单行注释解释 **为什么** (Why) 而不仅仅是做什么 (What)
### 控制流: 避免深层嵌套，**优先使用 Early Returns**
### DRY: 代码重复 < 3 次可接受（可读性 > 抽象），仅在重复 ≥ 3 次时提取函数
### 命名规范
- **通用**: 遵循现有文件风格，默认使用 `snake_case`
- **禁止**: **严禁** 使用 **首位下划线** 命名函数或变量
  - ❌ `_get_data`, `_internal_method`, `data`, `info`
  - ✅ `get_user_profile`, `fetch_status`, `__init__`
- **类**: `PascalCase` (如 `AppFluentWindow`)
- **常量**: `UPPER_SNAKE_CASE` (如 `Base.Event.PROJECT_LOADED`)
- **拒绝魔术值**: 使用常量或枚举 (如 `StrEnum`) 代替原始字符串/数字
### 类型提示与异常
- **Type Hints**: 所有函数参数和返回类型 **必须** 标注类型
- **异常处理**: 捕获异常时，必须记录堆栈信息：`self.error("Message", e)`
- **日志输出**: **严禁** 使用 `print()`，必须使用 `LogManager` 或继承自 `Base` 的日志方法
### 前端开发 (PyQt5)
- **UI 库**: 尽可能使用 `qfluentwidgets` 组件
- **主题适配**: 必须支持亮/暗主题，使用 `FluentStyleSheet` 管理样式，禁止硬编码颜色
- **多线程**: UI 耗时操作（如 IO、请求）必须放在 `threading.Thread` 中执行，避免界面卡死
- **通信**: 组件间通信必须使用事件总线 (`Base.emit` / `Base.subscribe`)
- **资源管理**: UI 图片、图标应统一放置在 `resource/` 目录下，并通过 `Config` 或相对路径引用

## 5. 核心模块说明
### 事件系统 (`base/Base.py`)
应用通过 `EventManager` 实现组件解耦
- **新增事件**: 在 `Base.Event` 枚举中定义
- **使用示例**:
  ```python
  # 触发事件
  self.emit(Base.Event.TRANSLATION_DONE, {"result": "success"})
  # 订阅事件
  self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
  ```
### 存储系统 (`module/Storage`)
- **StorageContext**: 管理当前加载的工程 (`.lg` 文件) 的单例，是访问数据库的唯一入口
- **DataStore**: SQLite 持久化层。翻译开始时调用 `db.open()` 开启 WAL 模式以提升性能，结束后务必 `db.close()`
- **Meta 数据**: 使用 `db.get_meta` / `db.set_meta` 存储项目级配置（如进度、状态）
- **Items 数据**: 核心翻译条目存储在 `items` 表中
### 本地化 (`module/Localizer`)
- **禁止硬编码**: 所有日志与界面文本必须在 `Localizer**.py` 中定义
- **行数对齐**: 修改时必须保持 ZH、EN 文件行数一致，使用占位注释保持对齐
- **动态获取**: 使用 `Localizer.get().your_variable_name` 获取当前语言的文本
### 文件处理 (`module/File`)
- **FileManager**: 统一的文件读写入口
- **解析器**: 各类文件格式（如 `XLSX.py`, `EPUB.py`）应继承自 `module.File.TRANS.TRANS` 或相应的基类，并实现 `read` 和 `write` 方法

## 6. 任务流程指南 (Workflow)
1.  **理解需求**: 阅读任务描述，搜索相关逻辑或 UI 页面
2.  **分析上下文**: 查看相关类的继承关系（通常继承自 `Base`）和事件监听情况
3.  **实施变更**:
    - 修改业务逻辑后，检查是否需要同步更新 `Localizer`
    - 如果修改了 UI，确保在不同主题下显示正常
4.  **验证**: 运行 `uv run app.py` 手动测试，或编写脚本测试核心算法
5.  **收尾**: 执行 `uv run ruff check --fix` 和 `uv run ruff format`

## 7. 常用文件路径
- `app.py`: 应用入口
- `base/Base.py`: 核心基类、事件定义、任务状态
- `module/Config.py`: 应用全局配置
- `module/Engine/Translator/`: 翻译引擎、任务调度、单条任务逻辑
- `module/File/`: 文件解析器实现
- `frontend/`: UI 页面实现
- `widget/`: 自定义 UI 控件
- `resource/preset/`: 内置翻译提示词、术语表等预设