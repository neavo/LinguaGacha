from enum import StrEnum
from typing import Callable

from base.EventManager import EventManager


class Base:
    APP_NAME: str = "LinguaGacha"
    REPO_URL: str = "https://github.com/neavo/LinguaGacha"
    USER_AGENT_NAME: str = "LinguaGacha"

    # 翻译/分析事件速查表：
    # +-------------------------------+-------------------------------+------------------------------------------------+-----------------------------------------------------------+
    # | 事件名                        | sub_event                     | 语义                                           | 常见字段                                                  |
    # +-------------------------------+-------------------------------+------------------------------------------------+-----------------------------------------------------------+
    # | TRANSLATION_TASK              | REQUEST / RUN / DONE / ERROR | 发起或继续翻译任务，并回传任务终态            | mode, final_status(SUCCESS/STOPPED/FAILED), message      |
    # | TRANSLATION_REQUEST_STOP      | REQUEST / RUN                | 请求停止当前正在执行的翻译任务（不单独发 DONE）| 无                                                        |
    # | TRANSLATION_PROGRESS          | （按快照事件处理）           | 上报翻译进度快照                               | line, total_line, processed_line, error_line, total_tokens, time |
    # | ANALYSIS_TASK                 | REQUEST / RUN / DONE / ERROR | 发起或继续术语分析任务，并回传任务终态         | mode, final_status(SUCCESS/STOPPED/FAILED), message      |
    # | ANALYSIS_REQUEST_STOP         | REQUEST / RUN                | 请求停止当前正在执行的分析任务（不单独发 DONE）| 无                                                        |
    # | ANALYSIS_PROGRESS             | （按快照事件处理）           | 上报分析进度快照                               | line, total_line, processed_line, error_line, total_tokens, time |
    # | PROJECT_RUNTIME_PATCH         | UPDATE                       | 直接推送 V2 运行态补丁                        | updatedSections, patch, sectionRevisions, projectRevision |
    # +-------------------------------+-------------------------------+------------------------------------------------+-----------------------------------------------------------+

    # 事件
    class Event(StrEnum):
        TRANSLATION_TASK = (
            "TRANSLATION_TASK"  # 翻译 - 任务生命周期事件（发起/运行/结束）
        )
        TRANSLATION_REQUEST_STOP = (
            "TRANSLATION_REQUEST_STOP"  # 翻译 - 停止当前任务请求链路（REQUEST/RUN）
        )
        TRANSLATION_PROGRESS = "TRANSLATION_PROGRESS"  # 翻译 - 进度快照更新
        TRANSLATION_EXPORT = "TRANSLATION_EXPORT"  # 翻译 - 导出
        ANALYSIS_TASK = "ANALYSIS_TASK"  # 分析 - 任务生命周期事件（发起/运行/结束）
        ANALYSIS_REQUEST_STOP = (
            "ANALYSIS_REQUEST_STOP"  # 分析 - 停止当前任务请求链路（REQUEST/RUN）
        )
        ANALYSIS_PROGRESS = "ANALYSIS_PROGRESS"  # 分析 - 进度快照更新
        APP_UPDATE_CHECK = "APP_UPDATE_CHECK"  # 更新 - 检查生命周期事件
        APP_UPDATE_DOWNLOAD = "APP_UPDATE_DOWNLOAD"  # 更新 - 下载生命周期事件
        APP_UPDATE_APPLY = "APP_UPDATE_APPLY"  # 更新 - 应用流程
        PROJECT_LOADED = "PROJECT_LOADED"  # 工程 - 已加载
        PROJECT_UNLOADED = "PROJECT_UNLOADED"  # 工程 - 已卸载
        PROJECT_RUNTIME_PATCH = "PROJECT_RUNTIME_PATCH"  # 工程 - V2 运行态直接补丁
        PROJECT_CHECK = "PROJECT_CHECK"  # 工程 - 检查生命周期事件
        CONFIG_UPDATED = "CONFIG_UPDATED"  # 配置 - 已更新

    # 通用生命周期子事件
    # 为什么需要它：多数事件都遵循“请求 -> 运行 -> 更新 -> 完成/失败”的同构流程，
    # 统一枚举能减少 if-else 分叉并保持 payload 结构稳定。
    class SubEvent(StrEnum):
        REQUEST = "REQUEST"  # 请求阶段
        RUN = "RUN"  # 执行阶段
        UPDATE = "UPDATE"  # 中间进度更新阶段
        DONE = "DONE"  # 成功完成阶段
        ERROR = "ERROR"  # 失败终态阶段

    # 接口格式
    class APIFormat(StrEnum):
        OPENAI = "OpenAI"
        GOOGLE = "Google"
        ANTHROPIC = "Anthropic"
        SAKURALLM = "SakuraLLM"

    # 任务类型
    class TaskType(StrEnum):
        NER = "NER"
        TRANSLATION = "TRANSLATION"
        ANALYSIS = "ANALYSIS"

    # 任务状态
    class TaskStatus(StrEnum):
        IDLE = "IDLE"  # 无任务
        ANALYZING = "ANALYZING"  # 分析中
        TRANSLATING = "TRANSLATING"  # 翻译中
        STOPPING = "STOPPING"  # 停止中

    # 项目状态
    class ProjectStatus(StrEnum):
        NONE = "NONE"  # 无
        PROCESSING = "PROCESSING"  # 处理中
        PROCESSED = "PROCESSED"  # 已处理
        PROCESSED_IN_PAST = "PROCESSED_IN_PAST"  # 过去已处理
        EXCLUDED = "EXCLUDED"  # 已排除
        RULE_SKIPPED = "RULE_SKIPPED"  # 规则跳过
        LANGUAGE_SKIPPED = "LANGUAGE_SKIPPED"  # 非目标原文语言
        DUPLICATED = "DUPLICATED"  # 重复条目
        ERROR = "ERROR"  # 处理出错/重试失败

    # 翻译模式 (用户意图)
    class TranslationMode(StrEnum):
        NEW = "NEW"  # 新任务：从工程数据库加载条目，并初始化全新进度
        CONTINUE = "CONTINUE"  # 继续翻译：从工程数据库加载条目，并恢复既有进度
        RESET = "RESET"  # 重置任务 (强制重解析 Assets)

    # 分析模式 (用户意图)
    class AnalysisMode(StrEnum):
        NEW = "NEW"  # 新任务：清空既有分析进度并重新扫描全部文件
        CONTINUE = "CONTINUE"  # 继续分析：跳过已完成文件，仅继续剩余文件
        RESET = "RESET"  # 重置任务：用于外部显式声明“重新构建分析语料”

    API_STREAM_SOURCE_EVENTS: tuple[Event, ...] = (
        Event.PROJECT_LOADED,
        Event.PROJECT_UNLOADED,
        Event.PROJECT_RUNTIME_PATCH,
        Event.TRANSLATION_TASK,
        Event.TRANSLATION_REQUEST_STOP,
        Event.TRANSLATION_PROGRESS,
        Event.ANALYSIS_TASK,
        Event.ANALYSIS_REQUEST_STOP,
        Event.ANALYSIS_PROGRESS,
        Event.CONFIG_UPDATED,
    )
    ENGINE_BUSY_STATUSES: tuple[TaskStatus, ...] = (
        TaskStatus.TRANSLATING,
        TaskStatus.ANALYZING,
        TaskStatus.STOPPING,
    )

    # 构造函数
    # Base 作为 mixin 使用：统一暴露应用级事件总线入口，
    # 不再依赖任何 Qt 对象或主线程语义。
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)

    # 触发事件
    def emit(self, signal: object, *args: object) -> bool:
        """统一的 emit 入口。

        说明：Base 统一拦截应用事件；若上层类也定义了 emit，则继续委派，
        这样不同宿主对象仍能复用同一份 mixin 入口：

        - 若 signal 是 Base.Event：走应用事件总线
        - 否则：尝试委派给父类 emit
        """

        if isinstance(signal, Base.Event):
            payload = args[0] if args else {}
            payload_dict = payload if isinstance(payload, dict) else {}
            EventManager.get().emit_event(signal, payload_dict)
            return True

        super_emit = getattr(super(), "emit", None)
        if callable(super_emit):
            return bool(super_emit(signal, *args))
        return False

    # 订阅事件
    def subscribe(self, event: Event, hanlder: Callable) -> None:
        EventManager.get().subscribe(event, hanlder)

    # 取消订阅事件
    def unsubscribe(self, event: Event, hanlder: Callable) -> None:
        EventManager.get().unsubscribe(event, hanlder)

    @classmethod
    def is_engine_busy(cls, status: TaskStatus) -> bool:
        """统一定义哪些引擎状态需要锁住会影响任务语义的控件。"""

        return status in cls.ENGINE_BUSY_STATUSES
