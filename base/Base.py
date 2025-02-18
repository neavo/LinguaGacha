import os
import logging
import threading
import traceback
from logging.handlers import TimedRotatingFileHandler

import rapidjson as json
from rich import print
from rich.logging import RichHandler

from base.EventManager import EventManager

class Base():

    # 事件
    class Event():

        PLATFORM_TEST_DONE: int = 100                        # API 测试完成
        PLATFORM_TEST_START: int = 101                       # API 测试开始
        TRANSLATION_START: int = 210                         # 翻译开始
        TRANSLATION_UPDATE: int = 220                        # 翻译状态更新
        TRANSLATION_STOP: int = 230                          # 翻译停止
        TRANSLATION_STOP_DONE: int = 231                     # 翻译停止完成
        TRANSLATION_PROJECT_STATUS: int = 240                # 项目状态检查
        TRANSLATION_PROJECT_STATUS_CHECK_DONE: int = 241     # 项目状态检查完成
        TRANSLATION_MANUAL_EXPORT: int = 250                 # 翻译结果手动导出
        CACHE_FILE_AUTO_SAVE: int = 300                      # 缓存文件自动保存
        TOAST_SHOW: int = 400                                # 显示 Toast
        APP_SHUT_DOWN: int = 1000                            # 应用关闭

    # 任务状态
    class Status():

        IDLE: int = 100                                     # 无任务
        API_TEST: int = 200                                 # 测试中
        TRANSLATING: int = 300                              # 翻译中
        STOPING: int = 400                                  # 停止中

    # 语言
    class Language():

        ZH: str = "ZH"
        EN: str = "EN"
        JA: str = "JA"
        KO: str = "KO"
        RU: str = "RU"

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

        UNTRANSLATED: str = "UNTRANSLATED"       # 待翻译
        TRANSLATING: str = "TRANSLATING"         # 翻译中
        TRANSLATED: str = "TRANSLATED"           # 已翻译
        EXCLUDED: str = "EXCLUDED"               # 已排除

    # 配置文件路径
    CONFIG_PATH = "./resource/config.json"

    # 类变量
    WORK_STATUS = Status.IDLE

    # 类线程锁
    CONFIG_FILE_LOCK = threading.Lock()

    # 控制台日志实例
    os.makedirs("./log", exist_ok = True)
    LOGGER_FILE = logging.getLogger("lingua_gacha_file")
    LOGGER_FILE.propagate = False
    LOGGER_FILE.setLevel(logging.DEBUG)
    LOGGER_FILE.addHandler(
        TimedRotatingFileHandler(
            "./log/app.log",
            when = "midnight",
            interval = 1,
            encoding = "utf-8",
            backupCount = 3,
        )
    )
    LOGGER_FILE.handlers[-1].setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt = "%Y-%m-%d %H:%M:%S"))
    LOGGER_CONSOLE = logging.getLogger("lingua_gacha_console")
    LOGGER_CONSOLE.propagate = False
    LOGGER_CONSOLE.setLevel(logging.INFO)
    LOGGER_CONSOLE.addHandler(
        RichHandler(
            markup = True,
            show_path = False,
            rich_tracebacks = True,
            log_time_format = "[%X]",
            omit_repeated_times = False
        )
    )

    # 构造函数
    def __init__(self) -> None:
        # 默认配置
        self.default = {}

        # 获取事件管理器单例
        self.event_manager_singleton = EventManager()

    # 检查是否处于调试模式
    def is_debug(self) -> bool:
        if getattr(Base, "_is_debug", None) == None:
            Base._is_debug = os.path.isfile("./debug.txt")
            Base.LOGGER_CONSOLE.setLevel(logging.DEBUG if Base._is_debug else logging.INFO)

        return Base._is_debug

    # 重置调试模式检查状态
    def reset_debug(self) -> None:
        Base._is_debug = None

    # PRINT
    def print(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            Base.LOGGER_FILE.info(f"{msg}") if file == True else None
            print(f"{msg}") if console == True else None
        elif self.is_debug() == False:
            Base.LOGGER_FILE.info(f"{msg} - {e}") if file == True else None
            print(f"{msg} - {e}") if console == True else None
        else:
            Base.LOGGER_FILE.info(f"{msg}\n{Base.get_trackback(e)}\n") if file == True else None
            print(f"{msg}\n{Base.get_trackback(e)}\n") if console == True else None

    # DEBUG
    def debug(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            Base.LOGGER_FILE.debug(f"{msg}") if file == True else None
            Base.LOGGER_CONSOLE.debug(f"{msg}") if console == True else None
        elif self.is_debug() == False:
            Base.LOGGER_FILE.debug(f"{msg} - {e}") if file == True else None
            Base.LOGGER_CONSOLE.debug(f"{msg} - {e}") if console == True else None
        else:
            Base.LOGGER_FILE.debug(f"{msg}\n{Base.get_trackback(e)}\n") if file == True else None
            Base.LOGGER_CONSOLE.debug(f"{msg}\n{Base.get_trackback(e)}\n") if console == True else None

    # INFO
    def info(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            Base.LOGGER_FILE.info(f"{msg}") if file == True else None
            Base.LOGGER_CONSOLE.info(f"{msg}") if console == True else None
        elif self.is_debug() == False:
            Base.LOGGER_FILE.info(f"{msg} - {e}") if file == True else None
            Base.LOGGER_CONSOLE.info(f"{msg} - {e}") if console == True else None
        else:
            Base.LOGGER_FILE.info(f"{msg}\n{Base.get_trackback(e)}\n") if file == True else None
            Base.LOGGER_CONSOLE.info(f"{msg}\n{Base.get_trackback(e)}\n") if console == True else None

    # ERROR
    def error(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            Base.LOGGER_FILE.error(f"{msg}") if file == True else None
            Base.LOGGER_CONSOLE.error(f"{msg}") if console == True else None
        elif self.is_debug() == False:
            Base.LOGGER_FILE.error(f"{msg} - {e}") if file == True else None
            Base.LOGGER_CONSOLE.error(f"{msg} - {e}") if console == True else None
        else:
            Base.LOGGER_FILE.error(f"{msg}\n{Base.get_trackback(e)}\n") if file == True else None
            Base.LOGGER_CONSOLE.error(f"{msg}\n{Base.get_trackback(e)}\n") if console == True else None

    # WARNING
    def warning(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            Base.LOGGER_FILE.warning(f"{msg}") if file == True else None
            Base.LOGGER_CONSOLE.warning(f"{msg}") if console == True else None
        elif self.is_debug() == False:
            Base.LOGGER_FILE.warning(f"{msg} - {e}") if file == True else None
            Base.LOGGER_CONSOLE.warning(f"{msg} - {e}") if console == True else None
        else:
            Base.LOGGER_FILE.warning(f"{msg}\n{Base.get_trackback(e)}\n") if file == True else None
            Base.LOGGER_CONSOLE.warning(f"{msg}\n{Base.get_trackback(e)}\n") if console == True else None

    # 获取堆栈跟踪
    def get_trackback(e: Exception) -> str:
        return f"{e}\n{("".join(traceback.format_exception(None, e, e.__traceback__))).strip()}"

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
    def subscribe(self, event: int, hanlder: callable) -> None:
        EventManager.get_singleton().subscribe(event, hanlder)

    # 取消订阅事件
    def unsubscribe(self, event: int, hanlder: callable) -> None:
        EventManager.get_singleton().unsubscribe(event, hanlder)