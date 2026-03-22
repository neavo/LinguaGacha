from __future__ import annotations

import argparse
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from base.Base import Base
from base.BaseLanguage import BaseLanguage
import base.CLIManager as cli_manager_module
from base.CLIManager import CLIManager
from module.Config import Config


class FakeLogManager:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.error_messages: list[str] = []
        self.error_exceptions: list[BaseException | None] = []

    def info(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def warning(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.warning_messages.append(msg)

    def error(self, msg: str, e: BaseException | None = None) -> None:
        self.error_messages.append(msg)
        self.error_exceptions.append(e)


class FakeDataManager:
    def __init__(self) -> None:
        self.create_project_calls: list[tuple[str, str]] = []
        self.load_project_calls: list[str] = []
        self.prefilter_reasons: list[str] = []
        self.translation_reset_failed_count: int = 0
        self.analysis_reset_failed_count: int = 0
        self.replace_all_items_calls: list[list[object]] = []
        self.translation_extras: list[dict[str, Any]] = []
        self.project_status_updates: list[Base.ProjectStatus] = []
        self.translation_reset_items: list[object] = ["item"]
        self.project_status: Base.ProjectStatus = Base.ProjectStatus.NONE
        self.prefilter_needed: bool = False
        self.analysis_snapshot: dict[str, Any] = {"line": 0}
        self.loaded: bool = True

    def create_project(self, input_path: str, project_path: str) -> None:
        self.create_project_calls.append((input_path, project_path))
        Path(project_path).parent.mkdir(parents=True, exist_ok=True)
        Path(project_path).write_text("{}", encoding="utf-8")

    def load_project(self, project_path: str) -> None:
        self.load_project_calls.append(project_path)

    def is_prefilter_needed(self, config: Config) -> bool:
        del config
        return self.prefilter_needed

    def run_project_prefilter(self, config: Config, *, reason: str) -> None:
        del config
        self.prefilter_reasons.append(reason)

    def get_project_status(self) -> Base.ProjectStatus:
        return self.project_status

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        return dict(self.analysis_snapshot)

    def reset_failed_translation_items_sync(self) -> dict[str, Any]:
        self.translation_reset_failed_count += 1
        return {}

    def reset_failed_analysis_checkpoints(self) -> int:
        self.analysis_reset_failed_count += 1
        return 1

    def is_loaded(self) -> bool:
        return self.loaded

    def get_items_for_translation(
        self, config: Config, mode: Base.TranslationMode
    ) -> list[object]:
        del config
        assert mode == Base.TranslationMode.RESET
        return list(self.translation_reset_items)

    def replace_all_items(self, items: list[object]) -> None:
        self.replace_all_items_calls.append(items)

    def set_translation_extras(self, extras: dict[str, Any]) -> None:
        self.translation_extras.append(extras)

    def set_project_status(self, status: Base.ProjectStatus) -> None:
        self.project_status_updates.append(status)


@pytest.fixture(autouse=True)
def patch_cli_runtime(monkeypatch: pytest.MonkeyPatch) -> FakeLogManager:
    logger = FakeLogManager()
    localizer = SimpleNamespace(
        log_cli_quality_rule_file_not_found="missing {ARG} {PATH}",
        log_cli_quality_rule_file_unsupported="unsupported {ARG} {PATH}",
        log_cli_quality_rule_import_failed="import failed {ARG} {PATH} {REASON}",
        log_cli_text_preserve_mode_invalid="invalid mode {MODE} {PATH}",
        log_cli_verify_language="invalid language",
        log_cli_target_language_all_unsupported="target all unsupported",
        log_cli_create_deprecated="create deprecated",
        log_cli_continue_deprecated="continue deprecated",
        engine_no_items="no_items",
        task_failed="task_failed",
    )
    monkeypatch.setattr(cli_manager_module.LogManager, "get", lambda: logger)
    monkeypatch.setattr(
        cli_manager_module.Localizer,
        "get",
        staticmethod(lambda: localizer),
    )
    monkeypatch.setattr(cli_manager_module.QCoreApplication, "instance", lambda: None)
    return logger


@pytest.fixture
def fake_data_manager(monkeypatch: pytest.MonkeyPatch) -> FakeDataManager:
    manager = FakeDataManager()
    monkeypatch.setattr(cli_manager_module.DataManager, "get", lambda: manager)
    return manager


def create_args(**overrides: Any) -> argparse.Namespace:
    defaults: dict[str, Any] = {
        "cli": True,
        "task": None,
        "config": None,
        "source_language": None,
        "target_language": None,
        "project": "/workspace/demo/demo.lg",
        "create": False,
        "input": None,
        "cont": False,
        "reset": False,
        "reset_failed": False,
        "glossary": None,
        "pre_replacement": None,
        "post_replacement": None,
        "text_preserve": None,
        "text_preserve_mode": None,
        "translation_custom_prompt": None,
        "analysis_custom_prompt": None,
        "custom_prompt_zh": None,
        "custom_prompt_en": None,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def create_project_plan(
    *,
    project_path: str = "/workspace/demo/demo.lg",
    input_path: str | None = None,
    should_create: bool = False,
) -> CLIManager.ProjectContextPlan:
    return CLIManager.ProjectContextPlan(
        project_path=project_path,
        input_path=input_path,
        should_create=should_create,
    )


def create_execution_plan(
    *,
    work_mode: CLIManager.WorkMode = CLIManager.WorkMode.NEW_TASK,
    prefilter_reason: str | None = None,
    translation_mode: Base.TranslationMode | None = None,
    analysis_mode: Base.AnalysisMode | None = None,
    should_reset_translation: bool = False,
    should_reset_failed_translation: bool = False,
    should_reset_failed_analysis: bool = False,
) -> CLIManager.TaskExecutionPlan:
    return CLIManager.TaskExecutionPlan(
        work_mode=work_mode,
        prefilter_reason=prefilter_reason,
        translation_mode=translation_mode,
        analysis_mode=analysis_mode,
        should_reset_translation=should_reset_translation,
        should_reset_failed_translation=should_reset_failed_translation,
        should_reset_failed_analysis=should_reset_failed_analysis,
    )


def patch_run_common_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    manager: CLIManager,
    *,
    args: argparse.Namespace,
    config: Config | None = None,
    snapshot: Any | None = None,
    project_plan: CLIManager.ProjectContextPlan | None = None,
) -> tuple[Config, Any, CLIManager.ProjectContextPlan]:
    effective_config = config if config is not None else Config()
    effective_snapshot = (
        snapshot if snapshot is not None else SimpleNamespace(name="snapshot")
    )
    effective_project_plan = (
        project_plan if project_plan is not None else create_project_plan()
    )
    parser = SimpleNamespace(parse_args=lambda: args)
    monkeypatch.setattr(manager, "build_parser", lambda: parser)
    monkeypatch.setattr(
        manager,
        "build_project_context_plan",
        lambda parsed_args: effective_project_plan,
    )
    monkeypatch.setattr(manager, "prepare_project_context", lambda plan: True)
    monkeypatch.setattr(
        manager, "load_cli_config", lambda parsed_args: effective_config
    )
    monkeypatch.setattr(
        manager,
        "apply_language_overrides",
        lambda parsed_args, cfg: True,
    )
    monkeypatch.setattr(
        manager,
        "build_quality_snapshot_from_args",
        lambda parsed_args: effective_snapshot,
    )
    return effective_config, effective_snapshot, effective_project_plan


def test_build_quality_snapshot_for_cli_filters_entries_and_prefers_new_prompt(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    manager = CLIManager()
    glossary_path = Path("/workspace/cli/glossary.json")
    translation_prompt_path = Path("/workspace/cli/translation.txt")
    deprecated_prompt_path = Path("/workspace/cli/translation_zh.txt")
    analysis_prompt_path = Path("/workspace/cli/analysis.txt")
    translation_prompt_path.parent.mkdir(parents=True, exist_ok=True)
    glossary_path.write_text("[]", encoding="utf-8")
    translation_prompt_path.write_text("translation prompt", encoding="utf-8")
    deprecated_prompt_path.write_text("deprecated prompt", encoding="utf-8")
    analysis_prompt_path.write_text("analysis prompt", encoding="utf-8")

    def fake_load_rules(path: str) -> list[dict[str, Any]]:
        assert path == str(glossary_path)
        return [{"src": "HP", "dst": "生命值"}, {"src": "   "}]

    monkeypatch.setattr(
        cli_manager_module.QualityRuleIO,
        "load_rules_from_file",
        fake_load_rules,
    )

    snapshot = manager.build_quality_snapshot_for_cli(
        glossary_path=str(glossary_path),
        pre_replacement_path=None,
        post_replacement_path=None,
        text_preserve_path=None,
        text_preserve_mode_arg=None,
        translation_custom_prompt_path=str(translation_prompt_path),
        analysis_custom_prompt_path=str(analysis_prompt_path),
        custom_prompt_zh_path=str(deprecated_prompt_path),
        custom_prompt_en_path=None,
    )

    assert snapshot.glossary_enable is True
    assert snapshot.glossary_entries == [{"src": "HP", "dst": "生命值"}]
    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "translation prompt"
    assert snapshot.analysis_prompt_enable is True
    assert snapshot.analysis_prompt == "analysis prompt"
    assert not hasattr(snapshot, "glossary_src_set")


@pytest.mark.parametrize(
    ("mode", "path", "expected_mode", "expected_path"),
    [
        ("custom", None, "custom", ""),
        (
            "smart",
            "/workspace/cli/preserve.json",
            "smart",
            "/workspace/cli/preserve.json",
        ),
    ],
)
def test_build_quality_snapshot_for_cli_rejects_invalid_text_preserve_combinations(
    mode: str,
    path: str | None,
    expected_mode: str,
    expected_path: str,
) -> None:
    manager = CLIManager()

    with pytest.raises(ValueError) as exc_info:
        manager.build_quality_snapshot_for_cli(
            glossary_path=None,
            pre_replacement_path=None,
            post_replacement_path=None,
            text_preserve_path=path,
            text_preserve_mode_arg=mode,
            translation_custom_prompt_path=None,
            analysis_custom_prompt_path=None,
            custom_prompt_zh_path=None,
            custom_prompt_en_path=None,
        )

    assert str(exc_info.value) == f"invalid mode {expected_mode} {expected_path}"


def test_build_quality_snapshot_for_cli_wraps_rule_import_error(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    manager = CLIManager()
    glossary_path = Path("/workspace/cli/broken.json")
    glossary_path.parent.mkdir(parents=True, exist_ok=True)
    glossary_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(
        cli_manager_module.QualityRuleIO,
        "load_rules_from_file",
        lambda path: (_ for _ in ()).throw(OSError(f"boom:{path}")),
    )

    with pytest.raises(ValueError) as exc_info:
        manager.build_quality_snapshot_for_cli(
            glossary_path=str(glossary_path),
            pre_replacement_path=None,
            post_replacement_path=None,
            text_preserve_path=None,
            text_preserve_mode_arg=None,
            translation_custom_prompt_path=None,
            analysis_custom_prompt_path=None,
            custom_prompt_zh_path=None,
            custom_prompt_en_path=None,
        )

    assert "import failed --glossary" in str(exc_info.value)
    assert isinstance(exc_info.value.__cause__, OSError)


def test_prepare_project_context_creates_then_loads_project_when_input_is_given(
    fs,
    fake_data_manager: FakeDataManager,
) -> None:
    del fs
    manager = CLIManager()
    input_path = Path("/workspace/input/script.txt")
    project_path = Path("/workspace/project/demo.lg")
    input_path.parent.mkdir(parents=True, exist_ok=True)
    input_path.write_text("hello", encoding="utf-8")

    plan = manager.build_project_context_plan(
        create_args(create=True, input=str(input_path), project=str(project_path))
    )
    assert plan == CLIManager.ProjectContextPlan(
        project_path=str(project_path),
        input_path=str(input_path),
        should_create=True,
    )

    result = manager.prepare_project_context(plan)

    assert result is True
    assert fake_data_manager.create_project_calls == [
        (str(input_path), str(project_path))
    ]
    assert fake_data_manager.load_project_calls == [str(project_path)]


def test_prepare_project_context_ignores_create_flag_without_input(
    fs,
    fake_data_manager: FakeDataManager,
) -> None:
    del fs
    manager = CLIManager()
    project_path = Path("/workspace/project/demo.lg")
    project_path.parent.mkdir(parents=True, exist_ok=True)
    project_path.write_text("{}", encoding="utf-8")

    plan = manager.build_project_context_plan(
        create_args(create=True, input=None, project=str(project_path))
    )
    assert plan == CLIManager.ProjectContextPlan(
        project_path=str(project_path),
        input_path=None,
        should_create=False,
    )

    result = manager.prepare_project_context(plan)

    assert result is True
    assert fake_data_manager.create_project_calls == []
    assert fake_data_manager.load_project_calls == [str(project_path)]


def test_build_project_context_plan_requires_project_argument() -> None:
    manager = CLIManager()

    result = manager.build_project_context_plan(create_args(project=None))

    assert result is None
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED


def test_build_parser_help_matches_current_cli_semantics() -> None:
    manager = CLIManager()
    parser = manager.build_parser()
    action_help_map = {
        option: action.help
        for action in parser._actions
        for option in action.option_strings
    }

    assert "only emits a warning" in str(action_help_map["--create"])
    assert "decided by --input" in str(action_help_map["--create"])
    assert "creates or rebuilds the project" in str(action_help_map["--input"])
    assert "only emits a warning" in str(action_help_map["--continue"])
    assert "inferred automatically from current progress" in str(
        action_help_map["--continue"]
    )
    assert "for this CLI run only" in str(action_help_map["--glossary"])
    assert "does not persist into the project" in str(
        action_help_map["--translation_custom_prompt"]
    )
    assert "defaults the mode to custom" in str(action_help_map["--text_preserve"])
    assert "custom requires --text_preserve" in str(
        action_help_map["--text_preserve_mode"]
    )
    assert "used only when --translation_custom_prompt is not provided" in str(
        action_help_map["--custom_prompt_zh"]
    )
    assert "--translation_custom_prompt and --custom_prompt_zh are not provided" in str(
        action_help_map["--custom_prompt_en"]
    )


def test_build_cli_quality_snapshot_args_collects_override_entries() -> None:
    manager = CLIManager()
    args = create_args(
        glossary="/workspace/cli/glossary.json",
        pre_replacement="/workspace/cli/pre.json",
        post_replacement="/workspace/cli/post.json",
        text_preserve="/workspace/cli/preserve.json",
        text_preserve_mode="custom",
        translation_custom_prompt="/workspace/cli/translation.txt",
        analysis_custom_prompt="/workspace/cli/analysis.txt",
        custom_prompt_zh="/workspace/cli/translation_zh.txt",
        custom_prompt_en="/workspace/cli/translation_en.txt",
    )

    snapshot_args = manager.build_cli_quality_snapshot_args(args)

    assert snapshot_args == CLIManager.CLIQualitySnapshotArgs(
        glossary_path="/workspace/cli/glossary.json",
        pre_replacement_path="/workspace/cli/pre.json",
        post_replacement_path="/workspace/cli/post.json",
        text_preserve_path="/workspace/cli/preserve.json",
        text_preserve_mode_arg="custom",
        translation_custom_prompt_path="/workspace/cli/translation.txt",
        analysis_custom_prompt_path="/workspace/cli/analysis.txt",
        custom_prompt_zh_path="/workspace/cli/translation_zh.txt",
        custom_prompt_en_path="/workspace/cli/translation_en.txt",
    )


def test_load_cli_config_uses_given_path_when_file_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = CLIManager()
    captured_paths: list[str | None] = []
    monkeypatch.setattr(
        manager, "verify_file", lambda path: path == "/workspace/config.json"
    )
    monkeypatch.setattr(
        cli_manager_module.Config,
        "load",
        lambda self, path=None: captured_paths.append(path) or self,
    )

    manager.load_cli_config(create_args(config="/workspace/config.json"))
    manager.load_cli_config(create_args(config="/workspace/missing.json"))

    assert captured_paths == ["/workspace/config.json", None]


def test_apply_language_overrides_accepts_source_all_and_target_language(
    fake_data_manager: FakeDataManager,
) -> None:
    del fake_data_manager
    manager = CLIManager()
    config = Config()

    result = manager.apply_language_overrides(
        create_args(source_language="all", target_language="en"),
        config,
    )

    assert result is True
    assert config.source_language == BaseLanguage.ALL
    assert config.target_language == BaseLanguage.Enum.EN


@pytest.mark.parametrize(
    ("field_name", "value"),
    [("source_language", "??"), ("target_language", BaseLanguage.ALL)],
)
def test_apply_language_overrides_rejects_invalid_values(
    field_name: str,
    value: str,
) -> None:
    manager = CLIManager()
    config = Config()

    result = manager.apply_language_overrides(
        create_args(**{field_name: value}), config
    )

    assert result is False
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED


def test_build_translation_execution_plan_handles_reset_and_prefilter(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    fake_data_manager.prefilter_needed = True

    plan = manager.build_translation_execution_plan(
        create_args(reset=True), fake_data_manager, Config()
    )

    assert plan.work_mode == CLIManager.WorkMode.RESET_ALL
    assert plan.translation_mode == Base.TranslationMode.NEW
    assert plan.prefilter_reason == "cli_reset"
    assert plan.should_reset_translation is True
    assert plan.should_reset_failed_translation is False
    assert fake_data_manager.prefilter_reasons == []


def test_build_translation_execution_plan_uses_continue_for_failed_reset_or_processed_project(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    fake_data_manager.prefilter_needed = True
    fake_data_manager.project_status = Base.ProjectStatus.PROCESSED

    reset_failed_plan = manager.build_translation_execution_plan(
        create_args(reset_failed=True),
        fake_data_manager,
        Config(),
    )
    processed_plan = manager.build_translation_execution_plan(
        create_args(),
        fake_data_manager,
        Config(),
    )

    assert reset_failed_plan.work_mode == CLIManager.WorkMode.RESET_FAILED
    assert reset_failed_plan.translation_mode == Base.TranslationMode.CONTINUE
    assert reset_failed_plan.prefilter_reason == "cli"
    assert reset_failed_plan.should_reset_failed_translation is True
    assert processed_plan.work_mode == CLIManager.WorkMode.CONTINUE_TASK
    assert processed_plan.translation_mode == Base.TranslationMode.CONTINUE
    assert processed_plan.prefilter_reason == "cli"
    assert fake_data_manager.translation_reset_failed_count == 0
    assert fake_data_manager.prefilter_reasons == []


def test_build_translation_execution_plan_ignores_continue_flag_and_uses_progress(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()

    new_plan = manager.build_translation_execution_plan(
        create_args(cont=True),
        fake_data_manager,
        Config(),
    )

    fake_data_manager.project_status = Base.ProjectStatus.PROCESSED
    continue_plan = manager.build_translation_execution_plan(
        create_args(cont=True),
        fake_data_manager,
        Config(),
    )

    assert new_plan.work_mode == CLIManager.WorkMode.NEW_TASK
    assert new_plan.translation_mode == Base.TranslationMode.NEW
    assert continue_plan.work_mode == CLIManager.WorkMode.CONTINUE_TASK
    assert continue_plan.translation_mode == Base.TranslationMode.CONTINUE


def test_build_analysis_execution_plan_covers_reset_failed_and_progress_continue(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    fake_data_manager.prefilter_needed = True

    reset_plan = manager.build_analysis_execution_plan(
        create_args(reset=True),
        fake_data_manager,
        Config(),
    )
    failed_plan = manager.build_analysis_execution_plan(
        create_args(reset_failed=True),
        fake_data_manager,
        Config(),
    )
    fake_data_manager.analysis_snapshot = {"line": 3}
    continued_plan = manager.build_analysis_execution_plan(
        create_args(),
        fake_data_manager,
        Config(),
    )

    assert reset_plan.work_mode == CLIManager.WorkMode.RESET_ALL
    assert reset_plan.analysis_mode == Base.AnalysisMode.RESET
    assert reset_plan.prefilter_reason == "cli_analysis_reset"
    assert failed_plan.work_mode == CLIManager.WorkMode.RESET_FAILED
    assert failed_plan.analysis_mode == Base.AnalysisMode.CONTINUE
    assert failed_plan.prefilter_reason == "cli_analysis"
    assert failed_plan.should_reset_failed_analysis is True
    assert continued_plan.work_mode == CLIManager.WorkMode.CONTINUE_TASK
    assert continued_plan.analysis_mode == Base.AnalysisMode.CONTINUE
    assert continued_plan.prefilter_reason == "cli_analysis"
    assert fake_data_manager.analysis_reset_failed_count == 0
    assert fake_data_manager.prefilter_reasons == []


def test_build_analysis_execution_plan_ignores_continue_flag_and_uses_progress(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()

    new_plan = manager.build_analysis_execution_plan(
        create_args(cont=True),
        fake_data_manager,
        Config(),
    )

    fake_data_manager.analysis_snapshot = {"line": 2}
    continue_plan = manager.build_analysis_execution_plan(
        create_args(cont=True),
        fake_data_manager,
        Config(),
    )

    assert new_plan.work_mode == CLIManager.WorkMode.NEW_TASK
    assert new_plan.analysis_mode == Base.AnalysisMode.NEW
    assert continue_plan.work_mode == CLIManager.WorkMode.CONTINUE_TASK
    assert continue_plan.analysis_mode == Base.AnalysisMode.CONTINUE


def test_execute_plans_emit_expected_public_events_and_apply_side_effects(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    captured_subscriptions: list[Base.Event] = []
    emitted_events: list[tuple[Base.Event, dict[str, Any]]] = []
    snapshot = SimpleNamespace(name="snapshot")
    manager.subscribe = lambda event, handler: captured_subscriptions.append(event)
    manager.emit = lambda event, payload: (
        emitted_events.append((event, payload)) or True
    )
    translation_plan = CLIManager.TaskExecutionPlan(
        work_mode=CLIManager.WorkMode.RESET_FAILED,
        prefilter_reason="cli",
        translation_mode=Base.TranslationMode.CONTINUE,
        should_reset_failed_translation=True,
    )
    analysis_plan = CLIManager.TaskExecutionPlan(
        work_mode=CLIManager.WorkMode.RESET_FAILED,
        prefilter_reason="cli_analysis",
        analysis_mode=Base.AnalysisMode.NEW,
        should_reset_failed_analysis=True,
    )

    manager.execute_translation_plan(Config(), snapshot, translation_plan)
    manager.execute_analysis_plan(Config(), snapshot, analysis_plan)

    assert captured_subscriptions == [
        Base.Event.TRANSLATION_TASK,
        Base.Event.ANALYSIS_TASK,
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        Base.Event.TOAST,
    ]
    assert fake_data_manager.translation_reset_failed_count == 1
    assert fake_data_manager.analysis_reset_failed_count == 1
    assert fake_data_manager.prefilter_reasons == ["cli", "cli_analysis"]
    assert emitted_events[0] == (
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.REQUEST,
            "config": emitted_events[0][1]["config"],
            "mode": Base.TranslationMode.CONTINUE,
            "quality_snapshot": snapshot,
            "persist_quality_rules": False,
        },
    )
    assert emitted_events[1] == (
        Base.Event.ANALYSIS_TASK,
        {
            "sub_event": Base.SubEvent.REQUEST,
            "config": emitted_events[1][1]["config"],
            "mode": Base.AnalysisMode.NEW,
            "quality_snapshot": snapshot,
            "cli_auto_export_glossary": True,
        },
    )
    assert manager.waiting_analysis_export is True


@pytest.mark.parametrize(
    ("task", "builder_name", "expected_plan"),
    [
        (
            CLIManager.Task.TRANSLATION,
            "build_translation_execution_plan",
            create_execution_plan(
                translation_mode=Base.TranslationMode.NEW,
            ),
        ),
        (
            CLIManager.Task.ANALYSIS,
            "build_analysis_execution_plan",
            create_execution_plan(
                analysis_mode=Base.AnalysisMode.NEW,
            ),
        ),
    ],
)
def test_build_task_execution_plan_routes_to_matching_builder(
    fake_data_manager: FakeDataManager,
    monkeypatch: pytest.MonkeyPatch,
    task: CLIManager.Task,
    builder_name: str,
    expected_plan: CLIManager.TaskExecutionPlan,
) -> None:
    manager = CLIManager()
    config = Config()
    args = create_args(task=task.value)
    called_builders: list[str] = []
    manager.cli_task = task
    monkeypatch.setattr(
        manager,
        "build_translation_execution_plan",
        lambda parsed_args, dm, cfg: (
            called_builders.append("build_translation_execution_plan") or expected_plan
        ),
    )
    monkeypatch.setattr(
        manager,
        "build_analysis_execution_plan",
        lambda parsed_args, dm, cfg: (
            called_builders.append("build_analysis_execution_plan") or expected_plan
        ),
    )

    result = manager.build_task_execution_plan(args, fake_data_manager, config)

    assert result == expected_plan
    assert called_builders == [builder_name]


@pytest.mark.parametrize(
    ("task", "executor_name"),
    [
        (CLIManager.Task.TRANSLATION, "execute_translation_plan"),
        (CLIManager.Task.ANALYSIS, "execute_analysis_plan"),
    ],
)
def test_execute_task_plan_routes_to_matching_executor(
    monkeypatch: pytest.MonkeyPatch,
    task: CLIManager.Task,
    executor_name: str,
) -> None:
    manager = CLIManager()
    config = Config()
    snapshot = SimpleNamespace(name="snapshot")
    plan = create_execution_plan(
        translation_mode=Base.TranslationMode.NEW,
    )
    called_executors: list[str] = []
    manager.cli_task = task
    monkeypatch.setattr(
        manager,
        "execute_translation_plan",
        lambda cfg, qs, execution_plan: called_executors.append(
            "execute_translation_plan"
        ),
    )
    monkeypatch.setattr(
        manager,
        "execute_analysis_plan",
        lambda cfg, qs, execution_plan: called_executors.append(
            "execute_analysis_plan"
        ),
    )

    manager.execute_task_plan(config, snapshot, plan)

    assert called_executors == [executor_name]


def test_cli_event_handlers_close_translation_and_analysis_exit_paths() -> None:
    manager = CLIManager()

    manager.translation_task_done(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE, "final_status": "STOPPED"},
    )
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_STOPPED

    manager = CLIManager()
    manager.waiting_analysis_export = True
    manager.analysis_task_done(
        Base.Event.ANALYSIS_TASK,
        {"sub_event": Base.SubEvent.DONE, "final_status": "SUCCESS"},
    )
    assert manager.get_exit_code() is None
    manager.analysis_export_glossary_done(
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.DONE},
    )
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_SUCCESS
    assert manager.waiting_analysis_export is False

    manager = CLIManager()
    manager.cli_task = CLIManager.Task.ANALYSIS
    manager.waiting_analysis_export = True
    manager.analysis_cli_toast(
        Base.Event.TOAST,
        {"message": "no_items"},
    )
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED

    manager = CLIManager()
    manager.request_process_exit(CLIManager.EXIT_CODE_STOPPED)
    manager.request_process_exit(CLIManager.EXIT_CODE_SUCCESS)
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_STOPPED


def test_run_returns_false_without_cli_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = CLIManager()
    parser = SimpleNamespace(parse_args=lambda: create_args(cli=False))
    monkeypatch.setattr(manager, "build_parser", lambda: parser)

    assert manager.run() is False


def test_run_warns_for_deprecated_cli_flags(
    monkeypatch: pytest.MonkeyPatch,
    patch_cli_runtime: FakeLogManager,
) -> None:
    manager = CLIManager()
    patch_run_common_dependencies(
        monkeypatch,
        manager,
        args=create_args(create=True, cont=True),
    )
    execution_plan = create_execution_plan(
        translation_mode=Base.TranslationMode.NEW,
    )
    executed_targets: list[CLIManager.TaskExecutionPlan] = []
    monkeypatch.setattr(
        manager,
        "build_task_execution_plan",
        lambda parsed_args, dm, cfg: execution_plan,
    )
    monkeypatch.setattr(
        manager,
        "execute_task_plan",
        lambda cfg, qs, execution_plan: executed_targets.append(execution_plan),
    )

    result = manager.run()

    assert result is True
    assert executed_targets == [execution_plan]
    assert patch_cli_runtime.warning_messages == [
        "create deprecated",
        "continue deprecated",
    ]


@pytest.mark.parametrize(
    ("task", "expected_target"),
    [(None, "translation"), ("analysis", "analysis")],
)
def test_run_routes_to_expected_cli_target(
    monkeypatch: pytest.MonkeyPatch,
    task: str | None,
    expected_target: str,
) -> None:
    manager = CLIManager()
    patch_run_common_dependencies(
        monkeypatch,
        manager,
        args=create_args(task=task),
    )
    captured_tasks: list[CLIManager.Task] = []
    execution_plan = create_execution_plan(
        analysis_mode=Base.AnalysisMode.NEW
        if task == CLIManager.Task.ANALYSIS.value
        else None,
        translation_mode=Base.TranslationMode.NEW
        if task != CLIManager.Task.ANALYSIS.value
        else None,
    )
    monkeypatch.setattr(
        manager,
        "build_task_execution_plan",
        lambda parsed_args, dm, cfg: (
            captured_tasks.append(manager.cli_task) or execution_plan
        ),
    )
    monkeypatch.setattr(
        manager,
        "execute_task_plan",
        lambda cfg, qs, execution_plan: None,
    )

    result = manager.run()

    assert result is True
    assert captured_tasks == [CLIManager.Task(expected_target)]


def test_run_logs_quality_snapshot_error_and_requests_failed_exit(
    monkeypatch: pytest.MonkeyPatch,
    patch_cli_runtime: FakeLogManager,
) -> None:
    manager = CLIManager()
    requested_exit_codes: list[int] = []
    patch_run_common_dependencies(
        monkeypatch,
        manager,
        args=create_args(),
        config=Config(),
    )

    def raise_snapshot_error(parsed_args: argparse.Namespace) -> None:
        del parsed_args
        try:
            raise RuntimeError("boom")
        except RuntimeError as e:
            raise ValueError("snapshot failed") from e

    monkeypatch.setattr(
        manager, "build_quality_snapshot_from_args", raise_snapshot_error
    )
    monkeypatch.setattr(
        manager,
        "request_process_exit",
        lambda exit_code: requested_exit_codes.append(exit_code),
    )

    result = manager.run()

    assert result is True
    assert requested_exit_codes == [CLIManager.EXIT_CODE_FAILED]
    assert patch_cli_runtime.error_messages == ["snapshot failed"]
    assert isinstance(patch_cli_runtime.error_exceptions[0], RuntimeError)


def test_request_process_exit_sets_exit_code_once_and_queues_quit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = CLIManager()
    fake_app = object()
    invoke_calls: list[tuple[object, str, object]] = []

    monkeypatch.setattr(
        cli_manager_module.QCoreApplication, "instance", lambda: fake_app
    )
    monkeypatch.setattr(
        cli_manager_module.QMetaObject,
        "invokeMethod",
        lambda app, method, connection: invoke_calls.append((app, method, connection)),
    )

    manager.request_process_exit(CLIManager.EXIT_CODE_SUCCESS)
    manager.request_process_exit(CLIManager.EXIT_CODE_FAILED)

    assert manager.get_exit_code() == CLIManager.EXIT_CODE_SUCCESS
    assert invoke_calls == [
        (fake_app, "quit", cli_manager_module.Qt.ConnectionType.QueuedConnection),
    ]


@pytest.mark.parametrize(
    ("final_status", "expected_exit_code"),
    [
        ("SUCCESS", CLIManager.EXIT_CODE_SUCCESS),
        ("STOPPED", CLIManager.EXIT_CODE_STOPPED),
        ("FAILED", CLIManager.EXIT_CODE_FAILED),
    ],
)
def test_map_final_status_to_exit_code_covers_public_statuses(
    final_status: str,
    expected_exit_code: int,
) -> None:
    manager = CLIManager()

    assert manager.map_final_status_to_exit_code(final_status) == expected_exit_code


def test_event_handlers_ignore_unrelated_events_and_cover_error_paths() -> None:
    translation_manager = CLIManager()
    translation_manager.translation_task_done(
        Base.Event.ANALYSIS_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )
    translation_manager.translation_task_done(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.REQUEST},
    )
    assert translation_manager.get_exit_code() is None

    translation_error_manager = CLIManager()
    translation_error_manager.translation_task_done(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.ERROR},
    )
    assert translation_error_manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED

    analysis_manager = CLIManager()
    analysis_manager.waiting_analysis_export = True
    analysis_manager.analysis_task_done(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )
    analysis_manager.analysis_task_done(
        Base.Event.ANALYSIS_TASK,
        {"sub_event": Base.SubEvent.REQUEST},
    )
    assert analysis_manager.get_exit_code() is None

    analysis_error_manager = CLIManager()
    analysis_error_manager.waiting_analysis_export = True
    analysis_error_manager.analysis_task_done(
        Base.Event.ANALYSIS_TASK,
        {"sub_event": Base.SubEvent.ERROR},
    )
    assert analysis_error_manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert analysis_error_manager.waiting_analysis_export is False

    analysis_failed_manager = CLIManager()
    analysis_failed_manager.analysis_task_done(
        Base.Event.ANALYSIS_TASK,
        {"sub_event": Base.SubEvent.DONE, "final_status": "FAILED"},
    )
    assert analysis_failed_manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED


def test_analysis_export_and_toast_handlers_only_finish_for_matching_state() -> None:
    export_manager = CLIManager()
    export_manager.waiting_analysis_export = True
    export_manager.analysis_export_glossary_done(
        Base.Event.ANALYSIS_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )
    export_manager.analysis_export_glossary_done(
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.REQUEST},
    )
    assert export_manager.get_exit_code() is None
    assert export_manager.waiting_analysis_export is True

    export_error_manager = CLIManager()
    export_error_manager.waiting_analysis_export = True
    export_error_manager.analysis_export_glossary_done(
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.ERROR},
    )
    assert export_error_manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert export_error_manager.waiting_analysis_export is False

    toast_manager = CLIManager()
    toast_manager.cli_task = CLIManager.Task.ANALYSIS
    toast_manager.waiting_analysis_export = True
    toast_manager.analysis_cli_toast(
        Base.Event.TRANSLATION_TASK,
        {"message": "no_items"},
    )
    toast_manager.analysis_cli_toast(
        Base.Event.TOAST,
        {"message": "different"},
    )
    assert toast_manager.get_exit_code() is None

    idle_toast_manager = CLIManager()
    idle_toast_manager.cli_task = CLIManager.Task.ANALYSIS
    idle_toast_manager.analysis_cli_toast(
        Base.Event.TOAST,
        {"message": "no_items"},
    )
    assert idle_toast_manager.get_exit_code() is None


def test_verify_helpers_and_quality_rule_validation(fs) -> None:
    del fs
    manager = CLIManager()
    file_path = Path("/workspace/cli/existing.json")
    folder_path = Path("/workspace/cli/folder")
    unsupported_path = Path("/workspace/cli/existing.txt")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("[]", encoding="utf-8")
    folder_path.mkdir(parents=True, exist_ok=True)
    unsupported_path.write_text("[]", encoding="utf-8")

    assert manager.verify_file(str(file_path)) is True
    assert manager.verify_file("/workspace/cli/missing.json") is False
    assert manager.verify_folder(str(folder_path)) is True
    assert manager.verify_folder(str(file_path)) is False
    assert manager.verify_language(BaseLanguage.Enum.EN.value) is True
    assert manager.verify_language("??") is False

    with pytest.raises(
        ValueError, match="missing --glossary /workspace/cli/missing.json"
    ):
        manager.verify_quality_rule_file("--glossary", "/workspace/cli/missing.json")

    with pytest.raises(ValueError, match=r"unsupported --glossary .*existing\.txt"):
        manager.verify_quality_rule_file("--glossary", str(unsupported_path))


def test_load_cli_text_prompt_and_first_available_candidate_cover_success_and_errors(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    manager = CLIManager()
    prompt_path = Path("/workspace/cli/translation.txt")
    broken_prompt_path = Path("/workspace/cli/broken.txt")
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text("\ufeff  translated prompt  ", encoding="utf-8")
    broken_prompt_path.write_text("prompt", encoding="utf-8")

    assert (
        manager.load_cli_text_prompt("--translation_custom_prompt", str(prompt_path))
        == "translated prompt"
    )
    assert (
        manager.load_first_available_cli_text_prompt(
            [
                ("--translation_custom_prompt", None),
                ("--custom_prompt_zh", ""),
                ("--custom_prompt_en", str(prompt_path)),
            ]
        )
        == "translated prompt"
    )
    assert manager.load_first_available_cli_text_prompt([]) == ""

    with pytest.raises(
        ValueError,
        match="missing --translation_custom_prompt /workspace/cli/missing.txt",
    ):
        manager.load_cli_text_prompt(
            "--translation_custom_prompt",
            "/workspace/cli/missing.txt",
        )

    original_open = open

    def raise_open_error(path: str, *args: Any, **kwargs: Any):
        if path == str(broken_prompt_path):
            raise OSError("read failed")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", raise_open_error)

    with pytest.raises(
        ValueError, match="import failed --analysis_custom_prompt"
    ) as exc_info:
        manager.load_cli_text_prompt(
            "--analysis_custom_prompt", str(broken_prompt_path)
        )

    assert isinstance(exc_info.value.__cause__, OSError)


def test_build_text_preserve_snapshot_state_covers_custom_smart_and_off(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    manager = CLIManager()
    preserve_path = Path("/workspace/cli/preserve.json")
    preserve_path.parent.mkdir(parents=True, exist_ok=True)
    preserve_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(
        cli_manager_module.QualityRuleIO,
        "load_rules_from_file",
        lambda path: [{"src": "Hero", "dst": "勇者"}, {"src": " "}],
    )

    custom_mode, custom_entries = manager.build_text_preserve_snapshot_state(
        str(preserve_path),
        None,
    )
    smart_mode, smart_entries = manager.build_text_preserve_snapshot_state(
        None,
        "smart",
    )
    off_mode, off_entries = manager.build_text_preserve_snapshot_state(
        None,
        None,
    )

    assert custom_mode == cli_manager_module.DataManager.TextPreserveMode.CUSTOM
    assert custom_entries == ({"src": "Hero", "dst": "勇者"},)
    assert smart_mode == cli_manager_module.DataManager.TextPreserveMode.SMART
    assert smart_entries == ()
    assert off_mode == cli_manager_module.DataManager.TextPreserveMode.OFF
    assert off_entries == ()


def test_build_project_context_plan_rejects_missing_input_path(
    patch_cli_runtime: FakeLogManager,
) -> None:
    manager = CLIManager()

    result = manager.build_project_context_plan(
        create_args(
            input="/workspace/input/missing.txt",
            project="/workspace/project/demo.lg",
        )
    )

    assert result is None
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert patch_cli_runtime.error_messages == [
        "Input path does not exist: /workspace/input/missing.txt"
    ]


def test_prepare_project_context_handles_create_failure(
    fs,
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: FakeDataManager,
    patch_cli_runtime: FakeLogManager,
) -> None:
    del fs
    manager = CLIManager()
    input_path = Path("/workspace/input/script.txt")
    project_path = Path("/workspace/project/demo.lg")
    input_path.parent.mkdir(parents=True, exist_ok=True)
    input_path.write_text("hello", encoding="utf-8")

    def raise_create_error(input_arg: str, project_arg: str) -> None:
        del input_arg, project_arg
        raise OSError("create failed")

    monkeypatch.setattr(fake_data_manager, "create_project", raise_create_error)

    result = manager.prepare_project_context(
        create_project_plan(
            project_path=str(project_path),
            input_path=str(input_path),
            should_create=True,
        )
    )

    assert result is False
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert patch_cli_runtime.error_messages == [
        f"Failed to create project: {project_path}"
    ]
    assert isinstance(patch_cli_runtime.error_exceptions[0], OSError)


def test_prepare_project_context_rejects_missing_project_file(
    fs,
    patch_cli_runtime: FakeLogManager,
) -> None:
    del fs
    manager = CLIManager()
    project_path = Path("/workspace/project/missing.lg")

    result = manager.prepare_project_context(
        create_project_plan(project_path=str(project_path))
    )

    assert result is False
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert patch_cli_runtime.error_messages == [
        f"Project file not found: {project_path}"
    ]


def test_prepare_project_context_handles_load_failure(
    fs,
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: FakeDataManager,
    patch_cli_runtime: FakeLogManager,
) -> None:
    del fs
    manager = CLIManager()
    project_path = Path("/workspace/project/demo.lg")
    project_path.parent.mkdir(parents=True, exist_ok=True)
    project_path.write_text("{}", encoding="utf-8")

    def raise_load_error(project_arg: str) -> None:
        del project_arg
        raise OSError("load failed")

    monkeypatch.setattr(fake_data_manager, "load_project", raise_load_error)

    result = manager.prepare_project_context(
        create_project_plan(project_path=str(project_path))
    )

    assert result is False
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert patch_cli_runtime.error_messages == [
        f"Failed to load project - {project_path}"
    ]
    assert isinstance(patch_cli_runtime.error_exceptions[0], OSError)


@pytest.mark.parametrize(
    ("reset_requested", "reset_failed_requested", "has_progress", "expected_mode"),
    [
        (True, False, False, CLIManager.WorkMode.RESET_ALL),
        (False, True, False, CLIManager.WorkMode.RESET_FAILED),
        (False, False, True, CLIManager.WorkMode.CONTINUE_TASK),
        (False, False, False, CLIManager.WorkMode.NEW_TASK),
    ],
)
def test_determine_cli_work_mode_covers_all_user_intents(
    reset_requested: bool,
    reset_failed_requested: bool,
    has_progress: bool,
    expected_mode: CLIManager.WorkMode,
) -> None:
    manager = CLIManager()

    result = manager.determine_cli_work_mode(
        reset_requested=reset_requested,
        reset_failed_requested=reset_failed_requested,
        has_progress=has_progress,
    )

    assert result == expected_mode


def test_progress_helpers_and_build_quality_snapshot_from_args_cover_public_results(
    fs,
    fake_data_manager: FakeDataManager,
) -> None:
    del fs
    manager = CLIManager()
    prompt_path = Path("/workspace/cli/translation.txt")
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text("prompt", encoding="utf-8")

    fake_data_manager.project_status = Base.ProjectStatus.NONE
    fake_data_manager.analysis_snapshot = {"line": 0}
    assert manager.has_translation_progress(fake_data_manager) is False
    assert manager.has_analysis_progress(fake_data_manager) is False

    fake_data_manager.project_status = Base.ProjectStatus.PROCESSED
    fake_data_manager.analysis_snapshot = {"line": 2}
    assert manager.has_translation_progress(fake_data_manager) is True
    assert manager.has_analysis_progress(fake_data_manager) is True

    snapshot = manager.build_quality_snapshot_from_args(
        create_args(
            translation_custom_prompt=str(prompt_path),
        )
    )
    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "prompt"


def test_execute_translation_plan_handles_reset_failure_and_skips_optional_steps(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    snapshot = SimpleNamespace(name="snapshot")
    subscribed_events: list[Base.Event] = []
    emitted_events: list[Base.Event] = []
    manager.subscribe = lambda event, handler: subscribed_events.append(event)
    manager.emit = lambda event, payload: emitted_events.append(event)
    monkeypatch.setattr(manager, "translation_reset_sync", lambda config: False)

    manager.execute_translation_plan(
        Config(),
        snapshot,
        create_execution_plan(
            work_mode=CLIManager.WorkMode.RESET_ALL,
            translation_mode=Base.TranslationMode.NEW,
            should_reset_translation=True,
        ),
    )

    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED
    assert subscribed_events == []
    assert emitted_events == []
    assert fake_data_manager.prefilter_reasons == []

    manager = CLIManager()
    snapshot = SimpleNamespace(name="snapshot")
    subscribed_events = []
    emitted_events = []
    manager.subscribe = lambda event, handler: subscribed_events.append(event)
    manager.emit = lambda event, payload: emitted_events.append(event)

    manager.execute_translation_plan(
        Config(),
        snapshot,
        create_execution_plan(
            translation_mode=Base.TranslationMode.NEW,
        ),
    )

    assert manager.get_exit_code() is None
    assert subscribed_events == [Base.Event.TRANSLATION_TASK]
    assert emitted_events == [Base.Event.TRANSLATION_TASK]
    assert fake_data_manager.prefilter_reasons == []


def test_execute_analysis_plan_skips_optional_steps_when_not_requested(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    snapshot = SimpleNamespace(name="snapshot")
    subscribed_events: list[Base.Event] = []
    emitted_events: list[Base.Event] = []
    manager.subscribe = lambda event, handler: subscribed_events.append(event)
    manager.emit = lambda event, payload: emitted_events.append(event)

    manager.execute_analysis_plan(
        Config(),
        snapshot,
        create_execution_plan(
            analysis_mode=Base.AnalysisMode.NEW,
        ),
    )

    assert fake_data_manager.analysis_reset_failed_count == 0
    assert fake_data_manager.prefilter_reasons == []
    assert manager.waiting_analysis_export is True
    assert subscribed_events == [
        Base.Event.ANALYSIS_TASK,
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        Base.Event.TOAST,
    ]
    assert emitted_events == [Base.Event.ANALYSIS_TASK]


@pytest.mark.parametrize(
    ("step_name", "expected_calls"),
    [
        ("build_project_context_plan", ["build_project_context_plan"]),
        (
            "prepare_project_context",
            ["build_project_context_plan", "prepare_project_context"],
        ),
        (
            "apply_language_overrides",
            [
                "build_project_context_plan",
                "prepare_project_context",
                "apply_language_overrides",
            ],
        ),
    ],
)
def test_run_short_circuits_when_setup_steps_fail(
    monkeypatch: pytest.MonkeyPatch,
    step_name: str,
    expected_calls: list[str],
) -> None:
    manager = CLIManager()
    args = create_args()
    parser = SimpleNamespace(parse_args=lambda: args)
    invoked_steps: list[str] = []
    project_plan = create_project_plan()

    def build_project_context_plan(
        parsed_args: argparse.Namespace,
    ) -> CLIManager.ProjectContextPlan | None:
        del parsed_args
        invoked_steps.append("build_project_context_plan")
        if step_name == "build_project_context_plan":
            return None
        return project_plan

    def prepare_project_context(plan: CLIManager.ProjectContextPlan) -> bool:
        del plan
        invoked_steps.append("prepare_project_context")
        if step_name == "prepare_project_context":
            return False
        return True

    def apply_language_overrides(
        parsed_args: argparse.Namespace,
        config: Config,
    ) -> bool:
        del parsed_args, config
        invoked_steps.append("apply_language_overrides")
        if step_name == "apply_language_overrides":
            return False
        return True

    monkeypatch.setattr(manager, "build_parser", lambda: parser)
    monkeypatch.setattr(
        manager,
        "build_project_context_plan",
        build_project_context_plan,
    )
    monkeypatch.setattr(
        manager,
        "prepare_project_context",
        prepare_project_context,
    )
    monkeypatch.setattr(manager, "load_cli_config", lambda parsed_args: Config())
    monkeypatch.setattr(
        manager,
        "apply_language_overrides",
        apply_language_overrides,
    )
    monkeypatch.setattr(
        manager,
        "build_quality_snapshot_from_args",
        lambda parsed_args: pytest.fail("quality snapshot should not be built"),
    )

    result = manager.run()

    assert result is True
    assert invoked_steps == expected_calls


def test_run_logs_quality_snapshot_error_without_cause(
    monkeypatch: pytest.MonkeyPatch,
    patch_cli_runtime: FakeLogManager,
) -> None:
    manager = CLIManager()
    requested_exit_codes: list[int] = []
    patch_run_common_dependencies(
        monkeypatch,
        manager,
        args=create_args(),
        config=Config(),
    )
    monkeypatch.setattr(
        manager,
        "build_quality_snapshot_from_args",
        lambda parsed_args: (_ for _ in ()).throw(ValueError("snapshot failed")),
    )
    monkeypatch.setattr(
        manager,
        "request_process_exit",
        lambda exit_code: requested_exit_codes.append(exit_code),
    )

    result = manager.run()

    assert result is True
    assert requested_exit_codes == [CLIManager.EXIT_CODE_FAILED]
    assert patch_cli_runtime.error_messages == ["snapshot failed"]
    assert patch_cli_runtime.error_exceptions == [None]


def test_translation_and_analysis_reset_helpers_cover_success_and_failures(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: FakeDataManager,
    patch_cli_runtime: FakeLogManager,
) -> None:
    manager = CLIManager()
    config = Config()

    assert manager.translation_reset_sync(config) is True
    assert fake_data_manager.replace_all_items_calls == [["item"]]
    assert fake_data_manager.translation_extras == [{}]
    assert fake_data_manager.project_status_updates == [Base.ProjectStatus.NONE]

    fake_data_manager.loaded = False
    assert manager.translation_reset_sync(config) is False

    fake_data_manager.loaded = True

    def raise_reset_error(
        config_arg: Config, mode: Base.TranslationMode
    ) -> list[object]:
        del config_arg, mode
        raise RuntimeError("reset failed")

    monkeypatch.setattr(
        fake_data_manager, "get_items_for_translation", raise_reset_error
    )

    assert manager.translation_reset_sync(config) is False
    assert patch_cli_runtime.error_messages == ["task_failed"]
    assert isinstance(patch_cli_runtime.error_exceptions[0], RuntimeError)

    manager.translation_reset_failed_sync()
    manager.analysis_reset_failed_sync()
    assert fake_data_manager.translation_reset_failed_count == 1
    assert fake_data_manager.analysis_reset_failed_count == 1
