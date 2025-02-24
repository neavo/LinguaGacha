import os
import logging
import traceback
from logging.handlers import TimedRotatingFileHandler

from rich.logging import RichHandler

class LogHelper():

    # 文件日志实例
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

    # 控制台日志实例
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

    # 检查是否处于调试模式
    def is_debug() -> bool:
        if getattr(LogHelper, "_is_debug", None) == None:
            LogHelper._is_debug = os.path.isfile("./debug.txt")
            LogHelper.LOGGER_CONSOLE.setLevel(logging.DEBUG if LogHelper._is_debug else logging.INFO)

        return LogHelper._is_debug

    # 重置调试模式检查状态
    def reset_debug() -> None:
        LogHelper._is_debug = None

    # PRINT
    def print(msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            LogHelper.LOGGER_FILE.info(f"{msg}") if file == True else None
            print(f"{msg}") if console == True else None
        elif LogHelper.is_debug() == False:
            LogHelper.LOGGER_FILE.info(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            print(f"{msg} {e}") if console == True else None
        else:
            LogHelper.LOGGER_FILE.info(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            print(f"{msg}\n{LogHelper.get_trackback(e)}\n") if console == True else None

    # DEBUG
    def debug(msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            LogHelper.LOGGER_FILE.debug(f"{msg}") if file == True else None
            LogHelper.LOGGER_CONSOLE.debug(f"{msg}") if console == True else None
        elif LogHelper.is_debug() == False:
            LogHelper.LOGGER_FILE.debug(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.debug(f"{msg} {e}") if console == True else None
        else:
            LogHelper.LOGGER_FILE.debug(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.debug(f"{msg}\n{LogHelper.get_trackback(e)}\n") if console == True else None

    # INFO
    def info(msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            LogHelper.LOGGER_FILE.info(f"{msg}") if file == True else None
            LogHelper.LOGGER_CONSOLE.info(f"{msg}") if console == True else None
        elif LogHelper.is_debug() == False:
            LogHelper.LOGGER_FILE.info(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.info(f"{msg} {e}") if console == True else None
        else:
            LogHelper.LOGGER_FILE.info(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.info(f"{msg}\n{LogHelper.get_trackback(e)}\n") if console == True else None

    # ERROR
    def error(msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            LogHelper.LOGGER_FILE.error(f"{msg}") if file == True else None
            LogHelper.LOGGER_CONSOLE.error(f"{msg}") if console == True else None
        elif LogHelper.is_debug() == False:
            LogHelper.LOGGER_FILE.error(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.error(f"{msg} {e}") if console == True else None
        else:
            LogHelper.LOGGER_FILE.error(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.error(f"{msg}\n{LogHelper.get_trackback(e)}\n") if console == True else None

    # WARNING
    def warning(msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        if e == None:
            LogHelper.LOGGER_FILE.warning(f"{msg}") if file == True else None
            LogHelper.LOGGER_CONSOLE.warning(f"{msg}") if console == True else None
        elif LogHelper.is_debug() == False:
            LogHelper.LOGGER_FILE.warning(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.warning(f"{msg} {e}") if console == True else None
        else:
            LogHelper.LOGGER_FILE.warning(f"{msg}\n{LogHelper.get_trackback(e)}\n") if file == True else None
            LogHelper.LOGGER_CONSOLE.warning(f"{msg}\n{LogHelper.get_trackback(e)}\n") if console == True else None

    # 获取堆栈跟踪
    def get_trackback(e: Exception) -> str:
        return f"{e}\n{("".join(traceback.format_exception(None, e, e.__traceback__))).strip()}"