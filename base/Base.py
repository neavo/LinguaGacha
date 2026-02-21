from enum import StrEnum
from typing import Callable

from base.EventManager import EventManager


class Base:
    # 事件
    class Event(StrEnum):
        TOAST = "TOAST"  # Toast
        PROGRESS_TOAST_SHOW = "PROGRESS_TOAST_SHOW"  # 显示进度 Toast
        PROGRESS_TOAST_UPDATE = "PROGRESS_TOAST_UPDATE"  # 更新进度 Toast
        PROGRESS_TOAST_HIDE = "PROGRESS_TOAST_HIDE"  # 隐藏进度 Toast
        APITEST_RUN = "APITEST_RUN"  # 测试 - 开始
        APITEST_DONE = "APITEST_DONE"  # 测试 - 完成
        TRANSLATION_RUN = "TRANSLATION_RUN"  # 翻译 - 开始
        TRANSLATION_DONE = "TRANSLATION_DONE"  # 翻译 - 完成
        TRANSLATION_RESET = "TRANSLATION_RESET"  # 翻译 - 重置
        TRANSLATION_RESET_FAILED = "TRANSLATION_RESET_FAILED"  # 翻译 - 重置失败条目
        TRANSLATION_UPDATE = "TRANSLATION_UPDATE"  # 翻译 - 更新
        TRANSLATION_EXPORT = "TRANSLATION_EXPORT"  # 翻译 - 导出
        TRANSLATION_REQUIRE_STOP = "TRANSLATION_REQUIRE_STOP"  # 翻译 - 请求停止
        NER_ANALYZER_RUN = "NER_ANALYZER_RUN"  # 分析 - 开始
        NER_ANALYZER_DONE = "NER_ANALYZER_DONE"  # 分析 - 完成
        NER_ANALYZER_UPDATE = "NER_ANALYZER_UPDATE"  # 分析 - 更新
        NER_ANALYZER_EXPORT = "NER_ANALYZER_EXPORT"  # 分析 - 导出
        NER_ANALYZER_REQUIRE_STOP = "NER_ANALYZER_REQUIRE_STOP"  # 分析 - 请求停止
        APP_UPDATE_CHECK_RUN = "APP_UPDATE_CHECK_RUN"  # 更新 - 检查
        APP_UPDATE_CHECK_DONE = "APP_UPDATE_CHECK_DONE"  # 更新 - 检查完成
        APP_UPDATE_DOWNLOAD_RUN = "APP_UPDATE_DOWNLOAD_RUN"  # 更新 - 下载
        APP_UPDATE_DOWNLOAD_DONE = "APP_UPDATE_DOWNLOAD_DONE"  # 更新 - 下载完成
        APP_UPDATE_DOWNLOAD_ERROR = "APP_UPDATE_DOWNLOAD_ERROR"  # 更新 - 下载报错
        APP_UPDATE_DOWNLOAD_UPDATE = "APP_UPDATE_DOWNLOAD_UPDATE"  # 更新 - 下载更新
        APP_UPDATE_EXTRACT = "APP_UPDATE_EXTRACT"  # 更新 - 解压
        PROJECT_LOADED = "PROJECT_LOADED"  # 工程 - 已加载
        PROJECT_UNLOADED = "PROJECT_UNLOADED"  # 工程 - 已卸载
        PROJECT_FILE_UPDATE = "PROJECT_FILE_UPDATE"  # 工程 - 文件变更
        PROJECT_CHECK_RUN = "PROJECT_CHECK_RUN"  # 项目 - 检查
        PROJECT_CHECK_DONE = "PROJECT_CHECK_DONE"  # 项目 - 检查完成
        PROJECT_PREFILTER_RUN = "PROJECT_PREFILTER_RUN"  # 工程 - 预过滤开始
        PROJECT_PREFILTER_DONE = "PROJECT_PREFILTER_DONE"  # 工程 - 预过滤完成
        PROJECT_PREFILTER_UPDATED = (
            "PROJECT_PREFILTER_UPDATED"  # 工程 - 预过滤结果已更新
        )
        CONFIG_UPDATED = "CONFIG_UPDATED"  # 配置 - 已更新
        QUALITY_RULE_UPDATE = "QUALITY_RULE_UPDATE"  # 质量规则更新

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
