from enum import StrEnum
from typing import Callable

from base.EventManager import EventManager


class Base:
    # 翻译事件速查表（优先看这里）：
    # +-------------------------------+-------------------------------+------------------------------------------------+-----------------------------------------------------------+
    # | 事件名                        | sub_event                     | 语义                                           | 常见字段                                                  |
    # +-------------------------------+-------------------------------+------------------------------------------------+-----------------------------------------------------------+
    # | TRANSLATION_TASK              | REQUEST / RUN / DONE / ERROR | 发起或继续翻译任务，并回传任务终态            | mode, final_status(SUCCESS/STOPPED/FAILED), message      |
    # | TRANSLATION_REQUEST_STOP      | REQUEST / RUN                | 请求停止当前正在执行的翻译任务（不单独发 DONE）| 无                                                        |
    # | TRANSLATION_PROGRESS          | （按快照事件处理）           | 上报翻译进度快照                               | line, total_line, processed_line, error_line, total_tokens, time |
    # | TRANSLATION_RESET_ALL         | REQUEST / RUN / DONE / ERROR | 重置全部条目                                   | 无                                                        |
    # | TRANSLATION_RESET_FAILED      | REQUEST / RUN / DONE / ERROR | 仅重置失败条目                                 | 无                                                        |
    # +-------------------------------+-------------------------------+------------------------------------------------+-----------------------------------------------------------+

    # 事件
    class Event(StrEnum):
        TOAST = "TOAST"  # Toast
        PROGRESS_TOAST = "PROGRESS_TOAST"  # 进度 Toast 生命周期事件
        APITEST = "APITEST"  # 测试 - 生命周期事件
        TRANSLATION_TASK = "TRANSLATION_TASK"  # 翻译 - 任务生命周期事件（发起/运行/结束）
        TRANSLATION_REQUEST_STOP = "TRANSLATION_REQUEST_STOP"  # 翻译 - 停止当前任务请求链路（REQUEST/RUN）
        TRANSLATION_PROGRESS = "TRANSLATION_PROGRESS"  # 翻译 - 进度快照更新
        TRANSLATION_EXPORT = "TRANSLATION_EXPORT"  # 翻译 - 导出
        TRANSLATION_RESET_ALL = "TRANSLATION_RESET_ALL"  # 翻译 - 重置全部
        TRANSLATION_RESET_FAILED = "TRANSLATION_RESET_FAILED"  # 翻译 - 仅重置失败项
        APP_UPDATE_CHECK = "APP_UPDATE_CHECK"  # 更新 - 检查生命周期事件
        APP_UPDATE_DOWNLOAD = "APP_UPDATE_DOWNLOAD"  # 更新 - 下载生命周期事件
        APP_UPDATE_APPLY = "APP_UPDATE_APPLY"  # 更新 - 应用流程
        PROJECT_LOADED = "PROJECT_LOADED"  # 工程 - 已加载
        PROJECT_UNLOADED = "PROJECT_UNLOADED"  # 工程 - 已卸载
        PROJECT_FILE_UPDATE = "PROJECT_FILE_UPDATE"  # 工程 - 文件变更（增删改/重命名）
        PROJECT_CHECK = "PROJECT_CHECK"  # 工程 - 检查生命周期事件
        PROJECT_PREFILTER = "PROJECT_PREFILTER"  # 工程 - 预过滤生命周期事件
        WORKBENCH_REFRESH = "WORKBENCH_REFRESH"  # 工作台 - 刷新请求（无需携带快照）
        WORKBENCH_SNAPSHOT = "WORKBENCH_SNAPSHOT"  # 工作台 - 快照更新（跨线程回到 UI）
        CONFIG_UPDATED = "CONFIG_UPDATED"  # 配置 - 已更新
        QUALITY_RULE_UPDATE = "QUALITY_RULE_UPDATE"  # 质量规则更新

    # 通用生命周期子事件
    # 为什么需要它：多数事件都遵循“请求 -> 运行 -> 更新 -> 完成/失败”的同构流程，
    # 统一枚举能减少 if-else 分叉并保持 payload 结构稳定。
    class SubEvent(StrEnum):
        REQUEST = "REQUEST"  # 请求阶段
        RUN = "RUN"  # 执行阶段
        UPDATE = "UPDATE"  # 中间进度更新阶段
        DONE = "DONE"  # 成功完成阶段
        ERROR = "ERROR"  # 失败终态阶段

    # 工程预过滤子事件
    # 为什么单独枚举：预过滤存在 UPDATED 这一业务特有阶段，通用生命周期无法完整表达。
    class ProjectPrefilterSubEvent(StrEnum):
        RUN = "RUN"  # worker 已启动
        UPDATED = "UPDATED"  # 预过滤结果已写入并可消费
        DONE = "DONE"  # 一次 prefilter 生命周期结束
        ERROR = "ERROR"  # 执行失败

    # 接口格式
    class APIFormat(StrEnum):
        OPENAI = "OpenAI"
        GOOGLE = "Google"
        ANTHROPIC = "Anthropic"
        SAKURALLM = "SakuraLLM"

    # 接口格式
    class ToastType(StrEnum):
        INFO = "INFO"
        ERROR = "ERROR"
        SUCCESS = "SUCCESS"
        WARNING = "WARNING"

    # 任务类型
    class TaskType(StrEnum):
        NER = "NER"
        APITEST = "APITEST"
        TRANSLATION = "TRANSLATION"

    # 任务状态
    class TaskStatus(StrEnum):
        IDLE = "IDLE"  # 无任务
        NERING = "NERING"  # 测试中
        TESTING = "TESTING"  # 测试中
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

    # 构造函数
    # Base 作为 mixin 使用：需要支持 Qt 组件的协作式多继承初始化。
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)

    # 触发事件
    def emit(self, signal: object, *args: object) -> bool:
        """统一的 emit 入口。

        说明：Qt 的 QObject 也定义了 emit()（旧式信号接口）。Base 作为 mixin
        需要与 Qt 的多继承共存，因此这里提供一个兼容签名：

        - 若 signal 是 Base.Event：走应用事件总线
        - 否则：尝试委派给 Qt 的 QObject.emit
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
