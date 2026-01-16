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
        parser.add_argument("--cli", action = "store_true")
        parser.add_argument("--config", type = str)
        parser.add_argument("--input_folder", type = str)
        parser.add_argument("--output_folder", type = str)
        parser.add_argument("--source_language", type = str)
        parser.add_argument("--target_language", type = str)
        args = parser.parse_args()

        if args.cli == False:
            return False

        config: Config = None
        if isinstance(args.config, str) and self.verify_file(args.config):
            config = Config().load(args.config)
        else:
            config = Config().load()

        if isinstance(args.input_folder, str) == False:
            pass
        elif self.verify_folder(args.input_folder):
            config.input_folder = args.input_folder
        else:
            self.error(f"--input_folder {Localizer.get().cli_verify_folder}")
            self.exit()

        if isinstance(args.output_folder, str) == False:
            pass
        elif self.verify_folder(args.output_folder):
            config.output_folder = args.output_folder
        else:
            self.error(f"--output_folder {Localizer.get().cli_verify_folder}")
            self.exit()

        if isinstance(args.source_language, str) == False:
            pass
        elif self.verify_language(args.source_language):
            config.source_language = args.source_language
        else:
            self.error(f"--source_language {Localizer.get().cli_verify_language}")
            self.exit()

        if isinstance(args.target_language, str) == False:
            pass
        elif self.verify_language(args.target_language):
            config.target_language = args.target_language
        else:
            self.error(f"--target_language {Localizer.get().cli_verify_language}")
            self.exit()

        self.emit(Base.Event.TRANSLATION_RUN, {
            "config": config,
            "status": Base.ProjectStatus.NONE,
        })
        self.subscribe(Base.Event.TRANSLATION_DONE, self.translation_done)

        return True