from enum import StrEnum
from typing import Callable

from base.EventManager import EventManager
from base.LogManager import LogManager

class Base():

    # 事件
    class Event(StrEnum):

        PLATFORM_TEST_DONE = "PLATFORM_TEST_DONE"                          # API 测试完成
        PLATFORM_TEST_START = "PLATFORM_TEST_START"                        # API 测试开始
        TRANSLATION_START = "TRANSLATION_START"                            # 翻译开始
        TRANSLATION_STOP = "TRANSLATION_STOP"                              # 翻译停止
        TRANSLATION_DONE = "TRANSLATION_DONE"                              # 翻译完成
        TRANSLATION_UPDATE = "TRANSLATION_UPDATE"                          # 翻译状态更新
        TRANSLATION_MANUAL_EXPORT = "TRANSLATION_MANUAL_EXPORT"            # 翻译结果手动导出
        CACHE_FILE_AUTO_SAVE = "CACHE_FILE_AUTO_SAVE"                      # 缓存文件自动保存
        PROJECT_STATUS = "PROJECT_STATUS"                                  # 项目状态检查
        PROJECT_STATUS_CHECK_DONE = "PROJECT_STATUS_CHECK_DONE"            # 项目状态检查完成
        APP_UPDATE_CHECK_START = "APP_UPDATE_CHECK_START"                  # 更新 - 检查开始
        APP_UPDATE_CHECK_DONE = "APP_UPDATE_CHECK_DONE"                    # 更新 - 检查完成
        APP_UPDATE_DOWNLOAD_START = "APP_UPDATE_DOWNLOAD_START"            # 更新 - 下载开始
        APP_UPDATE_DOWNLOAD_DONE = "APP_UPDATE_DOWNLOAD_DONE"              # 更新 - 下载完成
        APP_UPDATE_DOWNLOAD_ERROR = "APP_UPDATE_DOWNLOAD_ERROR"            # 更新 - 下载报错
        APP_UPDATE_DOWNLOAD_UPDATE = "APP_UPDATE_DOWNLOAD_UPDATE"          # 更新 - 下载更新
        APP_UPDATE_EXTRACT = "APP_UPDATE_EXTRACT"                          # 更新 - 解压
        APP_TOAST_SHOW = "APP_TOAST_SHOW"                                  # 显示 Toast
        GLOSSARY_REFRESH = "GLOSSARY_REFRESH"                              # 术语表刷新
        RESULT_FIXER_START = "RESULT_FIXER_START"                          # 结果修正 - 开始
        RESULT_FIXER_UPDATE = "RESULT_FIXER_UPDATE"                        # 结果修正 - 进度更新
        RESULT_FIXER_DONE = "RESULT_FIXER_DONE"                            # 结果修正 - 完成

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

    # 翻译状态
    class TranslationStatus(StrEnum):

        UNTRANSLATED = "UNTRANSLATED"                                       # 待翻译
        TRANSLATING = "TRANSLATING"                                         # 翻译中
        TRANSLATED = "TRANSLATED"                                           # 已翻译
        TRANSLATED_IN_PAST = "TRANSLATED_IN_PAST"                           # 过去已翻译
        EXCLUDED = "EXCLUDED"                                               # 已排除
        DUPLICATED = "DUPLICATED"                                           # 重复条目

    # 构造函数
    def __init__(self) -> None:
        pass

    # PRINT
    def print(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.get().print(msg, e, file, console)

    # DEBUG
    def debug(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.get().debug(msg, e, file, console)

    # INFO
    def info(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.get().info(msg, e, file, console)

    # ERROR
    def error(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.get().error(msg, e, file, console)

    # WARNING
    def warning(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
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