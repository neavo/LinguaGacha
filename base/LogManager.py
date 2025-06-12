import logging
import os
import traceback
from logging.handlers import TimedRotatingFileHandler
from typing import Self

from rich.console import Console
from rich.logging import RichHandler

class LogManager():

    PATH: str = "./log"

    def __init__(self) -> None:
        super().__init__()

        # 控制台实例
        self.console = Console()

        # 文件日志实例
        os.makedirs(__class__.PATH, exist_ok = True)
        self.file_handler = TimedRotatingFileHandler(
            f"{__class__.PATH}/app.log",
            when = "midnight",
            interval = 1,
            encoding = "utf-8",
            backupCount = 3,
        )
        self.file_handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt = "%Y-%m-%d %H:%M:%S"))
        self.file_logger = logging.getLogger("app_file")
        self.file_logger.propagate = False
        self.file_logger.setLevel(logging.DEBUG)
        self.file_logger.addHandler(self.file_handler)

        # 控制台日志实例
        self.console_handler = RichHandler(
            markup = True,
            show_path = False,
            rich_tracebacks = False,
            tracebacks_extra_lines = 0,
            log_time_format = "[%X]",
            omit_repeated_times = False,
        )
        self.console_logger = logging.getLogger("app_console")
        self.console_logger.propagate = False
        self.console_logger.setLevel(logging.INFO)
        self.console_logger.addHandler(self.console_handler)

    @classmethod
    def get(cls) -> Self:
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    def is_expert_mode(self) -> bool:
        if getattr(self, "expert_mode", None) is None:
            from module.Config import Config
            self.expert_mode = Config().load().expert_mode
            self.console_logger.setLevel(logging.DEBUG if self.expert_mode == True else logging.INFO)

        return self.expert_mode

    def print(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        msg_e: str = f"{msg} {e}" if msg != "" else f"{e}"
        if e == None:
            self.file_logger.info(f"{msg}") if file == True else None
            self.console.print(f"{msg}") if console == True else None
        elif self.is_expert_mode() == False:
            self.file_logger.info(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console.print(msg_e) if console == True else None
        else:
            self.file_logger.info(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console.print(f"{msg_e}\n{self.get_trackback(e)}\n") if console == True else None

    def debug(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        msg_e: str = f"{msg} {e}" if msg != "" else f"{e}"
        if e == None:
            self.file_logger.debug(f"{msg}") if file == True else None
            self.console_logger.debug(f"{msg}") if console == True else None
        elif self.is_expert_mode() == False:
            self.file_logger.debug(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.debug(msg_e) if console == True else None
        else:
            self.file_logger.debug(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.debug(f"{msg_e}\n{self.get_trackback(e)}\n") if console == True else None

    def info(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        msg_e: str = f"{msg} {e}" if msg != "" else f"{e}"
        if e == None:
            self.file_logger.info(f"{msg}") if file == True else None
            self.console_logger.info(f"{msg}") if console == True else None
        elif self.is_expert_mode() == False:
            self.file_logger.info(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.info(msg_e) if console == True else None
        else:
            self.file_logger.info(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.info(f"{msg_e}\n{self.get_trackback(e)}\n") if console == True else None

    def error(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        msg_e: str = f"{msg} {e}" if msg != "" else f"{e}"
        if e == None:
            self.file_logger.error(f"{msg}") if file == True else None
            self.console_logger.error(f"{msg}") if console == True else None
        elif self.is_expert_mode() == False:
            self.file_logger.error(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.error(msg_e) if console == True else None
        else:
            self.file_logger.error(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.error(f"{msg_e}\n{self.get_trackback(e)}\n") if console == True else None

    def warning(self, msg: str, e: Exception = None, file: bool = True, console: bool = True) -> None:
        msg_e: str = f"{msg} {e}" if msg != "" else f"{e}"
        if e == None:
            self.file_logger.warning(f"{msg}") if file == True else None
            self.console_logger.warning(f"{msg}") if console == True else None
        elif self.is_expert_mode() == False:
            self.file_logger.warning(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.warning(msg_e) if console == True else None
        else:
            self.file_logger.warning(f"{msg_e}\n{self.get_trackback(e)}\n") if file == True else None
            self.console_logger.warning(f"{msg_e}\n{self.get_trackback(e)}\n") if console == True else None

    def get_trackback(self, e: Exception) -> str:
        return f"{("".join(traceback.format_exception(e))).strip()}"