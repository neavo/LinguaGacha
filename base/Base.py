import os
import json
import threading
from enum import StrEnum
from typing import Callable

from base.LogManager import LogManager
from base.EventManager import EventManager

class Base():

    # 事件
    class Event(StrEnum):

        PLATFORM_TEST_DONE = "PLATFORM_TEST_DONE"                          # API 测试完成
        PLATFORM_TEST_START = "PLATFORM_TEST_START"                        # API 测试开始
        TRANSLATION_START = "TRANSLATION_START"                            # 翻译开始
        TRANSLATION_STOP = "TRANSLATION_STOP"                              # 翻译停止
        TRANSLATION_STOP_DONE = "TRANSLATION_STOP_DONE"                    # 翻译停止完成
        TRANSLATION_UPDATE = "TRANSLATION_UPDATE"                          # 翻译状态更新
        TRANSLATION_MANUAL_EXPORT = "TRANSLATION_MANUAL_EXPORT"            # 翻译结果手动导出
        CACHE_FILE_AUTO_SAVE = "CACHE_FILE_AUTO_SAVE"                      # 缓存文件自动保存
        PROJECT_STATUS = "PROJECT_STATUS"                                  # 项目状态检查
        PROJECT_STATUS_CHECK_DONE = "PROJECT_STATUS_CHECK_DONE"            # 项目状态检查完成
        APP_UPDATE_CHECK = "APP_UPDATE_CHECK"                              # 检查更新
        APP_UPDATE_CHECK_DONE = "APP_UPDATE_CHECK_DONE"                    # 检查更新 - 完成
        APP_UPDATE_DOWNLOAD = "APP_UPDATE_DOWNLOAD"                        # 检查更新 - 下载
        APP_UPDATE_DOWNLOAD_UPDATE = "APP_UPDATE_DOWNLOAD_UPDATE"          # 检查更新 - 下载进度更新
        APP_UPDATE_EXTRACT = "APP_UPDATE_EXTRACT"                          # 检查更新 - 解压
        APP_TOAST_SHOW = "APP_TOAST_SHOW"                                  # 显示 Toast
        GLOSSARY_REFRESH = "GLOSSARY_REFRESH"                              # 术语表刷新
        APP_SHUT_DOWN = "APP_SHUT_DOWN"                                    # 应用关闭

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

    # 任务状态
    class TaskStatus(StrEnum):

        IDLE = "IDLE"                                                       # 无任务
        TESTING = "TESTING"                                                 # 运行中
        TRANSLATING = "TRANSLATING"                                         # 运行中
        STOPPING = "STOPPING"                                               # 停止中

    # 翻译状态
    class TranslationStatus(StrEnum):

        UNTRANSLATED = "UNTRANSLATED"                                       # 待翻译
        TRANSLATING = "TRANSLATING"                                         # 翻译中
        TRANSLATED = "TRANSLATED"                                           # 已翻译
        TRANSLATED_IN_PAST = "TRANSLATED_IN_PAST"                           # 过去已翻译
        EXCLUDED = "EXCLUDED"                                               # 已排除
        DUPLICATED = "DUPLICATED"                                           # 重复条目

    # 配置文件路径
    CONFIG_PATH: str = "./resource/config.json"

    # 类变量
    WORK_STATUS: TaskStatus = TaskStatus.IDLE

    # 类线程锁
    CONFIG_FILE_LOCK: threading.Lock = threading.Lock()

    # 构造函数
    def __init__(self) -> None:
        pass

    # PRINT
    def print(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.print(msg, e, file, console)

    # DEBUG
    def debug(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.debug(msg, e, file, console)

    # INFO
    def info(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.info(msg, e, file, console)

    # ERROR
    def error(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.error(msg, e, file, console)

    # WARNING
    def warning(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogManager.warning(msg, e, file, console)

    # 载入配置文件
    def load_config(self) -> dict:
        config = {}

        with Base.CONFIG_FILE_LOCK:
            if os.path.exists(Base.CONFIG_PATH):
                with open(Base.CONFIG_PATH, "r", encoding = "utf-8-sig") as reader:
                    config = json.load(reader)
            else:
                pass

        return config

    # 保存配置文件
    def save_config(self, new: dict) -> None:
        old = {}

        # 读取配置文件
        with Base.CONFIG_FILE_LOCK:
            if os.path.exists(Base.CONFIG_PATH):
                with open(Base.CONFIG_PATH, "r", encoding = "utf-8-sig") as reader:
                    old = json.load(reader)

        # 对比新旧数据是否一致，一致则跳过后续步骤
        # 当字典中包含子字典或子列表时，使用 == 运算符仍然可以进行比较
        # Python 会递归地比较所有嵌套的结构，确保每个层次的键值对都相等
        if old == new:
            return old

        # 更新配置数据
        for k, v in new.items():
            if k not in old.keys():
                old[k] = v
            else:
                old[k] = new[k]

        # 写入配置文件
        with Base.CONFIG_FILE_LOCK:
            with open(Base.CONFIG_PATH, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(old, indent = 4, ensure_ascii = False))

        return old

    # 更新配置
    def fill_config(self, old: dict, new: dict) -> dict:
        for k, v in new.items():
            if k not in old.keys():
                old[k] = v

        return old

    # 用默认值更新并加载配置文件
    def load_config_from_default(self) -> None:
        config = self.load_config()
        config = self.fill_config(config, getattr(self, "default", {}))

        return config

    # 触发事件
    def emit(self, event: Event, data: dict) -> None:
        EventManager.get().emit(event, data)

    # 订阅事件
    def subscribe(self, event: Event, hanlder: Callable) -> None:
        EventManager.get().subscribe(event, hanlder)

    # 取消订阅事件
    def unsubscribe(self, event: Event, hanlder: Callable) -> None:
        EventManager.get().unsubscribe(event, hanlder)