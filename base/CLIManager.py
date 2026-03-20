import argparse
import os
from enum import StrEnum
from typing import Any
from typing import Self

from PySide6.QtCore import QCoreApplication
from PySide6.QtCore import QMetaObject
from PySide6.QtCore import Qt

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleIO import QualityRuleIO
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


class CLIManager(Base):
    """命令行管理器。"""

    class Task(StrEnum):
        TRANSLATION = "translation"
        ANALYSIS = "analysis"

    EXIT_CODE_SUCCESS: int = 0
    EXIT_CODE_FAILED: int = 1
    EXIT_CODE_STOPPED: int = 2
    SUPPORTED_QUALITY_RULE_EXTENSIONS: tuple[str, ...] = (".json", ".xlsx")

    def __init__(self) -> None:
        super().__init__()
        self.exit_code: int | None = None
        self.cli_task: CLIManager.Task | None = None
        self.waiting_analysis_export: bool = False

    @classmethod
    def get(cls) -> Self:
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    def get_exit_code(self) -> int | None:
        return self.exit_code

    def request_process_exit(self, exit_code: int) -> None:
        """CLI 统一走事件循环退出，避免后台线程直接强杀进程。"""
        if self.exit_code is not None:
            return

        self.exit_code = int(exit_code)
        app = QCoreApplication.instance()
        if app is None:
            return

        QMetaObject.invokeMethod(
            app,
            "quit",
            Qt.ConnectionType.QueuedConnection,
        )

    def map_final_status_to_exit_code(self, final_status: str) -> int:
        if final_status == "SUCCESS":
            return self.EXIT_CODE_SUCCESS
        if final_status == "STOPPED":
            return self.EXIT_CODE_STOPPED
        return self.EXIT_CODE_FAILED

    def finish_analysis_exit(self, exit_code: int) -> None:
        """分析 CLI 收尾前统一清掉等待标记，避免各分支重复维护状态。"""
        self.waiting_analysis_export = False
        self.request_process_exit(exit_code)

    def translation_task_done(self, event: Base.Event, data: dict[str, Any]) -> None:
        if event != Base.Event.TRANSLATION_TASK:
            return

        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.ERROR:
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return
        if sub_event != Base.SubEvent.DONE:
            return

        final_status = str(data.get("final_status", "FAILED"))
        self.request_process_exit(self.map_final_status_to_exit_code(final_status))

    def analysis_task_done(self, event: Base.Event, data: dict[str, Any]) -> None:
        if event != Base.Event.ANALYSIS_TASK:
            return

        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.ERROR:
            self.finish_analysis_exit(self.EXIT_CODE_FAILED)
            return
        if sub_event != Base.SubEvent.DONE:
            return

        final_status = str(data.get("final_status", "FAILED"))
        if final_status == "SUCCESS" and self.waiting_analysis_export:
            return

        self.finish_analysis_exit(self.map_final_status_to_exit_code(final_status))

    def analysis_export_glossary_done(
        self, event: Base.Event, data: dict[str, Any]
    ) -> None:
        if event != Base.Event.ANALYSIS_EXPORT_GLOSSARY:
            return

        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.DONE:
            self.finish_analysis_exit(self.EXIT_CODE_SUCCESS)
            return
        if sub_event == Base.SubEvent.ERROR:
            self.finish_analysis_exit(self.EXIT_CODE_FAILED)

    def analysis_cli_toast(self, event: Base.Event, data: dict[str, Any]) -> None:
        """CLI 分析等待导出期间，补上“无可分析条目”这类不会发 DONE 的退出口。"""
        if event != Base.Event.TOAST:
            return
        if self.cli_task != self.Task.ANALYSIS:
            return
        if not self.waiting_analysis_export:
            return

        message = str(data.get("message", ""))
        if message != Localizer.get().engine_no_items:
            return

        self.finish_analysis_exit(self.EXIT_CODE_FAILED)

    def verify_file(self, path: str) -> bool:
        return os.path.isfile(path)

    def verify_folder(self, path: str) -> bool:
        return os.path.isdir(path)

    def verify_language(self, language: str) -> bool:
        return language in BaseLanguage.Enum

    def verify_quality_rule_file(self, arg_name: str, path: str) -> None:
        if not os.path.isfile(path):
            message = (
                Localizer.get()
                .log_cli_quality_rule_file_not_found.replace("{ARG}", arg_name)
                .replace("{PATH}", path)
            )
            raise ValueError(message)

        lower = path.lower()
        if not lower.endswith(self.SUPPORTED_QUALITY_RULE_EXTENSIONS):
            message = (
                Localizer.get()
                .log_cli_quality_rule_file_unsupported.replace("{ARG}", arg_name)
                .replace("{PATH}", path)
            )
            raise ValueError(message)

    def build_quality_snapshot_for_cli(
        self,
        *,
        glossary_path: str | None,
        pre_replacement_path: str | None,
        post_replacement_path: str | None,
        text_preserve_path: str | None,
        text_preserve_mode_arg: str | None,
        translation_custom_prompt_path: str | None,
        analysis_custom_prompt_path: str | None,
        custom_prompt_zh_path: str | None,
        custom_prompt_en_path: str | None,
    ) -> QualityRuleSnapshot:
        """CLI 专用质量规则快照：默认全禁用，仅使用外部文件（不落库）。"""

        def load_rule_list(arg_name: str, path: str) -> list[dict[str, Any]]:
            self.verify_quality_rule_file(arg_name, path)
            try:
                return QualityRuleIO.load_rules_from_file(path)
            except Exception as e:
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_import_failed.replace("{ARG}", arg_name)
                    .replace("{PATH}", path)
                    .replace("{REASON}", str(e))
                )
                raise ValueError(message) from e

        def normalize_rule_entries(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
            """统一清理规则项，只保留 src 非空的有效行。"""

            return [
                dict(value)
                for value in data
                if isinstance(value, dict) and str(value.get("src", "")).strip() != ""
            ]

        # 默认：不使用任何规则（包含工程内 rules/meta）。
        glossary_enable = False
        glossary_entries: list[dict[str, Any]] = []
        text_preserve_mode = DataManager.TextPreserveMode.OFF
        text_preserve_entries: tuple[dict[str, Any], ...] = ()
        pre_replacement_enable = False
        pre_replacement_entries: tuple[dict[str, Any], ...] = ()
        post_replacement_enable = False
        post_replacement_entries: tuple[dict[str, Any], ...] = ()
        translation_prompt_enable = False
        translation_prompt = ""
        analysis_prompt_enable = False
        analysis_prompt = ""

        if isinstance(glossary_path, str) and glossary_path:
            data = load_rule_list("--glossary", glossary_path)
            glossary_enable = True
            glossary_entries = normalize_rule_entries(data)

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
                raise ValueError(message)

            data = load_rule_list("--text_preserve", text_preserve_path)
            text_preserve_mode = DataManager.TextPreserveMode.CUSTOM
            text_preserve_entries = tuple(normalize_rule_entries(data))
        elif effective_text_preserve_mode == DataManager.TextPreserveMode.SMART:
            if isinstance(text_preserve_path, str) and text_preserve_path:
                message = (
                    Localizer.get()
                    .log_cli_text_preserve_mode_invalid.replace("{MODE}", "smart")
                    .replace("{PATH}", text_preserve_path)
                )
                raise ValueError(message)
            text_preserve_mode = DataManager.TextPreserveMode.SMART
        else:
            if isinstance(text_preserve_path, str) and text_preserve_path:
                message = (
                    Localizer.get()
                    .log_cli_text_preserve_mode_invalid.replace("{MODE}", "off")
                    .replace("{PATH}", text_preserve_path)
                )
                raise ValueError(message)
            text_preserve_mode = DataManager.TextPreserveMode.OFF

        if isinstance(pre_replacement_path, str) and pre_replacement_path:
            data = load_rule_list("--pre_replacement", pre_replacement_path)
            pre_replacement_enable = True
            pre_replacement_entries = tuple(normalize_rule_entries(data))

        if isinstance(post_replacement_path, str) and post_replacement_path:
            data = load_rule_list("--post_replacement", post_replacement_path)
            post_replacement_enable = True
            post_replacement_entries = tuple(normalize_rule_entries(data))

        def load_text_prompt(arg_name: str, path: str) -> str:
            if not os.path.isfile(path):
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_file_not_found.replace("{ARG}", arg_name)
                    .replace("{PATH}", path)
                )
                raise ValueError(message)
            try:
                with open(path, "r", encoding="utf-8-sig") as reader:
                    return reader.read().strip()
            except Exception as e:
                message = (
                    Localizer.get()
                    .log_cli_quality_rule_import_failed.replace("{ARG}", arg_name)
                    .replace("{PATH}", path)
                    .replace("{REASON}", str(e))
                )
                raise ValueError(message) from e

        def load_first_available_text_prompt(
            prompt_candidates: list[tuple[str, str | None]],
        ) -> str:
            """按优先级读取第一个可用提示词，兼容旧参数时必须保证顺序稳定。"""

            for arg_name, path in prompt_candidates:
                if not (isinstance(path, str) and path):
                    continue

                prompt_text = load_text_prompt(arg_name, path)
                return prompt_text

            return ""

        selected_translation_prompt = load_first_available_text_prompt(
            [
                ("--translation_custom_prompt", translation_custom_prompt_path),
                ("--custom_prompt_zh", custom_prompt_zh_path),
                ("--custom_prompt_en", custom_prompt_en_path),
            ]
        )
        if selected_translation_prompt:
            translation_prompt_enable = True
            translation_prompt = selected_translation_prompt

        selected_analysis_prompt = load_first_available_text_prompt(
            [
                ("--analysis_custom_prompt", analysis_custom_prompt_path),
            ]
        )
        if selected_analysis_prompt:
            analysis_prompt_enable = True
            analysis_prompt = selected_analysis_prompt

        return QualityRuleSnapshot(
            glossary_enable=glossary_enable,
            text_preserve_mode=text_preserve_mode,
            text_preserve_entries=text_preserve_entries,
            pre_replacement_enable=pre_replacement_enable,
            pre_replacement_entries=pre_replacement_entries,
            post_replacement_enable=post_replacement_enable,
            post_replacement_entries=post_replacement_entries,
            translation_prompt_enable=translation_prompt_enable,
            translation_prompt=translation_prompt,
            analysis_prompt_enable=analysis_prompt_enable,
            analysis_prompt=analysis_prompt,
            glossary_entries=glossary_entries,
        )

    def build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser()
        parser.add_argument("--cli", action="store_true")
        parser.add_argument(
            "--task",
            type=str,
            choices=[self.Task.TRANSLATION.value, self.Task.ANALYSIS.value],
            default=None,
            help="Task type: translation/analysis",
        )
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
            help="Continue current task",
        )

        reset_group = parser.add_mutually_exclusive_group()
        reset_group.add_argument(
            "--reset", action="store_true", help="Reset and restart current task"
        )
        reset_group.add_argument(
            "--reset_failed",
            action="store_true",
            help="Reset failed items and continue current task",
        )

        # Quality rule imports
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
            "--translation_custom_prompt",
            type=str,
            help="Import translation custom prompt text file",
        )
        parser.add_argument(
            "--analysis_custom_prompt",
            type=str,
            help="Import analysis custom prompt text file",
        )
        parser.add_argument(
            "--custom_prompt_zh",
            type=str,
            help="Deprecated: import translation custom prompt (ZH) text file, prefer --translation_custom_prompt",
        )
        parser.add_argument(
            "--custom_prompt_en",
            type=str,
            help="Deprecated: import translation custom prompt (EN) text file, prefer --translation_custom_prompt",
        )
        return parser

    def prepare_project_context(self, args: argparse.Namespace) -> bool:
        """统一完成建项/载入，避免分析与翻译各自维护一套校验。"""
        project_path = args.project
        if args.create:
            if not args.input or not project_path:
                LogManager.get().error(
                    "Creating a project requires --input and --project arguments."
                )
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False

            if not os.path.exists(args.input):
                LogManager.get().error(f"Input path does not exist: {args.input}")
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False

            LogManager.get().info(f"Creating project at: {project_path}")
            try:
                DataManager.get().create_project(args.input, project_path)
            except Exception as e:
                LogManager.get().error(f"Failed to create project: {project_path}", e)
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False

        if project_path:
            if not os.path.exists(project_path):
                LogManager.get().error(f"Project file not found: {project_path}")
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False

            try:
                DataManager.get().load_project(project_path)
                LogManager.get().info(f"Project loaded: {project_path}")
            except Exception as e:
                LogManager.get().error(f"Failed to load project - {project_path}", e)
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False
            return True

        LogManager.get().error("A project file must be specified using --project …")
        self.request_process_exit(self.EXIT_CODE_FAILED)
        return False

    def load_cli_config(self, args: argparse.Namespace) -> Config:
        if isinstance(args.config, str) and self.verify_file(args.config):
            return Config().load(args.config)
        return Config().load()

    def apply_language_overrides(
        self,
        args: argparse.Namespace,
        config: Config,
    ) -> bool:
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
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False

        if isinstance(args.target_language, str):
            target_language = args.target_language.strip().upper()
            if target_language == BaseLanguage.ALL:
                LogManager.get().error(
                    f"--target_language {Localizer.get().log_cli_target_language_all_unsupported}"
                )
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False
            if self.verify_language(target_language):
                config.target_language = BaseLanguage.Enum(target_language)
                return True

            LogManager.get().error(
                f"--target_language {Localizer.get().log_cli_verify_language}"
            )
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return False

        return True

    def determine_translation_mode(
        self,
        args: argparse.Namespace,
        dm: DataManager,
        config: Config,
    ) -> Base.TranslationMode | None:
        mode = Base.TranslationMode.NEW

        if args.reset:
            if not self.translation_reset_sync(config):
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return None
            dm.run_project_prefilter(config, reason="cli_reset")
            return Base.TranslationMode.NEW

        project_status = dm.get_project_status()
        if getattr(args, "reset_failed", False):
            self.translation_reset_failed_sync()
            mode = Base.TranslationMode.CONTINUE
        elif args.cont:
            mode = Base.TranslationMode.CONTINUE
        elif project_status != Base.ProjectStatus.NONE:
            mode = Base.TranslationMode.CONTINUE

        # CLI 覆盖语言或开关时，需要在启动前把过滤结果稳定落库。
        if dm.is_prefilter_needed(config):
            dm.run_project_prefilter(config, reason="cli")
        return mode

    def determine_analysis_mode(
        self,
        args: argparse.Namespace,
        dm: DataManager,
        config: Config,
    ) -> Base.AnalysisMode:
        if dm.is_prefilter_needed(config):
            reason = "cli_analysis_reset" if args.reset else "cli_analysis"
            dm.run_project_prefilter(config, reason=reason)

        if getattr(args, "reset_failed", False):
            self.analysis_reset_failed_sync()
            return Base.AnalysisMode.CONTINUE
        if args.reset:
            return Base.AnalysisMode.RESET
        if args.cont:
            return Base.AnalysisMode.CONTINUE

        analysis_snapshot = dm.get_analysis_progress_snapshot()
        if int(analysis_snapshot.get("line", 0) or 0) > 0:
            return Base.AnalysisMode.CONTINUE
        return Base.AnalysisMode.NEW

    def start_translation_cli(
        self,
        args: argparse.Namespace,
        config: Config,
        quality_snapshot: QualityRuleSnapshot,
    ) -> None:
        dm = DataManager.get()
        mode = self.determine_translation_mode(args, dm, config)
        if mode is None:
            return

        self.subscribe(Base.Event.TRANSLATION_TASK, self.translation_task_done)
        self.emit(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "config": config,
                "mode": mode,
                # CLI 语义：默认不使用工程内规则；若指定外部规则则仅本次生效且不写入工程。
                "quality_snapshot": quality_snapshot,
                "persist_quality_rules": False,
            },
        )

    def start_analysis_cli(
        self,
        args: argparse.Namespace,
        config: Config,
        quality_snapshot: QualityRuleSnapshot,
    ) -> None:
        dm = DataManager.get()
        mode = self.determine_analysis_mode(args, dm, config)

        self.waiting_analysis_export = True
        self.subscribe(Base.Event.ANALYSIS_TASK, self.analysis_task_done)
        self.subscribe(
            Base.Event.ANALYSIS_EXPORT_GLOSSARY,
            self.analysis_export_glossary_done,
        )
        self.subscribe(Base.Event.TOAST, self.analysis_cli_toast)
        self.emit(
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "config": config,
                "mode": mode,
                # CLI 规则覆盖要与翻译口径一致，避免分析提示词参数形同虚设。
                "quality_snapshot": quality_snapshot,
                "cli_auto_export_glossary": True,
            },
        )

    def run(self) -> bool:
        parser = self.build_parser()
        args = parser.parse_args()

        if not args.cli:
            return False

        self.cli_task = (
            self.Task(args.task)
            if isinstance(args.task, str) and args.task
            else self.Task.TRANSLATION
        )

        if not self.prepare_project_context(args):
            return True

        config = self.load_cli_config(args)
        if not self.apply_language_overrides(args, config):
            return True

        try:
            quality_snapshot = self.build_quality_snapshot_for_cli(
                glossary_path=args.glossary,
                pre_replacement_path=args.pre_replacement,
                post_replacement_path=args.post_replacement,
                text_preserve_path=args.text_preserve,
                text_preserve_mode_arg=args.text_preserve_mode,
                translation_custom_prompt_path=args.translation_custom_prompt,
                analysis_custom_prompt_path=args.analysis_custom_prompt,
                custom_prompt_zh_path=args.custom_prompt_zh,
                custom_prompt_en_path=args.custom_prompt_en,
            )
        except ValueError as e:
            cause = e.__cause__
            if isinstance(cause, Exception):
                LogManager.get().error(str(e), cause)
            else:
                LogManager.get().error(str(e))
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return True

        if self.cli_task == self.Task.ANALYSIS:
            self.start_analysis_cli(args, config, quality_snapshot)
        else:
            self.start_translation_cli(args, config, quality_snapshot)

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
        DataManager.get().reset_failed_translation_items_sync()

    def analysis_reset_failed_sync(self) -> None:
        DataManager.get().reset_failed_analysis_checkpoints()
