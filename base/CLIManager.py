from argparse import Namespace
import argparse
import os
import signal
import time
from typing import Self

from base.Base import Base
from module.Config import Config

class CLIManager(Base):

    def __init__(self) -> None:
        super().__init__()

    @classmethod
    def get(cls) -> Self:
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    def translation_stop_done(self, event: str, data: dict) -> None:
        print("")
        for i in range(3):
            print(f"Exiting … {3 - i} …")
            time.sleep(1)

        os.kill(os.getpid(), signal.SIGTERM)

    def run(self) -> bool:
        parser = argparse.ArgumentParser()
        parser.add_argument("--cli", action = "store_true")
        parser.add_argument("--config", type = str)
        args = parser.parse_args()

        config: Config = None
        if isinstance(args.config, str):
            config = Config().load(args.config)

        if args.cli == True:
            self.emit(Base.Event.TRANSLATION_START, {
                "config": config,
                "status": Base.TranslationStatus.UNTRANSLATED,
            })
            self.subscribe(Base.Event.TRANSLATION_DONE, self.translation_stop_done)

        return args.cli