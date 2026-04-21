import argparse
import os
import threading
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from typing import Self

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

    class WorkMode(StrEnum):
        NEW_TASK = "new_task"
        CONTINUE_TASK = "continue_task"
        RESET_ALL = "reset_all"
        RESET_FAILED = "reset_failed"

    @dataclass(frozen=True)
    class ProjectContextPlan:
        """把建项/载入意图固化成不可变计划，避免执行阶段反复读参数。"""

        project_path: str
        input_path: str | None
        should_create: bool

    @dataclass(frozen=True)
    class CLIQualitySnapshotArgs:
        """把 CLI 规则覆盖参数收成单一入口，避免 parser/run 两头散落字段。"""

        glossary_path: str | None
        pre_replacement_path: str | None
        post_replacement_path: str | None
        text_preserve_path: str | None
        text_preserve_mode_arg: str | None
        translation_custom_prompt_path: str | None
        analysis_custom_prompt_path: str | None
        custom_prompt_zh_path: str | None
        custom_prompt_en_path: str | None

    @dataclass(frozen=True)
    class TaskExecutionPlan:
        """统一描述 CLI 任务准备动作与最终引擎模式，减少分支散落。"""

        work_mode: "CLIManager.WorkMode"
        prefilter_reason: str | None
        translation_mode: Base.TranslationMode | None = None
        analysis_mode: Base.AnalysisMode | None = None
        should_reset_translation: bool = False
        should_reset_failed_translation: bool = False
        should_reset_failed_analysis: bool = False

    EXIT_CODE_SUCCESS: int = 0
    EXIT_CODE_FAILED: int = 1
    EXIT_CODE_STOPPED: int = 2
    SUPPORTED_QUALITY_RULE_EXTENSIONS: tuple[str, ...] = (".json", ".xlsx")
    CLI_PREFILTER_REASON_TRANSLATION: str = "cli"
    CLI_PREFILTER_REASON_TRANSLATION_RESET: str = "cli_reset"
    CLI_PREFILTER_REASON_ANALYSIS: str = "cli_analysis"
    CLI_PREFILTER_REASON_ANALYSIS_RESET: str = "cli_analysis_reset"

    def __init__(self) -> None:
        super().__init__()
        self.exit_code: int | None = None
        self.exit_lock = threading.Lock()
        self.exit_requested = threading.Event()
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
        """CLI 统一收口退出码，并唤醒等待中的主线程。"""
        with self.exit_lock:
            if self.exit_code is not None:
                return
            self.exit_code = int(exit_code)

        self.exit_requested.set()

    def wait_for_process_exit(self, timeout: float | None = None) -> int:
        """CLI 主线程等待最终任务终态，避免无头模式提前退出。"""
        finished = self.exit_requested.wait(timeout)
        if not finished:
            raise TimeoutError("CLI 任务退出等待超时")
        if self.exit_code is None:
            return self.EXIT_CODE_FAILED
        return self.exit_code

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

    def normalize_cli_rule_entries(
        self,
        data: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """CLI 外部规则只保留带 src 的有效项，避免空行污染快照。"""
        return [
            dict(value)
            for value in data
            if isinstance(value, dict) and str(value.get("src", "")).strip() != ""
        ]

    def load_cli_rule_entries(self, arg_name: str, path: str) -> list[dict[str, Any]]:
        """所有 CLI 规则文件统一走这里读取，错误包装口径保持一致。"""
        self.verify_quality_rule_file(arg_name, path)
        try:
            data = QualityRuleIO.load_rules_from_file(path)
        except Exception as e:
            message = (
                Localizer.get()
                .log_cli_quality_rule_import_failed.replace("{ARG}", arg_name)
                .replace("{PATH}", path)
                .replace("{REASON}", str(e))
            )
            raise ValueError(message) from e
        return self.normalize_cli_rule_entries(data)

    def load_cli_text_prompt(self, arg_name: str, path: str) -> str:
        """提示词文件复用与规则文件相同的错误包装，避免入口分叉。"""
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

    def load_first_available_cli_text_prompt(
        self,
        prompt_candidates: list[tuple[str, str | None]],
    ) -> str:
        """兼容旧参数时必须保持优先级稳定，所以读取顺序集中维护。"""
        for arg_name, path in prompt_candidates:
            if not (isinstance(path, str) and path):
                continue
            return self.load_cli_text_prompt(arg_name, path)
        return ""

    def resolve_text_preserve_mode(
        self,
        text_preserve_mode_arg: str | None,
        text_preserve_path: str | None,
    ) -> DataManager.TextPreserveMode:
        """文本保留模式只允许一个推导入口，避免 run 和校验逻辑各自猜测。"""
        if isinstance(text_preserve_mode_arg, str) and text_preserve_mode_arg:
            return DataManager.TextPreserveMode(text_preserve_mode_arg)
        if isinstance(text_preserve_path, str) and text_preserve_path:
            # 兼容：仅提供 --text_preserve 时，默认视为 custom。
            return DataManager.TextPreserveMode.CUSTOM
        return DataManager.TextPreserveMode.OFF

    def build_text_preserve_snapshot_state(
        self,
        text_preserve_path: str | None,
        text_preserve_mode_arg: str | None,
    ) -> tuple[DataManager.TextPreserveMode, tuple[dict[str, Any], ...]]:
        """把文本保留模式和条目一起解析，确保快照字段来自同一决策。"""

        def build_invalid_message(path: str | None) -> str:
            effective_path = path if isinstance(path, str) and path else ""
            return (
                Localizer.get()
                .log_cli_text_preserve_mode_invalid.replace(
                    "{MODE}",
                    text_preserve_mode.value,
                )
                .replace("{PATH}", effective_path)
            )

        text_preserve_mode = self.resolve_text_preserve_mode(
            text_preserve_mode_arg,
            text_preserve_path,
        )

        if text_preserve_mode == DataManager.TextPreserveMode.CUSTOM:
            if not (isinstance(text_preserve_path, str) and text_preserve_path):
                raise ValueError(build_invalid_message(None))
            entries = self.load_cli_rule_entries("--text_preserve", text_preserve_path)
            return DataManager.TextPreserveMode.CUSTOM, tuple(entries)
        elif text_preserve_mode == DataManager.TextPreserveMode.SMART:
            if isinstance(text_preserve_path, str) and text_preserve_path:
                raise ValueError(build_invalid_message(text_preserve_path))
            return DataManager.TextPreserveMode.SMART, ()
        else:
            if isinstance(text_preserve_path, str) and text_preserve_path:
                raise ValueError(build_invalid_message(text_preserve_path))
            return DataManager.TextPreserveMode.OFF, ()

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
        glossary_enable = isinstance(glossary_path, str) and glossary_path != ""
        glossary_entries: list[dict[str, Any]] = []
        if glossary_enable:
            glossary_entries = self.load_cli_rule_entries("--glossary", glossary_path)

        text_preserve_mode, text_preserve_entries = (
            self.build_text_preserve_snapshot_state(
                text_preserve_path,
                text_preserve_mode_arg,
            )
        )

        pre_replacement_enable = (
            isinstance(pre_replacement_path, str) and pre_replacement_path != ""
        )
        pre_replacement_entries: tuple[dict[str, Any], ...] = ()
        if pre_replacement_enable:
            pre_replacement_entries = tuple(
                self.load_cli_rule_entries("--pre_replacement", pre_replacement_path)
            )

        post_replacement_enable = (
            isinstance(post_replacement_path, str) and post_replacement_path != ""
        )
        post_replacement_entries: tuple[dict[str, Any], ...] = ()
        if post_replacement_enable:
            post_replacement_entries = tuple(
                self.load_cli_rule_entries(
                    "--post_replacement",
                    post_replacement_path,
                )
            )

        translation_prompt = self.load_first_available_cli_text_prompt(
            [
                ("--translation_custom_prompt", translation_custom_prompt_path),
                ("--custom_prompt_zh", custom_prompt_zh_path),
                ("--custom_prompt_en", custom_prompt_en_path),
            ]
        )
        analysis_prompt = self.load_first_available_cli_text_prompt(
            [
                ("--analysis_custom_prompt", analysis_custom_prompt_path),
            ]
        )

        return QualityRuleSnapshot(
            glossary_enable=glossary_enable,
            text_preserve_mode=text_preserve_mode,
            text_preserve_entries=text_preserve_entries,
            pre_replacement_enable=pre_replacement_enable,
            pre_replacement_entries=pre_replacement_entries,
            post_replacement_enable=post_replacement_enable,
            post_replacement_entries=post_replacement_entries,
            translation_prompt_enable=translation_prompt != "",
            translation_prompt=translation_prompt,
            analysis_prompt_enable=analysis_prompt != "",
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
            "--create",
            action="store_true",
            help="Deprecated: accepted for compatibility and only emits a warning; project creation is now decided by --input",
        )
        parser.add_argument(
            "--input",
            type=str,
            help="Input source directory or file; when provided, CLI creates or rebuilds the project before loading it",
        )
        parser.add_argument(
            "--continue",
            dest="cont",
            action="store_true",
            help="Deprecated: accepted for compatibility and only emits a warning; task mode is now inferred automatically from current progress",
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

        self.add_cli_quality_snapshot_arguments(parser)
        return parser

    def add_cli_quality_snapshot_arguments(
        self,
        parser: argparse.ArgumentParser,
    ) -> None:
        """把 CLI 运行期规则覆盖参数集中定义，减少入口分散。"""
        parser.add_argument(
            "--glossary",
            type=str,
            help="Use glossary rules from an external .json/.xlsx file for this CLI run only; does not persist into the project",
        )
        parser.add_argument(
            "--pre_replacement",
            type=str,
            help="Use pre-translation replacement rules from an external .json/.xlsx file for this CLI run only; does not persist into the project",
        )
        parser.add_argument(
            "--post_replacement",
            type=str,
            help="Use post-translation replacement rules from an external .json/.xlsx file for this CLI run only; does not persist into the project",
        )
        parser.add_argument(
            "--text_preserve",
            type=str,
            help="Use text preserve rules from an external .json/.xlsx file for this CLI run only; providing this without --text_preserve_mode defaults the mode to custom",
        )
        parser.add_argument(
            "--text_preserve_mode",
            type=str,
            choices=["off", "smart", "custom"],
            default=None,
            help="Text preserve mode for this CLI run only: off/smart/custom; custom requires --text_preserve",
        )
        parser.add_argument(
            "--translation_custom_prompt",
            type=str,
            help="Use translation custom prompt text from an external file for this CLI run only; does not persist into the project",
        )
        parser.add_argument(
            "--analysis_custom_prompt",
            type=str,
            help="Use analysis custom prompt text from an external file for this CLI run only; does not persist into the project",
        )
        parser.add_argument(
            "--custom_prompt_zh",
            type=str,
            help="Deprecated fallback for translation custom prompt; used only when --translation_custom_prompt is not provided",
        )
        parser.add_argument(
            "--custom_prompt_en",
            type=str,
            help="Deprecated fallback for translation custom prompt; used only when --translation_custom_prompt and --custom_prompt_zh are not provided",
        )

    def warn_deprecated_cli_flags(self, args: argparse.Namespace) -> None:
        """集中输出弃用参数告警，避免兼容逻辑散落到行为分支里。"""
        if getattr(args, "create", False):
            LogManager.get().warning(Localizer.get().log_cli_create_deprecated)
        if getattr(args, "cont", False):
            LogManager.get().warning(Localizer.get().log_cli_continue_deprecated)

    def build_project_context_plan(
        self,
        args: argparse.Namespace,
    ) -> CLIManager.ProjectContextPlan | None:
        """先解析项目操作计划，确保执行阶段只处理明确动作。"""
        project_path = getattr(args, "project", None)
        input_path = getattr(args, "input", None)

        if not isinstance(project_path, str) or not project_path:
            LogManager.get().error("A project file must be specified using --project …")
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return None

        normalized_input_path: str | None = None
        if isinstance(input_path, str) and input_path:
            if not os.path.exists(input_path):
                LogManager.get().error(f"Input path does not exist: {input_path}")
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return None
            normalized_input_path = input_path

        return self.ProjectContextPlan(
            project_path=project_path,
            input_path=normalized_input_path,
            should_create=normalized_input_path is not None,
        )

    def prepare_project_context(self, plan: CLIManager.ProjectContextPlan) -> bool:
        """统一执行建项/载入计划，确保两类 CLI 任务共用同一条准备链路。"""
        if plan.should_create:
            LogManager.get().info(f"Creating project at: {plan.project_path}")
            try:
                DataManager.get().create_project(plan.input_path, plan.project_path)
            except Exception as e:
                LogManager.get().error(
                    f"Failed to create project: {plan.project_path}",
                    e,
                )
                self.request_process_exit(self.EXIT_CODE_FAILED)
                return False

        if not os.path.exists(plan.project_path):
            LogManager.get().error(f"Project file not found: {plan.project_path}")
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return False

        try:
            DataManager.get().load_project(plan.project_path)
            LogManager.get().info(f"Project loaded: {plan.project_path}")
        except Exception as e:
            LogManager.get().error(
                f"Failed to load project - {plan.project_path}",
                e,
            )
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return False
        return True

    def determine_cli_work_mode(
        self,
        *,
        reset_requested: bool,
        reset_failed_requested: bool,
        has_progress: bool,
    ) -> CLIManager.WorkMode:
        """工作模式是 CLI 层抽象，负责把参数和进度合并成唯一用户意图。"""
        if reset_requested:
            return self.WorkMode.RESET_ALL
        if reset_failed_requested:
            return self.WorkMode.RESET_FAILED
        if has_progress:
            return self.WorkMode.CONTINUE_TASK
        return self.WorkMode.NEW_TASK

    def has_translation_progress(self, dm: DataManager) -> bool:
        """翻译是否继续，只看项目状态这个唯一权威来源。"""
        return dm.get_project_status() != Base.ProjectStatus.NONE

    def has_analysis_progress(self, dm: DataManager) -> bool:
        """分析是否继续，只看进度快照里的当前行号。"""
        analysis_snapshot = dm.get_analysis_progress_snapshot()
        return int(analysis_snapshot.get("line", 0) or 0) > 0

    def load_cli_config(self, args: argparse.Namespace) -> Config:
        if isinstance(args.config, str) and self.verify_file(args.config):
            return Config().load(args.config)
        return Config().load()

    def build_cli_quality_snapshot_args(
        self,
        args: argparse.Namespace,
    ) -> CLIQualitySnapshotArgs:
        """统一从命令行参数提取规则覆盖入口，避免 run 手写长参数列表。"""
        return self.CLIQualitySnapshotArgs(
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

    def build_quality_snapshot_from_args(
        self,
        args: argparse.Namespace,
    ) -> QualityRuleSnapshot:
        """把 CLI 参数入口和快照构建粘合起来，调用方只关心一个入口。"""
        snapshot_args = self.build_cli_quality_snapshot_args(args)
        return self.build_quality_snapshot_for_cli(
            glossary_path=snapshot_args.glossary_path,
            pre_replacement_path=snapshot_args.pre_replacement_path,
            post_replacement_path=snapshot_args.post_replacement_path,
            text_preserve_path=snapshot_args.text_preserve_path,
            text_preserve_mode_arg=snapshot_args.text_preserve_mode_arg,
            translation_custom_prompt_path=snapshot_args.translation_custom_prompt_path,
            analysis_custom_prompt_path=snapshot_args.analysis_custom_prompt_path,
            custom_prompt_zh_path=snapshot_args.custom_prompt_zh_path,
            custom_prompt_en_path=snapshot_args.custom_prompt_en_path,
        )

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

    def build_translation_execution_plan(
        self,
        args: argparse.Namespace,
        dm: DataManager,
        config: Config,
    ) -> CLIManager.TaskExecutionPlan:
        """翻译执行计划把重置、副作用和引擎模式集中到一个对象里。"""
        work_mode = self.determine_cli_work_mode(
            reset_requested=args.reset,
            reset_failed_requested=getattr(args, "reset_failed", False),
            has_progress=self.has_translation_progress(dm),
        )
        prefilter_reason: str | None = None
        if work_mode == self.WorkMode.RESET_ALL:
            prefilter_reason = self.CLI_PREFILTER_REASON_TRANSLATION_RESET
        elif dm.is_prefilter_needed(config):
            prefilter_reason = self.CLI_PREFILTER_REASON_TRANSLATION

        translation_mode = Base.TranslationMode.NEW
        if (
            work_mode == self.WorkMode.CONTINUE_TASK
            or work_mode == self.WorkMode.RESET_FAILED
        ):
            translation_mode = Base.TranslationMode.CONTINUE

        return self.TaskExecutionPlan(
            work_mode=work_mode,
            prefilter_reason=prefilter_reason,
            translation_mode=translation_mode,
            should_reset_translation=work_mode == self.WorkMode.RESET_ALL,
            should_reset_failed_translation=work_mode == self.WorkMode.RESET_FAILED,
        )

    def build_analysis_execution_plan(
        self,
        args: argparse.Namespace,
        dm: DataManager,
        config: Config,
    ) -> CLIManager.TaskExecutionPlan:
        """分析执行计划同样把工作模式映射与副作用声明集中管理。"""
        work_mode = self.determine_cli_work_mode(
            reset_requested=args.reset,
            reset_failed_requested=getattr(args, "reset_failed", False),
            has_progress=self.has_analysis_progress(dm),
        )
        prefilter_reason: str | None = None
        if dm.is_prefilter_needed(config):
            if work_mode == self.WorkMode.RESET_ALL:
                prefilter_reason = self.CLI_PREFILTER_REASON_ANALYSIS_RESET
            else:
                prefilter_reason = self.CLI_PREFILTER_REASON_ANALYSIS

        analysis_mode = Base.AnalysisMode.NEW
        if work_mode == self.WorkMode.RESET_ALL:
            analysis_mode = Base.AnalysisMode.RESET
        elif (
            work_mode == self.WorkMode.CONTINUE_TASK
            or work_mode == self.WorkMode.RESET_FAILED
        ):
            analysis_mode = Base.AnalysisMode.CONTINUE

        return self.TaskExecutionPlan(
            work_mode=work_mode,
            prefilter_reason=prefilter_reason,
            analysis_mode=analysis_mode,
            should_reset_failed_analysis=work_mode == self.WorkMode.RESET_FAILED,
        )

    def build_task_execution_plan(
        self,
        args: argparse.Namespace,
        dm: DataManager,
        config: Config,
    ) -> CLIManager.TaskExecutionPlan:
        """按当前 CLI 任务构建统一执行计划，让 run 保持线性流程。"""
        if self.cli_task == self.Task.ANALYSIS:
            return self.build_analysis_execution_plan(args, dm, config)
        else:
            return self.build_translation_execution_plan(args, dm, config)

    def execute_translation_plan(
        self,
        config: Config,
        quality_snapshot: QualityRuleSnapshot,
        plan: CLIManager.TaskExecutionPlan,
    ) -> None:
        dm = DataManager.get()
        if plan.should_reset_translation and not self.translation_reset_sync(config):
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return
        if plan.should_reset_failed_translation:
            self.translation_reset_failed_sync()
        if isinstance(plan.prefilter_reason, str):
            dm.run_project_prefilter(config, reason=plan.prefilter_reason)

        self.subscribe(Base.Event.TRANSLATION_TASK, self.translation_task_done)
        self.emit(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "config": config,
                "mode": plan.translation_mode,
                # CLI 语义：默认不使用工程内规则；若指定外部规则则仅本次生效且不写入工程。
                "quality_snapshot": quality_snapshot,
                "persist_quality_rules": False,
            },
        )

    def execute_analysis_plan(
        self,
        config: Config,
        quality_snapshot: QualityRuleSnapshot,
        plan: CLIManager.TaskExecutionPlan,
    ) -> None:
        dm = DataManager.get()
        if plan.should_reset_failed_analysis:
            self.analysis_reset_failed_sync()
        if isinstance(plan.prefilter_reason, str):
            dm.run_project_prefilter(config, reason=plan.prefilter_reason)

        self.waiting_analysis_export = True
        self.subscribe(Base.Event.ANALYSIS_TASK, self.analysis_task_done)
        self.subscribe(
            Base.Event.ANALYSIS_EXPORT_GLOSSARY,
            self.analysis_export_glossary_done,
        )
        self.emit(
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "config": config,
                "mode": plan.analysis_mode,
                # CLI 规则覆盖要与翻译口径一致，避免分析提示词参数形同虚设。
                "quality_snapshot": quality_snapshot,
                "cli_auto_export_glossary": True,
            },
        )

    def execute_task_plan(
        self,
        config: Config,
        quality_snapshot: QualityRuleSnapshot,
        plan: CLIManager.TaskExecutionPlan,
    ) -> None:
        """统一执行任务计划，确保 run 只负责串联阶段而不再关心分支细节。"""
        if self.cli_task == self.Task.ANALYSIS:
            self.execute_analysis_plan(config, quality_snapshot, plan)
        else:
            self.execute_translation_plan(config, quality_snapshot, plan)

    def run(self) -> bool:
        parser = self.build_parser()
        args = parser.parse_args()

        if not args.cli:
            return False

        self.exit_code = None
        self.exit_requested.clear()
        self.waiting_analysis_export = False

        self.warn_deprecated_cli_flags(args)
        self.cli_task = (
            self.Task(args.task)
            if isinstance(args.task, str) and args.task
            else self.Task.TRANSLATION
        )

        project_context_plan = self.build_project_context_plan(args)
        if project_context_plan is None:
            return True
        if not self.prepare_project_context(project_context_plan):
            return True

        config = self.load_cli_config(args)
        if not self.apply_language_overrides(args, config):
            return True

        try:
            quality_snapshot = self.build_quality_snapshot_from_args(args)
        except ValueError as e:
            cause = e.__cause__
            if isinstance(cause, Exception):
                LogManager.get().error(str(e), cause)
            else:
                LogManager.get().error(str(e))
            self.request_process_exit(self.EXIT_CODE_FAILED)
            return True

        execution_plan = self.build_task_execution_plan(args, DataManager.get(), config)
        self.execute_task_plan(config, quality_snapshot, execution_plan)
        if self.exit_code is None:
            self.wait_for_process_exit()

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
