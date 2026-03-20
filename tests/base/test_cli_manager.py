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
        self.error_messages: list[str] = []
        self.error_exceptions: list[BaseException | None] = []

    def info(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

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


def test_prepare_project_context_creates_then_loads_project(
    fs,
    fake_data_manager: FakeDataManager,
) -> None:
    del fs
    manager = CLIManager()
    input_path = Path("/workspace/input/script.txt")
    project_path = Path("/workspace/project/demo.lg")
    input_path.parent.mkdir(parents=True, exist_ok=True)
    input_path.write_text("hello", encoding="utf-8")

    result = manager.prepare_project_context(
        create_args(create=True, input=str(input_path), project=str(project_path))
    )

    assert result is True
    assert fake_data_manager.create_project_calls == [
        (str(input_path), str(project_path))
    ]
    assert fake_data_manager.load_project_calls == [str(project_path)]


def test_prepare_project_context_requires_project_argument() -> None:
    manager = CLIManager()

    result = manager.prepare_project_context(create_args(project=None))

    assert result is False
    assert manager.get_exit_code() == CLIManager.EXIT_CODE_FAILED


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


def test_determine_translation_mode_handles_reset_and_prefilter(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    fake_data_manager.prefilter_needed = True

    mode = manager.determine_translation_mode(
        create_args(reset=True), fake_data_manager, Config()
    )

    assert mode == Base.TranslationMode.NEW
    assert fake_data_manager.prefilter_reasons == ["cli_reset"]
    assert fake_data_manager.replace_all_items_calls == [["item"]]
    assert fake_data_manager.translation_extras == [{}]
    assert fake_data_manager.project_status_updates == [Base.ProjectStatus.NONE]


def test_determine_translation_mode_uses_continue_for_failed_reset_or_processed_project(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    fake_data_manager.prefilter_needed = True
    fake_data_manager.project_status = Base.ProjectStatus.PROCESSED

    reset_failed_mode = manager.determine_translation_mode(
        create_args(reset_failed=True),
        fake_data_manager,
        Config(),
    )
    processed_mode = manager.determine_translation_mode(
        create_args(),
        fake_data_manager,
        Config(),
    )

    assert reset_failed_mode == Base.TranslationMode.CONTINUE
    assert processed_mode == Base.TranslationMode.CONTINUE
    assert fake_data_manager.translation_reset_failed_count == 1
    assert fake_data_manager.prefilter_reasons == ["cli", "cli"]


def test_determine_analysis_mode_covers_reset_failed_and_progress_continue(
    fake_data_manager: FakeDataManager,
) -> None:
    manager = CLIManager()
    fake_data_manager.prefilter_needed = True

    reset_mode = manager.determine_analysis_mode(
        create_args(reset=True),
        fake_data_manager,
        Config(),
    )
    failed_mode = manager.determine_analysis_mode(
        create_args(reset_failed=True),
        fake_data_manager,
        Config(),
    )
    fake_data_manager.analysis_snapshot = {"line": 3}
    continued_mode = manager.determine_analysis_mode(
        create_args(),
        fake_data_manager,
        Config(),
    )

    assert reset_mode == Base.AnalysisMode.RESET
    assert failed_mode == Base.AnalysisMode.CONTINUE
    assert continued_mode == Base.AnalysisMode.CONTINUE
    assert fake_data_manager.analysis_reset_failed_count == 1
    assert fake_data_manager.prefilter_reasons == [
        "cli_analysis_reset",
        "cli_analysis",
        "cli_analysis",
    ]


def test_start_cli_methods_emit_expected_public_events(
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
    manager.determine_translation_mode = lambda args, dm, config: (
        Base.TranslationMode.CONTINUE
    )
    manager.determine_analysis_mode = lambda args, dm, config: Base.AnalysisMode.NEW

    manager.start_translation_cli(create_args(), Config(), snapshot)
    manager.start_analysis_cli(create_args(task="analysis"), Config(), snapshot)

    assert captured_subscriptions == [
        Base.Event.TRANSLATION_TASK,
        Base.Event.ANALYSIS_TASK,
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        Base.Event.TOAST,
    ]
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
    parser = SimpleNamespace(parse_args=lambda: create_args(task=task))
    config = Config()
    snapshot = SimpleNamespace(name="snapshot")
    started_targets: list[str] = []
    monkeypatch.setattr(manager, "build_parser", lambda: parser)
    monkeypatch.setattr(manager, "prepare_project_context", lambda args: True)
    monkeypatch.setattr(manager, "load_cli_config", lambda args: config)
    monkeypatch.setattr(manager, "apply_language_overrides", lambda args, cfg: True)
    monkeypatch.setattr(
        manager,
        "build_quality_snapshot_for_cli",
        lambda **kwargs: snapshot,
    )
    monkeypatch.setattr(
        manager,
        "start_translation_cli",
        lambda args, cfg, qs: started_targets.append("translation"),
    )
    monkeypatch.setattr(
        manager,
        "start_analysis_cli",
        lambda args, cfg, qs: started_targets.append("analysis"),
    )

    result = manager.run()

    assert result is True
    assert started_targets == [expected_target]


def test_run_logs_quality_snapshot_error_and_requests_failed_exit(
    monkeypatch: pytest.MonkeyPatch,
    patch_cli_runtime: FakeLogManager,
) -> None:
    manager = CLIManager()
    parser = SimpleNamespace(parse_args=lambda: create_args())
    requested_exit_codes: list[int] = []
    monkeypatch.setattr(manager, "build_parser", lambda: parser)
    monkeypatch.setattr(manager, "prepare_project_context", lambda args: True)
    monkeypatch.setattr(manager, "load_cli_config", lambda args: Config())
    monkeypatch.setattr(manager, "apply_language_overrides", lambda args, cfg: True)

    def raise_snapshot_error(**kwargs: Any) -> None:
        del kwargs
        try:
            raise RuntimeError("boom")
        except RuntimeError as e:
            raise ValueError("snapshot failed") from e

    monkeypatch.setattr(manager, "build_quality_snapshot_for_cli", raise_snapshot_error)
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
