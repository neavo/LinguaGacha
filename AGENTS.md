# LinguaGacha Agent Guidelines
本文档用于约束在本仓库工作的 Agent（含自动化 coding agent）的行为、命令与代码风格
目标：少踩坑、可维护、改动可验证

## 1. 项目背景
- **简介**: 基于 LLM 的次世代视觉小说、电子书及字幕翻译工具
- **技术栈**: Python 3.14, PyQt5, PyQt-Fluent-Widgets

## 2. 环境与指令
所有指令必须通过 `uv` 执行
### 2.1 安装与运行
- **安装依赖（按 lock 复现）**: `uv sync`
- **升级依赖（仅在明确需要时）**: `uv sync -U`
- **运行应用**: `uv run app.py`
### 2.2 Lint / Format (Ruff)
本仓库用 Ruff 做 lint + format + import 排序，推荐：改哪扫哪
- `uv run ruff check --fix <file_path>`
- `uv run ruff format <file_path>`
注意：
- `pyproject.toml` 配置 `extend-exclude = ["module/Localizer/"]`，Localizer 文件不会被 Ruff 正常约束
- `pyproject.toml` 配置 `quote-style = "double"`
- `pyproject.toml` 配置 `isort.force-single-line = true`
### 2.3 Tests
当前仓库未发现 `tests/`、pytest/tox/nox 配置

## 3. 核心原则
1. **第一性原理**: 立足于第一性原理剖析问题，善用工具以提升效率
2. **事实为准**: 即使用户建议与事实不符，也必须以事实为准，坦率指出
3. **KISS & YAGNI**: 保持简单，拒绝过度设计，除非必要，避免防御性编程
4. **清理**: 冗余空行、代码、注释、未使用本地化字段等应立即清理

## 4. 代码规范
### 4.1 注释
关键逻辑 **必须** 写单行注释解释 **为什么** (Why)，而不是做什么 (What)
### 4.2 控制流
避免深层嵌套，**优先使用 Early Returns**
### 4.3 DRY
重复 < 3 次可接受（可读性 > 抽象），仅在重复 ≥ 3 次时提取函数
### 4.4 命名规范
- **通用**: 遵循现有文件风格，默认 `snake_case`
- **禁止**: **严禁** 使用 **首位下划线** 命名函数或变量
  - ❌ `_get_data`, `_internal_method`, `data`, `info`
  - ✅ `get_user_profile`, `fetch_status`, `__init__`
- **类**: `PascalCase`（如 `AppFluentWindow`）
- **常量**: `UPPER_SNAKE_CASE`（如 `Base.Event.PROJECT_LOADED`）
- **拒绝魔术值**: 用常量或枚举（如 `StrEnum`）代替字符串/数字
### 4.5 类型提示
所有函数参数与返回类型 **必须** 标注类型
优先使用 Python 3.14 的现代类型语法（如 `A | None`、`list[str]`）
### 4.6 错误处理与日志
- 捕获异常时必须保留堆栈：`self.error("Message", e)`
- **严禁** 使用 `print()`；必须使用 `LogManager` 或继承自 `Base` 的日志方法
- 不要吞异常，如需降级处理，至少记录一次 error/warning

### 4.7 Imports
使用 Ruff isort 规则（`force-single-line = true`）
每个 import 单独一行，示例：
```python
from typing import Any
from typing import Self
```
### 4.8 前端开发 (PyQt5)
- **UI 库**: 尽可能使用 `qfluentwidgets` 组件
- **主题适配**: 必须支持亮/暗主题；避免硬编码颜色
- **多线程**: UI 耗时操作必须放在 `threading.Thread`
- **通信**: 组件间通信必须使用事件总线（`Base.emit` / `Base.subscribe`）
- **资源管理**: UI 图片、图标统一放 `resource/` 并通过配置或相对路径引用
### 4.9 本地化 (module/Localizer)
- **禁止硬编码**: 所有日志与界面文本必须在 `Localizer**.py` 中定义
- **行数对齐**: 修改时必须保持 ZH、EN 文件行数一致
- **动态获取**: 使用 `Localizer.get().your_variable_name`
## 5. 核心模块说明
### 5.1 事件系统 (`base/Base.py`)
应用通过 `EventManager` 实现组件解耦：
- **新增事件**: 在 `Base.Event` 枚举中定义
- **触发事件**:
```python
self.emit(Base.Event.TRANSLATION_DONE, {"result": "success"})
```
- **订阅事件**:
```python
self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
```
### 5.2 存储系统 (`module/Storage`)
- **StorageContext**: 当前工程的单例入口（访问数据库唯一入口）
- **DataStore**: SQLite 持久化层；翻译开始时 `db.open()` 开启 WAL，结束后 `db.close()`
- **Meta 数据**: `db.get_meta` / `db.set_meta`
- **Items 数据**: 核心翻译条目存储在 `items` 表
### 5.3 文件处理 (`module/File`)
- **FileManager**: 统一的文件读写入口

## 6. 任务流程指南 (Workflow)
1. 理解需求：定位相关逻辑或 UI 页面
2. 分析上下文：查看继承关系（通常继承自 `Base`）与事件监听
3. 实施变更：
  - 修改业务逻辑后，检查是否需要同步更新 `Localizer`
  - 修改 UI 后，确保在亮/暗主题下显示正常
4. 验证：手动测试或补充脚本测试核心算法
5. 收尾（仅对有业务变更的文件）：
  - `uv run ruff check --fix <file_path>`
  - `uv run ruff format <file_path>`

## 7. 常用文件路径
- `app.py`: 应用入口
- `base/Base.py`: 核心基类、事件定义、任务状态
- `module/Config.py`: 应用全局配置
- `module/Engine/Translator/`: 翻译引擎、任务调度、单条任务逻辑
- `module/File/`: 文件解析器实现
- `frontend/`: UI 页面实现
- `widget/`: 自定义 UI 控件
- `resource/preset/`: 内置翻译提示词、术语表等预设