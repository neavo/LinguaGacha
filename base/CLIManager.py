import argparse
import os
import signal
import time
from typing import Self

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Storage.ProjectStore import ProjectStore
from module.Data.DataManager import DataManager


class CLIManager(Base):
    """命令行管理器"""

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
        parser.add_argument("--source_language", type=str)
        parser.add_argument("--target_language", type=str)

        # Project management arguments
        parser.add_argument("--project", type=str, help="Path to the .lg project file")
        parser.add_argument(
            "--create", action="store_true", help="Create a new project"
        )
        parser.add_argument(
            "--input",
            type=str,
            help="Input source directory or file for project creation",
        )
        parser.add_argument(
            "--continue",
            dest="cont",
            action="store_true",
            help="Continue translation",
        )
        parser.add_argument(
            "--reset", action="store_true", help="Reset and restart translation"
        )

        args = parser.parse_args()

        if not args.cli:
            return False

        # Handle Project Creation or Loading
        project_path = args.project
        if args.create:
            if not args.input or not project_path:
                self.error(
                    "Creating a project requires --input and --project arguments."
                )
                self.exit()
                return True

            if not os.path.exists(args.input):
                self.error(f"Input path does not exist: {args.input}")
                self.exit()
                return True

            self.info(f"Creating project at: {project_path}")
            try:
                # Create project
                ProjectStore().create(args.input, project_path)
            except Exception as e:
                self.error(f"Failed to create project: {e}")
                self.exit()
                return True

        # Load Project
        if project_path:
            if not os.path.exists(project_path):
                self.error(f"Project file not found: {project_path}")
                self.exit()
                return True

            try:
                DataManager.get().load_project(project_path)
                self.info(f"Project loaded: {project_path}")
            except Exception as e:
                self.error(f"Failed to load project: {e}")
                self.exit()
                return True
        else:
            self.error("A project file must be specified using --project.")
            self.exit()
            return True

        config: Config | None = None
        if isinstance(args.config, str) and self.verify_file(args.config):
            config = Config().load(args.config)
        else:
            config = Config().load()

        if not isinstance(args.source_language, str):
            pass
        elif self.verify_language(args.source_language):
            config.source_language = BaseLanguage.Enum(args.source_language)
        else:
            self.error(f"--source_language {Localizer.get().cli_verify_language}")
            self.exit()

        if not isinstance(args.target_language, str):
            pass
        elif self.verify_language(args.target_language):
            config.target_language = BaseLanguage.Enum(args.target_language)
        else:
            self.error(f"--target_language {Localizer.get().cli_verify_language}")
            self.exit()

        # Determine Translation Mode
        mode = Base.TranslationMode.NEW
        project_status = DataManager.get().get_project_status()

        if args.reset:
            mode = Base.TranslationMode.RESET
        elif args.cont:
            mode = Base.TranslationMode.CONTINUE
        elif project_status != Base.ProjectStatus.NONE:
            # If project has progress and no flag specified, default to CONTINUE
            mode = Base.TranslationMode.CONTINUE
        else:
            # Fresh project
            mode = Base.TranslationMode.NEW

        self.emit(
            Base.Event.TRANSLATION_RUN,
            {
                "config": config,
                "mode": mode,
            },
        )

        self.subscribe(Base.Event.TRANSLATION_DONE, self.translation_done)

        return True
