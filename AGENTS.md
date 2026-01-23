# LinguaGacha Agent Guidelines
本文档定义了 LinguaGacha 仓库 AI Agent 的操作标准、代码风格和工作流

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
结束任务前**必须且仅对有实际业务逻辑变化的文件**进行检查和修复：
- **Lint & Fix**: `uv run ruff check --fix`
- **Format**: `uv run ruff format`

## 3. 核心原则
1.  **第一性原理**: 立足于第一性原理剖析问题，善用工具以提升效率
2.  **事实为准**: 以事实为最高准则，若发现规则或代码有误，请坦率承认并修正
3.  **KISS & YAGNI**: 保持简单，拒绝过度设计，除非必要，避免防御性编程
4.  **清理**: 冗余的空行、代码、注释、未使用的本地化字段或其他不再需要的资源应立即清理

## 4. 代码规范
### 通用
- **注释**: 关键逻辑 **必须** 写单行注释解释 **为什么** (Why) 而不仅仅是做什么 (What)
- **控制流**: 避免深层嵌套，**优先使用 Early Returns**
- **DRY**: 代码重复 < 3 次可接受（可读性 > 抽象），仅在重复 ≥ 3 次时提取函数
### 命名约定
- **通用**: 遵循现有文件风格。默认使用 `snake_case`
- **变量/函数**: 必须包含动词或明确意图
- **禁止**: **严禁** 使用下划线对函数或变量命名
  - ❌ `_get_data`, `data`, `info`
  - ✅ `get_user_profile`, `fetch_status`
- **类**: `PascalCase` (如 `AppFluentWindow`)
- **常量**: `UPPER_SNAKE_CASE` (如 `Base.Event.PROJECT_LOADED`)
- **拒绝魔术值**: 使用枚举 (如 `StrEnum`) 代替原始字符串/数字
### Python 特性
- **类型提示**: 所有函数参数和返回类型 **必须** 标注类型 (Type Hints)
- **导入**: 优先 Top-level Imports，使用 `ruff` 排序
- **字符串格式化**: 优先使用 `f-string`
- **集合**: 简单转换优先使用列表推导式
### 前端 (PyQt5)
- **库**: 尽可能使用 `qfluentwidgets` 组件而非原生 Qt 控件
- **主题**: 支持动态主题切换 (亮/暗)
- **架构**:
  - 使用 `AppFluentWindow.py`作为主导航
  - 使用 `Base.emit` 和 `Base.subscribe` 进行组件间通信 (事件总线模式)
  - 不要紧耦合组件；通过 EventManager 通信

## 5. 架构与模式
### 事件系统 (`base/Base.py`)
应用使用中心化的事件总线
- **定义事件**: 在 `Base.Event(StrEnum)` 中添加新事件
- **触发**: `self.emit(Base.Event.SOME_EVENT, data={...})`
- **监听**: `self.subscribe(Base.Event.SOME_EVENT, self.on_event_handler)`
### 日志管理 (`base/LogManager.py`)
- **唯一入口**: **严禁** 使用 `print()`，必须通过 `LogManager.get()` 输出
- **异常处理**: 捕获异常时，必须将 `Exception` 对象传递给 `error()` 或 `debug()` 以记录堆栈信息
  - ✅ `self.error("Message", e)` `LogManager.get().error("Message", e)`
- **等级**:
  - `debug`: 仅在专家模式 (Expert Mode) 可见
  - `info`: 常规用户提示
  - `error`: 错误与异常
### 本地化资源 (`module/Localizer`)
- **硬编码禁止**: UI 显示的字符串 **严禁** 直接写在代码中
- **定义**: 必须在 `LocalizerZH.py` (及EN) 中定义对应的静态变量
- **调用**: 通过 `Localizer.get().variable_name` 获取
- **对齐**: 修改 Localizer 文件时，**必须** 保持不同语言文件的行数一致（禁止随意删除用于占位的注释）
### 文件结构
- `app.py`: 入口点
- `base/`: 核心基础设施 (Events, Log, Version)
- `module/`: 业务逻辑 (Engine, Storage, Localizer)
- `frontend/`: UI 页面和窗口
- `widget/`: 可复用的 UI 组件
