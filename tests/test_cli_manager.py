from argparse import Namespace
from types import SimpleNamespace

from base.Base import Base
from base.CLIManager import CLIManager


def test_analysis_task_done_waits_for_export_on_success(monkeypatch) -> None:
    manager = CLIManager()
    manager.waiting_analysis_export = True
    exit_codes: list[int] = []

    monkeypatch.setattr(
        manager,
        "request_process_exit",
        lambda exit_code: exit_codes.append(exit_code),
    )

    manager.analysis_task_done(
        Base.Event.ANALYSIS_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "final_status": "SUCCESS",
        },
    )

    assert exit_codes == []
    assert manager.waiting_analysis_export is True


def test_analysis_export_glossary_done_maps_terminal_exit_code(monkeypatch) -> None:
    manager = CLIManager()
    exit_codes: list[int] = []

    monkeypatch.setattr(
        manager,
        "request_process_exit",
        lambda exit_code: exit_codes.append(exit_code),
    )

    manager.analysis_export_glossary_done(
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.DONE},
    )
    manager.analysis_export_glossary_done(
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.ERROR},
    )

    assert exit_codes == [CLIManager.EXIT_CODE_SUCCESS, CLIManager.EXIT_CODE_FAILED]


def test_analysis_cli_toast_exits_when_no_items(monkeypatch) -> None:
    manager = CLIManager()
    manager.cli_task = CLIManager.Task.ANALYSIS
    manager.waiting_analysis_export = True
    exit_codes: list[int] = []

    monkeypatch.setattr(
        manager,
        "request_process_exit",
        lambda exit_code: exit_codes.append(exit_code),
    )

    manager.analysis_cli_toast(
        Base.Event.TOAST,
        {"message": "没有找到需要处理数据，请确认 …"},
    )

    assert exit_codes == [CLIManager.EXIT_CODE_FAILED]
    assert manager.waiting_analysis_export is False


def test_determine_analysis_mode_uses_continue_when_progress_exists() -> None:
    manager = CLIManager()
    called_prefilter: list[tuple[object, str]] = []
    fake_data_manager = SimpleNamespace(
        is_prefilter_needed=lambda config: True,
        run_project_prefilter=lambda config, reason: called_prefilter.append(
            (config, reason)
        ),
        get_analysis_progress_snapshot=lambda: {"line": 3},
        reset_failed_analysis_checkpoints=lambda: None,
    )
    args = Namespace(reset=False, reset_failed=False, cont=False)
    config = object()

    mode = manager.determine_analysis_mode(args, fake_data_manager, config)

    assert mode == Base.AnalysisMode.CONTINUE
    assert called_prefilter == [(config, "cli_analysis")]


def test_start_analysis_cli_emits_quality_snapshot_request(monkeypatch) -> None:
    manager = CLIManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    subscribed: list[Base.Event] = []
    fake_data_manager = object()
    quality_snapshot = object()
    config = SimpleNamespace()

    monkeypatch.setattr(
        "base.CLIManager.DataManager.get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(
        manager,
        "determine_analysis_mode",
        lambda args, dm, config: Base.AnalysisMode.RESET,
    )
    monkeypatch.setattr(
        manager,
        "subscribe",
        lambda event, handler: subscribed.append(event),
    )
    monkeypatch.setattr(
        manager,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    manager.start_analysis_cli(
        Namespace(),
        config=config,
        quality_snapshot=quality_snapshot,
    )

    assert subscribed == [
        Base.Event.ANALYSIS_TASK,
        Base.Event.ANALYSIS_EXPORT_GLOSSARY,
        Base.Event.TOAST,
    ]
    assert emitted == [
        (
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "config": config,
                "mode": Base.AnalysisMode.RESET,
                "quality_snapshot": quality_snapshot,
                "cli_auto_export_glossary": True,
            },
        )
    ]
