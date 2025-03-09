import os
import threading
from typing import Callable

import rapidjson as json

from base.EventManager import EventManager
from module.LogHelper import LogHelper

class Base():

    # 事件
    class Event():

        PLATFORM_TEST_DONE: int = 100                           # API 测试完成
        PLATFORM_TEST_START: int = 101                          # API 测试开始
        TRANSLATION_START: int = 210                            # 翻译开始
        TRANSLATION_UPDATE: int = 220                           # 翻译状态更新
        TRANSLATION_STOP: int = 230                             # 翻译停止
        TRANSLATION_STOP_DONE: int = 231                        # 翻译停止完成
        TRANSLATION_PROJECT_STATUS: int = 240                   # 项目状态检查
        TRANSLATION_PROJECT_STATUS_CHECK_DONE: int = 241        # 项目状态检查完成
        TRANSLATION_MANUAL_EXPORT: int = 250                    # 翻译结果手动导出
        CACHE_FILE_AUTO_SAVE: int = 300                         # 缓存文件自动保存
        APP_UPDATE_CHECK: int = 400                             # 检查更新
        APP_UPDATE_CHECK_DONE: int = 401                        # 检查更新完成
        TOAST_SHOW: int = 900                                   # 显示 Toast
        APP_SHUT_DOWN: int = 1000                               # 应用关闭

    # 任务状态
    class Status():

        IDLE: int = 100                                         # 无任务
        API_TEST: int = 200                                     # 测试中
        TRANSLATING: int = 300                                  # 翻译中
        STOPING: int = 400                                      # 停止中

    # 语言
    class Language():

        ZH: str = "ZH"
        EN: str = "EN"
        JA: str = "JA"
        KO: str = "KO"
        RU: str = "RU"
        DE: str = "DE"
        FR: str = "FR"
        ES: str = "ES"
        IT: str = "IT"
        PT: str = "PT"
        TH: str = "TH"
        ID: str = "ID"
        VI: str = "VI"

        CJK: tuple[str] = (
            ZH,
            JA,
            KO,
        )

    # 接口格式
    class APIFormat():

        OPENAI: str = "OpenAI"
        GOOGLE: str = "Google"
        ANTHROPIC: str = "Anthropic"
        SAKURALLM: str = "SakuraLLM"

    # 接口格式
    class ToastType():

        INFO: str = "INFO"
        ERROR: str = "ERROR"
        SUCCESS: str = "SUCCESS"
        WARNING: str = "WARNING"

    # 翻译状态
    class TranslationStatus():

        UNTRANSLATED: str = "UNTRANSLATED"                      # 待翻译
        TRANSLATING: str = "TRANSLATING"                        # 翻译中
        TRANSLATED: str = "TRANSLATED"                          # 已翻译
        EXCLUDED: str = "EXCLUDED"                              # 已排除

    # 配置文件路径
    CONFIG_PATH = "./resource/config.json"

    # 类变量
    WORK_STATUS = Status.IDLE

    # 类线程锁
    CONFIG_FILE_LOCK = threading.Lock()

    # 构造函数
    def __init__(self) -> None:
        # 默认配置
        self.default = {}

        # 获取事件管理器单例
        self.event_manager_singleton = EventManager()

    # PRINT
    def print(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogHelper.print(msg, e, file, console)

    # DEBUG
    def debug(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogHelper.debug(msg, e, file, console)

    # INFO
    def info(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogHelper.info(msg, e, file, console)

    # ERROR
    def error(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogHelper.error(msg, e, file, console)

    # WARNING
    def warning(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        LogHelper.warning(msg, e, file, console)

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
    def emit(self, event: int, data: dict) -> None:
        EventManager.get_singleton().emit(event, data)

    # 订阅事件
    def subscribe(self, event: int, hanlder: Callable) -> None:
        EventManager.get_singleton().subscribe(event, hanlder)

    # 取消订阅事件
    def unsubscribe(self, event: int, hanlder: Callable) -> None:
        EventManager.get_singleton().unsubscribe(event, hanlder)