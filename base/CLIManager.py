import argparse
import os
import signal
import time
from typing import Self

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Localizer.Localizer import Localizer

class CLIManager(Base):
    """命令行管理器

    TODO: CLI 模式目前需要改造以适配工程文件模式
    ------------------------------------------
    原因：
    1. 原设计通过 --input_folder 和 --output_folder 指定目录
    2. 现已移除 Config.input_folder 和 Config.output_folder 字段
    3. 需要改造为基于工程文件（.lg）的工作模式

    修复方案：
    - 添加 --project 参数指定工程文件路径
    - 或添加 --create_project 参数创建新工程
    """

    def __init__(self) -> None:
        super().__init__()

    @classmethod
    def get(cls) -> Self:
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    def translation_done(self, event: Base.Event, data: dict) -> None:
        self.exit()

    def exit(self) -> None:
        print("")
        for i in range(3):
            print(f"退出中 … Exiting … {3 - i} …")
            time.sleep(1)

        os.kill(os.getpid(), signal.SIGTERM)

    def verify_file(self, path: str) -> bool:
        return os.path.isfile(path)

    def verify_folder(self, path: str) -> bool:
        return os.path.isdir(path)

    def verify_language(self, language: str) -> bool:
        return language in BaseLanguage.Enum

    def run(self) -> bool:
        parser = argparse.ArgumentParser()
        parser.add_argument("--cli", action="store_true")
        parser.add_argument("--config", type=str)
        # TODO: 添加 --project 参数以支持工程文件模式
        parser.add_argument("--source_language", type=str)
        parser.add_argument("--target_language", type=str)
        args = parser.parse_args()

        if not args.cli:
            return False

        config: Config = None
        if isinstance(args.config, str) and self.verify_file(args.config):
            config = Config().load(args.config)
        else:
            config = Config().load()

        if not isinstance(args.source_language, str):
            pass
        elif self.verify_language(args.source_language):
            config.source_language = args.source_language
        else:
            self.error(f"--source_language {Localizer.get().cli_verify_language}")
            self.exit()

        if not isinstance(args.target_language, str):
            pass
        elif self.verify_language(args.target_language):
            config.target_language = args.target_language
        else:
            self.error(f"--target_language {Localizer.get().cli_verify_language}")
            self.exit()

        self.emit(
            Base.Event.TRANSLATION_RUN,
            {
                "config": config,
                "status": Base.ProjectStatus.NONE,
            },
        )
        self.subscribe(Base.Event.TRANSLATION_DONE, self.translation_done)

        return True
