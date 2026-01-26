from enum import StrEnum
from typing import Callable

from base.EventManager import EventManager
from base.LogManager import LogManager


class Base:
    # 事件
    class Event(StrEnum):
        TOAST = "TOAST"  # Toast
        PROGRESS_TOAST_SHOW = "PROGRESS_TOAST_SHOW"  # 显示进度 Toast
        PROGRESS_TOAST_UPDATE = "PROGRESS_TOAST_UPDATE"  # 更新进度 Toast
        PROGRESS_TOAST_HIDE = "PROGRESS_TOAST_HIDE"  # 隐藏进度 Toast
        PROJECT_CHECK_RUN = "PROJECT_CHECK_RUN"  # 项目 - 检查
        PROJECT_CHECK_DONE = "PROJECT_CHECK_DONE"  # 项目 - 检查完成
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
        GLOSSARY_REFRESH = "GLOSSARY_REFRESH"  # 术语表刷新
        PROJECT_LOADED = "PROJECT_LOADED"  # 工程 - 已加载
        PROJECT_UNLOADED = "PROJECT_UNLOADED"  # 工程 - 已卸载

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
        DUPLICATED = "DUPLICATED"  # 重复条目
        ERROR = "ERROR"  # 处理出错/重试失败

    # 翻译模式 (用户意图)
    class TranslationMode(StrEnum):
        NEW = "NEW"  # 新任务 (自动判定读缓存或重解析)
        CONTINUE = "CONTINUE"  # 继续翻译 (读缓存)
        RESET = "RESET"  # 重置任务 (强制重解析 Assets)

    # 构造函数
    def __init__(self) -> None:
        pass

    # PRINT
    def print(
        self,
        msg: str,
        e: Exception | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        LogManager.get().print(msg, e, file, console)

    # DEBUG
    def debug(
        self,
        msg: str,
        e: Exception | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        LogManager.get().debug(msg, e, file, console)

    # INFO
    def info(
        self,
        msg: str,
        e: Exception | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        LogManager.get().info(msg, e, file, console)

    # ERROR
    def error(
        self,
        msg: str,
        e: Exception | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        LogManager.get().error(msg, e, file, console)

    # WARNING
    def warning(
        self,
        msg: str,
        e: Exception | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        LogManager.get().warning(msg, e, file, console)

    # 触发事件
    def emit(self, event: Event, data: dict) -> None:
        EventManager.get().emit(event, data)

    # 订阅事件
    def subscribe(self, event: Event, hanlder: Callable) -> None:
        EventManager.get().subscribe(event, hanlder)

    # 取消订阅事件
    def unsubscribe(self, event: Event, hanlder: Callable) -> None:
        EventManager.get().unsubscribe(event, hanlder)
