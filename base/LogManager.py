import os
import logging
import traceback
from logging.handlers import TimedRotatingFileHandler

from rich.logging import RichHandler

class LogManager():

    # 文件日志实例
    os.makedirs("./log", exist_ok = True)
    LOGGER_FILE = logging.getLogger("linguagacha_file")
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
    LOGGER_FILE.handlers[-1].setFormatter(
        logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt = "%Y-%m-%d %H:%M:%S")
    )

    # 控制台日志实例
    LOGGER_CONSOLE = logging.getLogger("linguagacha_console")
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

    # 检查是否处于专家模式
    @classmethod
    def is_expert_mode(cls) -> bool:
        if getattr(cls, "expert_mode", None) is None:
            from module.Config import Config
            cls.expert_mode = Config().load().expert_mode
            cls.LOGGER_CONSOLE.setLevel(logging.DEBUG if cls.expert_mode else logging.INFO)

        return cls.expert_mode

    @classmethod
    def print(cls, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            cls.LOGGER_FILE.info(f'{msg}') if file == True else None
            print(f'{msg}') if console == True else None
        elif cls.is_expert_mode() == False:
            cls.LOGGER_FILE.info(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            print(f'{msg} {e}') if console == True else None
        else:
            cls.LOGGER_FILE.info(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            print(f'{msg}\n{cls.get_trackback(e)}\n') if console == True else None

    @classmethod
    def debug(cls, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            cls.LOGGER_FILE.debug(f'{msg}') if file == True else None
            cls.LOGGER_CONSOLE.debug(f'{msg}') if console == True else None
        elif cls.is_expert_mode() == False:
            cls.LOGGER_FILE.debug(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.debug(f'{msg} {e}') if console == True else None
        else:
            cls.LOGGER_FILE.debug(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.debug(f'{msg}\n{cls.get_trackback(e)}\n') if console == True else None

    @classmethod
    def info(cls, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            cls.LOGGER_FILE.info(f'{msg}') if file == True else None
            cls.LOGGER_CONSOLE.info(f'{msg}') if console == True else None
        elif cls.is_expert_mode() == False:
            cls.LOGGER_FILE.info(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.info(f'{msg} {e}') if console == True else None
        else:
            cls.LOGGER_FILE.info(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.info(f'{msg}\n{cls.get_trackback(e)}\n') if console == True else None

    @classmethod
    def error(cls, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            cls.LOGGER_FILE.error(f'{msg}') if file == True else None
            cls.LOGGER_CONSOLE.error(f'{msg}') if console == True else None
        elif cls.is_expert_mode() == False:
            cls.LOGGER_FILE.error(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.error(f'{msg} {e}') if console == True else None
        else:
            cls.LOGGER_FILE.error(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.error(f'{msg}\n{cls.get_trackback(e)}\n') if console == True else None

    @classmethod
    def warning(cls, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            cls.LOGGER_FILE.warning(f'{msg}') if file == True else None
            cls.LOGGER_CONSOLE.warning(f'{msg}') if console == True else None
        elif cls.is_expert_mode() == False:
            cls.LOGGER_FILE.warning(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.warning(f'{msg} {e}') if console == True else None
        else:
            cls.LOGGER_FILE.warning(f'{msg}\n{cls.get_trackback(e)}\n') if file == True else None
            cls.LOGGER_CONSOLE.warning(f'{msg}\n{cls.get_trackback(e)}\n') if console == True else None

    @classmethod
    def get_trackback(cls, e: Exception) -> str:
        return f'{e}\n{("".join(traceback.format_exception(None, e, e.__traceback__))).strip()}'
