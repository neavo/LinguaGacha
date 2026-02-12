import argparse
import os
import signal
import time
from typing import Any
from typing import Self

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.QualityRuleIO import QualityRuleIO
from module.Data.QualityRuleSnapshot import QualityRuleSnapshot
from module.Localizer.Localizer import Localizer


class CLIManager(Base):
    """命令行管理器"""

    SUPPORTED_QUALITY_RULE_EXTENSIONS: tuple[str, ...] = (".json", ".xlsx")

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

    def verify_quality_rule_file(self, arg_name: str, path: str) -> bool:
        if not os.path.isfile(path):
            message = (
                Localizer.get()
                .log_cli_quality_rule_file_not_found.replace("{ARG}", arg_name)
                .replace("{PATH}", path)
            )
            LogManager.get().error(message)
            return False

        lower = path.lower()
        if not lower.endswith(self.SUPPORTED_QUALITY_RULE_EXTENSIONS):
            message = (
                Localizer.get()
                .log_cli_quality_rule_file_unsupported.replace("{ARG}", arg_name)
                .replace("{PATH}", path)
            )
            LogManager.get().error(message)
            return False

        return True

    def build_quality_snapshot_for_cli(
        self,
        *,
        glossary_path: str | None,
        pre_replacement_path: str | None,
        post_replacement_path: str | None,
        text_preserve_path: str | None,
        text_preserve_mode_arg: str | None,
        custom_prompt_zh_path: str | None,
        custom_prompt_en_path: str | None,
    ) -> QualityRuleSnapshot | None:
        """CLI 专用质量规则快照：默认全禁用，仅使用外部文件（不落库）。"""

        def load_rule_list(arg_name: str, path: str) -> list[dict[str, Any]] | None:
            if not self.verify_quality_rule_file(arg_name, path):
                return None
            try:
                return QualityRuleIO.load_rules_from_file(path)
            except Exception as e:
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_import_failed.replace("{ARG}", arg_name)
                    .replace("{PATH}", path)
                    .replace("{REASON}", str(e))
                )
                LogManager.get().error(message, e)
                return None

        # 默认：不使用任何规则（包含工程内 rules/meta）。
        glossary_enable = False
        glossary_entries: list[dict[str, Any]] = []
        text_preserve_mode = DataManager.TextPreserveMode.OFF
        text_preserve_entries: tuple[dict[str, Any], ...] = ()
        pre_replacement_enable = False
        pre_replacement_entries: tuple[dict[str, Any], ...] = ()
        post_replacement_enable = False
        post_replacement_entries: tuple[dict[str, Any], ...] = ()
        custom_prompt_zh_enable = False
        custom_prompt_zh = ""
        custom_prompt_en_enable = False
        custom_prompt_en = ""

        if isinstance(glossary_path, str) and glossary_path:
            data = load_rule_list("--glossary", glossary_path)
            if data is None:
                return None
            glossary_enable = True
            glossary_entries = [
                dict(v)
                for v in data
                if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
            ]

        effective_text_preserve_mode: DataManager.TextPreserveMode
        if isinstance(text_preserve_mode_arg, str) and text_preserve_mode_arg:
            effective_text_preserve_mode = DataManager.TextPreserveMode(
                text_preserve_mode_arg
            )
        elif isinstance(text_preserve_path, str) and text_preserve_path:
            # 兼容：仅提供 --text_preserve 时，默认视为 custom。
            effective_text_preserve_mode = DataManager.TextPreserveMode.CUSTOM
        else:
            effective_text_preserve_mode = DataManager.TextPreserveMode.OFF

        if effective_text_preserve_mode == DataManager.TextPreserveMode.CUSTOM:
            if not (isinstance(text_preserve_path, str) and text_preserve_path):
                message = (
                    Localizer.get()
                    .log_cli_text_preserve_mode_invalid.replace("{MODE}", "custom")
                    .replace("{PATH}", "")
                )
                LogManager.get().error(message)
                return None

            data = load_rule_list("--text_preserve", text_preserve_path)
            if data is None:
                return None
            text_preserve_mode = DataManager.TextPreserveMode.CUSTOM
            text_preserve_entries = tuple(
                dict(v)
                for v in data
                if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
            )
        elif effective_text_preserve_mode == DataManager.TextPreserveMode.SMART:
            if isinstance(text_preserve_path, str) and text_preserve_path:
                message = (
                    Localizer.get()
                    .log_cli_text_preserve_mode_invalid.replace("{MODE}", "smart")
                    .replace("{PATH}", text_preserve_path)
                )
                LogManager.get().error(message)
                return None
            text_preserve_mode = DataManager.TextPreserveMode.SMART
        else:
            if isinstance(text_preserve_path, str) and text_preserve_path:
                message = (
                    Localizer.get()
                    .log_cli_text_preserve_mode_invalid.replace("{MODE}", "off")
                    .replace("{PATH}", text_preserve_path)
                )
                LogManager.get().error(message)
                return None
            text_preserve_mode = DataManager.TextPreserveMode.OFF

        if isinstance(pre_replacement_path, str) and pre_replacement_path:
            data = load_rule_list("--pre_replacement", pre_replacement_path)
            if data is None:
                return None
            pre_replacement_enable = True
            pre_replacement_entries = tuple(
                dict(v)
                for v in data
                if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
            )

        if isinstance(post_replacement_path, str) and post_replacement_path:
            data = load_rule_list("--post_replacement", post_replacement_path)
            if data is None:
                return None
            post_replacement_enable = True
            post_replacement_entries = tuple(
                dict(v)
                for v in data
                if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
            )

        if isinstance(custom_prompt_zh_path, str) and custom_prompt_zh_path:
            if not os.path.isfile(custom_prompt_zh_path):
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_file_not_found.replace(
                        "{ARG}", "--custom_prompt_zh"
                    )
                    .replace("{PATH}", custom_prompt_zh_path)
                )
                LogManager.get().error(message)
                return None
            try:
                with open(custom_prompt_zh_path, "r", encoding="utf-8-sig") as reader:
                    custom_prompt_zh = reader.read().strip()
                custom_prompt_zh_enable = True
            except Exception as e:
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_import_failed.replace(
                        "{ARG}", "--custom_prompt_zh"
                    )
                    .replace("{PATH}", custom_prompt_zh_path)
                    .replace("{REASON}", str(e))
                )
                LogManager.get().error(message, e)
                return None

        if isinstance(custom_prompt_en_path, str) and custom_prompt_en_path:
            if not os.path.isfile(custom_prompt_en_path):
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_file_not_found.replace(
                        "{ARG}", "--custom_prompt_en"
                    )
                    .replace("{PATH}", custom_prompt_en_path)
                )
                LogManager.get().error(message)
                return None
            try:
                with open(custom_prompt_en_path, "r", encoding="utf-8-sig") as reader:
                    custom_prompt_en = reader.read().strip()
                custom_prompt_en_enable = True
            except Exception as e:
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_import_failed.replace(
                        "{ARG}", "--custom_prompt_en"
                    )
                    .replace("{PATH}", custom_prompt_en_path)
                    .replace("{REASON}", str(e))
                )
                LogManager.get().error(message, e)
                return None

        glossary_src_set = {str(v.get("src", "")).strip() for v in glossary_entries}

        return QualityRuleSnapshot(
            glossary_enable=glossary_enable,
            text_preserve_mode=text_preserve_mode,
            text_preserve_entries=text_preserve_entries,
            pre_replacement_enable=pre_replacement_enable,
            pre_replacement_entries=pre_replacement_entries,
            post_replacement_enable=post_replacement_enable,
            post_replacement_entries=post_replacement_entries,
            custom_prompt_zh_enable=custom_prompt_zh_enable,
            custom_prompt_zh=custom_prompt_zh,
            custom_prompt_en_enable=custom_prompt_en_enable,
            custom_prompt_en=custom_prompt_en,
            glossary_entries=glossary_entries,
            glossary_src_set=glossary_src_set,
        )

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

        reset_group = parser.add_mutually_exclusive_group()
        reset_group.add_argument(
            "--reset", action="store_true", help="Reset and restart translation"
        )
        reset_group.add_argument(
            "--reset_failed",
            action="store_true",
            help="Reset failed items and continue translation",
        )

        # Quality rule imports (applied before translation starts)
        parser.add_argument(
            "--glossary", type=str, help="Import glossary (.json/.xlsx)"
        )
        parser.add_argument(
            "--pre_replacement", type=str, help="Import pre replacement (.json/.xlsx)"
        )
        parser.add_argument(
            "--post_replacement", type=str, help="Import post replacement (.json/.xlsx)"
        )
        parser.add_argument(
            "--text_preserve", type=str, help="Import text preserve (.json/.xlsx)"
        )
        parser.add_argument(
            "--text_preserve_mode",
            type=str,
            choices=["off", "smart", "custom"],
            default=None,
            help="Text preserve mode: off/smart/custom",
        )
        parser.add_argument(
            "--custom_prompt_zh",
            type=str,
            help="Import custom prompt (ZH) text file",
        )
        parser.add_argument(
            "--custom_prompt_en",
            type=str,
            help="Import custom prompt (EN) text file",
        )

        args = parser.parse_args()

        if not args.cli:
            return False

        # Handle Project Creation or Loading
        project_path = args.project
        if args.create:
            if not args.input or not project_path:
                LogManager.get().error(
                    "Creating a project requires --input and --project arguments."
                )
                self.exit()
                return True

            if not os.path.exists(args.input):
                LogManager.get().error(f"Input path does not exist: {args.input}")
                self.exit()
                return True

            LogManager.get().info(f"Creating project at: {project_path}")
            try:
                # Create project
                DataManager.get().create_project(args.input, project_path)
            except Exception as e:
                LogManager.get().error(f"Failed to create project: {project_path}", e)
                self.exit()
                return True

        # Load Project
        if project_path:
            if not os.path.exists(project_path):
                LogManager.get().error(f"Project file not found: {project_path}")
                self.exit()
                return True

            try:
                DataManager.get().load_project(project_path)
                LogManager.get().info(f"Project loaded: {project_path}")
            except Exception as e:
                LogManager.get().error(f"Failed to load project - {project_path}", e)
                self.exit()
                return True
        else:
            LogManager.get().error("A project file must be specified using --project …")
            self.exit()
            return True

        config: Config | None = None
        if isinstance(args.config, str) and self.verify_file(args.config):
            config = Config().load(args.config)
        else:
            config = Config().load()

        if isinstance(args.source_language, str):
            source_language = args.source_language.strip().upper()
            if source_language == BaseLanguage.ALL:
                config.source_language = BaseLanguage.ALL
            elif self.verify_language(source_language):
                config.source_language = BaseLanguage.Enum(source_language)
            else:
                LogManager.get().error(
                    f"--source_language {Localizer.get().log_cli_verify_language}"
                )
                self.exit()

        if isinstance(args.target_language, str):
            target_language = args.target_language.strip().upper()
            if target_language == BaseLanguage.ALL:
                LogManager.get().error(
                    f"--target_language {Localizer.get().log_cli_target_language_all_unsupported}"
                )
                self.exit()
            elif self.verify_language(target_language):
                config.target_language = BaseLanguage.Enum(target_language)
            else:
                LogManager.get().error(
                    f"--target_language {Localizer.get().log_cli_verify_language}"
                )
                self.exit()

        quality_snapshot = self.build_quality_snapshot_for_cli(
            glossary_path=args.glossary,
            pre_replacement_path=args.pre_replacement,
            post_replacement_path=args.post_replacement,
            text_preserve_path=args.text_preserve,
            text_preserve_mode_arg=args.text_preserve_mode,
            custom_prompt_zh_path=args.custom_prompt_zh,
            custom_prompt_en_path=args.custom_prompt_en,
        )
        if quality_snapshot is None:
            self.exit()
            return True

        # Determine Translation Mode
        dm = DataManager.get()
        mode = Base.TranslationMode.NEW

        if args.reset:
            # RESET 语义：先重建 items 并落库（确保有稳定的 id），再执行预过滤。
            if not self.translation_reset_sync(config):
                self.exit()
                return True
            dm.run_project_prefilter(config, reason="cli_reset")
            mode = Base.TranslationMode.NEW
        else:
            project_status = dm.get_project_status()
            if getattr(args, "reset_failed", False):
                self.translation_reset_failed_sync()
                mode = Base.TranslationMode.CONTINUE
            elif args.cont:
                mode = Base.TranslationMode.CONTINUE
            elif project_status != Base.ProjectStatus.NONE:
                # If project has progress and no flag specified, default to CONTINUE
                mode = Base.TranslationMode.CONTINUE

            # 已移除翻译开始阶段的过滤：CLI 若覆盖语言/开关，必须在启动翻译前重算并落库。
            if dm.is_prefilter_needed(config):
                dm.run_project_prefilter(config, reason="cli")

        self.emit(
            Base.Event.TRANSLATION_RUN,
            {
                "config": config,
                "mode": mode,
                # CLI 语义：默认不使用工程内规则；若指定外部规则则仅本次生效且不写入工程。
                "quality_snapshot": quality_snapshot,
                "persist_quality_rules": False,
            },
        )

        self.subscribe(Base.Event.TRANSLATION_DONE, self.translation_done)

        return True

    def translation_reset_sync(self, config: Config) -> bool:
        dm = DataManager.get()
        if not dm.is_loaded():
            return False

        try:
            # RESET 模式下强制重解析 Assets，得到“初始状态”的 items。
            items = dm.get_items_for_translation(config, Base.TranslationMode.RESET)
            dm.replace_all_items(items)
            dm.set_translation_extras({})
            dm.set_project_status(Base.ProjectStatus.NONE)
            return True
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            return False

    def translation_reset_failed_sync(self) -> None:
        dm = DataManager.get()
        dm.reset_failed_items_sync()
