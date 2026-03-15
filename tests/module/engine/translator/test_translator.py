from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
import module.Engine.Translator.Translator as translator_module
from module.Engine.Translator.Translator import Translator


class EventRecorder:
    def __init__(self) -> None:
        self.events: list[tuple[Base.Event, dict[str, Any]]] = []

    def emit(self, event: Base.Event, payload: dict[str, Any]) -> bool:
        self.events.append((event, payload))
        return True


class FakeSnapshot:
    def __init__(self) -> None:
        self.merged_entries: list[dict[str, Any]] = []

    def merge_glossary_entries(self, incoming: list[dict[str, Any]]) -> None:
        self.merged_entries.extend(incoming)


class FakeLogger:
    def __init__(self) -> None:
        self.info_calls: list[str] = []
        self.error_calls: list[tuple[str, Exception | None]] = []

    def info(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.info_calls.append(msg)

    def error(self, msg: str, e: Exception | BaseException | None = None) -> None:
        self.error_calls.append((msg, e if isinstance(e, Exception) else None))

    def print(self, msg: str = "") -> None:
        del msg


def create_translator_stub() -> Translator:
    translator = Translator()
    recorder = EventRecorder()
    translator.extras = {}
    translator.items_cache = None
    translator.task_limiter = None
    translator.stop_requested = False
    translator.persist_quality_rules = True
    translator.quality_snapshot = None
    translator.config = Config(
        auto_glossary_enable=False,
        mtool_optimizer_enable=False,
        output_folder_open_on_finish=False,
    )
    translator.emit = recorder.emit  # type: ignore[method-assign]
    translator.emitted_events = recorder.events  # type: ignore[attr-defined]
    return translator


def emitted_events(translator: Translator) -> list[tuple[Base.Event, dict[str, Any]]]:
    return list(getattr(translator, "emitted_events", []))


def has_emitted(
    translator: Translator,
    event: Base.Event,
    payload: dict[str, Any] | None = None,
) -> bool:
    if payload is None:
        return any(
            emitted_event == event for emitted_event, _ in emitted_events(translator)
        )
    return any(
        emitted_event == event and emitted_payload == payload
        for emitted_event, emitted_payload in emitted_events(translator)
    )


class FakeLogManager:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.error_messages: list[str] = []

    def print(self, msg: str = "") -> None:
        del msg

    def info(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def warning(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.warning_messages.append(msg)

    def error(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.error_messages.append(msg)


class InlineThread:
    def __init__(self, target: Any, args: tuple[Any, ...] = (), **kwargs: Any) -> None:
        del kwargs
        self.target = target
        self.args = args

    def start(self) -> None:
        self.target(*self.args)


class FakeProgressBar:
    def __init__(self, *, transient: bool = False) -> None:
        self.transient = transient
        self.last_new: dict[str, int] = {}
        self.updates: list[tuple[int, dict[str, int]]] = []

    def __enter__(self) -> "FakeProgressBar":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        del exc_type, exc, tb
        return False

    def new(self, total: int = 0, completed: int = 0) -> int:
        self.last_new = {"total": total, "completed": completed}
        return 1

    def update(self, pid: int, **kwargs: int) -> None:
        self.updates.append((pid, kwargs))


class FakePromptBuilder:
    def __init__(self, config: Config, quality_snapshot: Any = None) -> None:
        del config, quality_snapshot

    @staticmethod
    def reset() -> None:
        return None

    def build_main(self) -> str:
        return "main-prompt"


class FakeTaskLimiter:
    def __init__(self, rps: int, rpm: int, max_concurrency: int) -> None:
        self.rps = rps
        self.rpm = rpm
        self.max_concurrency = max_concurrency

    def get_concurrency_in_use(self) -> int:
        return 0

    def get_concurrency_limit(self) -> int:
        return self.max_concurrency


class FakeFileManager:
    def __init__(self, config: Config) -> None:
        del config

    def write_to_path(self, items: list[Item]) -> str:
        del items
        return "E:/tmp/output.txt"


def build_localizer() -> Any:
    return SimpleNamespace(
        task_running="task_running",
        task_failed="task_failed",
        translation_page_toast_resetting="resetting",
        export_translation_start="export_start",
        export_translation_success="export_success",
        export_translation_failed="export_failed",
        alert_project_not_loaded="project_not_loaded",
        alert_no_active_model="no_active_model",
        engine_no_items="no_items",
        engine_api_name="api_name",
        api_url="api_url",
        engine_api_model="api_model",
        engine_task_done="task_done",
        engine_task_stop="task_stop",
        engine_task_fail="task_fail",
        translator_mtool_optimizer_post_log="mtool_done",
        export_translation_done="done {PATH}",
    )


def create_engine(status: Base.TaskStatus = Base.TaskStatus.IDLE) -> Any:
    engine = SimpleNamespace(status=status, lock=threading.Lock())
    engine.get_status = lambda: engine.status
    engine.set_status = lambda new_status: setattr(engine, "status", new_status)
    return engine


def create_data_manager(*, loaded: bool, items: list[Item] | None = None) -> Any:
    item_list = items or []
    dm = SimpleNamespace(
        is_loaded=lambda: loaded,
        open_db=MagicMock(),
        close_db=MagicMock(),
        get_project_status=MagicMock(return_value=Base.ProjectStatus.PROCESSING),
        get_translation_extras=MagicMock(return_value={"line": 9, "time": 3}),
        get_analysis_progress_snapshot=MagicMock(return_value={"line": 5, "time": 2}),
        get_analysis_candidate_count=MagicMock(return_value=1),
        get_items_for_translation=MagicMock(return_value=item_list),
        replace_all_items=MagicMock(),
        set_translation_extras=MagicMock(),
        set_project_status=MagicMock(),
        run_project_prefilter=MagicMock(),
        reset_failed_items_sync=MagicMock(return_value={"line": 7}),
        get_all_items=MagicMock(return_value=item_list),
        state_lock=threading.Lock(),
        update_batch=MagicMock(),
        merge_glossary_incoming=MagicMock(return_value=([], {})),
    )
    return dm


def setup_common_patches(
    monkeypatch: pytest.MonkeyPatch,
    *,
    engine: Any,
    dm: Any,
    logger: FakeLogManager,
) -> None:
    monkeypatch.setattr(translator_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(translator_module.DataManager, "get", staticmethod(lambda: dm))
    monkeypatch.setattr(
        translator_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(
        translator_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(translator_module.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(translator_module.time, "time", lambda: 100.0)
    monkeypatch.setattr(
        translator_module.TextProcessor, "reset", staticmethod(lambda: None)
    )
    monkeypatch.setattr(
        translator_module.TaskRequester, "reset", staticmethod(lambda: None)
    )
    monkeypatch.setattr(
        translator_module.PromptBuilder, "reset", staticmethod(lambda: None)
    )


def test_get_concurrency_helpers_return_zero_without_limiter() -> None:
    translator = create_translator_stub()
    assert Translator.get_concurrency_in_use(translator) == 0
    assert Translator.get_concurrency_limit(translator) == 0


def test_get_concurrency_helpers_delegate_to_limiter() -> None:
    translator = create_translator_stub()
    translator.task_limiter = SimpleNamespace(
        get_concurrency_in_use=lambda: 3,
        get_concurrency_limit=lambda: 9,
    )

    assert Translator.get_concurrency_in_use(translator) == 3
    assert Translator.get_concurrency_limit(translator) == 9


def test_update_extras_snapshot_accumulates_runtime_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.extras = {
        "processed_line": 2,
        "error_line": 1,
        "total_tokens": 10,
        "total_input_tokens": 6,
        "total_output_tokens": 4,
        "start_time": 100.0,
    }
    monkeypatch.setattr(translator_module.time, "time", lambda: 112.5)

    snapshot = Translator.update_extras_snapshot(
        translator,
        processed_count=3,
        error_count=2,
        input_tokens=7,
        output_tokens=11,
    )

    assert snapshot["processed_line"] == 5
    assert snapshot["error_line"] == 3
    assert snapshot["line"] == 8
    assert snapshot["total_tokens"] == 28
    assert snapshot["total_input_tokens"] == 13
    assert snapshot["total_output_tokens"] == 15
    assert snapshot["time"] == pytest.approx(12.5)


def test_sync_extras_line_stats_uses_items_cache_as_source_of_truth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    processed = Item(src="a")
    processed.set_status(Base.ProjectStatus.PROCESSED)
    failed = Item(src="b")
    failed.set_status(Base.ProjectStatus.ERROR)
    pending = Item(src="c")
    pending.set_status(Base.ProjectStatus.NONE)
    translator.items_cache = [processed, failed, pending]
    translator.extras = {"start_time": 10.0}
    monkeypatch.setattr(translator_module.time, "time", lambda: 16.0)

    Translator.sync_extras_line_stats(translator)

    assert translator.extras["processed_line"] == 1
    assert translator.extras["error_line"] == 1
    assert translator.extras["line"] == 2
    assert translator.extras["total_line"] == 3
    assert translator.extras["time"] == pytest.approx(6.0)


def test_should_emit_export_result_toast_only_for_manual_source() -> None:
    translator = create_translator_stub()

    assert (
        Translator.should_emit_export_result_toast(
            translator,
            Translator.ExportSource.MANUAL,
        )
        is True
    )
    assert (
        Translator.should_emit_export_result_toast(
            translator,
            Translator.ExportSource.AUTO_ON_FINISH,
        )
        is False
    )


def test_resolve_export_items_prefers_runtime_cache() -> None:
    translator = create_translator_stub()
    cached_item = Item(src="live")
    translator.items_cache = [cached_item]
    copied_item = Item(src="copied")
    translator.copy_items = lambda: [copied_item]

    resolved = Translator.resolve_export_items(translator)

    assert resolved == [copied_item]


def test_resolve_export_items_reads_data_manager_when_cache_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.items_cache = None
    loaded_item = Item(src="db")
    fake_dm = SimpleNamespace(
        is_loaded=lambda: True, get_all_items=lambda: [loaded_item]
    )
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    assert Translator.resolve_export_items(translator) == [loaded_item]


def test_resolve_export_items_returns_empty_when_project_not_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.items_cache = None
    fake_dm = SimpleNamespace(is_loaded=lambda: False)
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    assert Translator.resolve_export_items(translator) == []


def test_get_item_count_by_status_and_copy_items() -> None:
    translator = create_translator_stub()
    first = Item(src="a")
    second = Item(src="b")
    second.set_status(Base.ProjectStatus.PROCESSED)
    translator.items_cache = [first, second]

    none_count = Translator.get_item_count_by_status(
        translator, Base.ProjectStatus.NONE
    )
    copied = Translator.copy_items(translator)
    copied[0].set_src("changed")

    assert none_count == 1
    assert translator.items_cache[0].get_src() == "a"


def test_save_translation_state_skips_when_project_not_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.items_cache = None
    fake_dm = SimpleNamespace(
        is_loaded=lambda: False,
        set_translation_extras=MagicMock(),
        set_project_status=MagicMock(),
    )
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translator.save_translation_state(translator)

    fake_dm.set_translation_extras.assert_not_called()
    fake_dm.set_project_status.assert_not_called()


def test_save_translation_state_persists_extras_and_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.items_cache = [Item(src="a")]
    translator.extras = {"line": 1}
    fake_dm = SimpleNamespace(
        is_loaded=lambda: True,
        set_translation_extras=MagicMock(),
        set_project_status=MagicMock(),
    )
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translator.save_translation_state(translator, Base.ProjectStatus.PROCESSING)

    fake_dm.set_translation_extras.assert_called_once_with({"line": 1})
    fake_dm.set_project_status.assert_called_once_with(Base.ProjectStatus.PROCESSING)


def test_initialize_task_limits_covers_default_and_auto_derive() -> None:
    translator = create_translator_stub()
    if hasattr(translator, "model"):
        del translator.model

    assert Translator.initialize_task_limits(translator) == (8, 8, 0)

    translator.model = {"threshold": {"concurrency_limit": 0, "rpm_limit": 120}}
    assert Translator.initialize_task_limits(translator) == (8, 0, 120)

    translator.model = {"threshold": {"concurrency_limit": 5, "rpm_limit": 0}}
    assert Translator.initialize_task_limits(translator) == (5, 5, 0)


def test_get_task_buffer_size_has_lower_and_upper_bounds() -> None:
    translator = create_translator_stub()
    assert Translator.get_task_buffer_size(translator, 1) == 64
    assert Translator.get_task_buffer_size(translator, 5000) == 4096
    assert Translator.get_task_buffer_size(translator, 40) == 160


def test_merge_glossary_returns_none_when_snapshot_missing() -> None:
    translator = create_translator_stub()
    translator.quality_snapshot = None

    assert (
        Translator.merge_glossary(
            translator, [{"src": "A", "dst": "甲", "info": "male"}]
        )
        is None
    )


def test_merge_glossary_filters_invalid_and_supports_runtime_only_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    snapshot = FakeSnapshot()
    translator.quality_snapshot = snapshot
    monkeypatch.setattr(
        translator_module.TextHelper,
        "split_by_punctuation",
        staticmethod(
            lambda text, split_by_space=True: [v.strip() for v in text.split(",")]
        ),
    )

    result = Translator.merge_glossary(
        translator,
        [
            {"src": "Alice, Bob", "dst": "爱丽丝, 鲍勃", "info": "female"},
            {"src": "same", "dst": "same", "info": "male"},
            {"src": "ignored", "dst": "x", "info": "unknown"},
        ],
        persist=False,
    )

    assert result is None
    assert snapshot.merged_entries == [
        {
            "src": "Alice",
            "dst": "爱丽丝",
            "info": "female",
            "case_sensitive": False,
        },
        {
            "src": "Bob",
            "dst": "鲍勃",
            "info": "female",
            "case_sensitive": False,
        },
    ]


def test_merge_glossary_persist_mode_calls_data_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.quality_snapshot = FakeSnapshot()
    fake_dm = SimpleNamespace(
        state_lock=threading.Lock(),
        merge_glossary_incoming=MagicMock(
            return_value=([{"src": "A", "dst": "甲"}], {})
        ),
    )
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    merged = Translator.merge_glossary(
        translator,
        [{"src": "A", "dst": "甲", "info": "male"}],
        persist=True,
    )

    assert merged == [{"src": "A", "dst": "甲"}]
    fake_dm.merge_glossary_incoming.assert_called_once()


def test_apply_batch_update_sync_without_auto_glossary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.config.auto_glossary_enable = False
    update_calls: list[dict[str, Any]] = []
    fake_dm = SimpleNamespace(update_batch=lambda **kwargs: update_calls.append(kwargs))
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translator.apply_batch_update_sync(
        translator,
        finalized_items=[{"id": 1, "dst": "a"}],
        glossaries=[{"src": "A", "dst": "甲"}],
        extras_snapshot={"line": 1},
    )

    kwargs = update_calls[0]
    assert kwargs["items"] == [{"id": 1, "dst": "a"}]
    assert kwargs["rules"] == {}
    assert kwargs["meta"]["project_status"] == Base.ProjectStatus.PROCESSING


def test_apply_batch_update_sync_with_auto_glossary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.config.auto_glossary_enable = True
    translator.merge_glossary = MagicMock(return_value=[{"src": "A", "dst": "甲"}])
    update_calls: list[dict[str, Any]] = []
    fake_dm = SimpleNamespace(update_batch=lambda **kwargs: update_calls.append(kwargs))
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translator.apply_batch_update_sync(
        translator,
        finalized_items=[{"id": 1, "dst": "a"}],
        glossaries=[{"src": "A", "dst": "甲"}],
        extras_snapshot={"line": 1},
    )

    kwargs = update_calls[0]
    assert kwargs["rules"] == {
        DataManager.RuleType.GLOSSARY: [{"src": "A", "dst": "甲"}]
    }
    translator.merge_glossary.assert_called_once_with(
        [{"src": "A", "dst": "甲"}],
        persist=True,
    )


def test_translation_require_stop_sets_engine_status_and_emits_run_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = SimpleNamespace(set_status=MagicMock())
    monkeypatch.setattr(translator_module.Engine, "get", staticmethod(lambda: engine))

    Translator.translation_require_stop(translator, {})

    assert translator.stop_requested is True
    engine.set_status.assert_called_once_with(Base.TaskStatus.STOPPING)
    assert emitted_events(translator) == [
        (
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.RUN},
        )
    ]


def test_translation_export_returns_immediately_when_engine_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = SimpleNamespace(get_status=lambda: Base.TaskStatus.STOPPING)
    monkeypatch.setattr(translator_module.Engine, "get", staticmethod(lambda: engine))
    thread_factory = MagicMock()
    monkeypatch.setattr(translator_module.threading, "Thread", thread_factory)

    Translator.translation_export(
        translator,
        Base.Event.TRANSLATION_EXPORT,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    thread_factory.assert_not_called()


def test_run_translation_export_manual_success_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.resolve_export_items = lambda: [Item(src="a", dst="b")]
    translator.mtool_optimizer_postprocess = MagicMock()
    translator.check_and_wirte_result = MagicMock()
    logger = FakeLogger()
    monkeypatch.setattr(
        translator_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(
        translator_module.Localizer,
        "get",
        staticmethod(
            lambda: SimpleNamespace(
                export_translation_start="start",
                export_translation_success="success",
                export_translation_failed="failed",
            )
        ),
    )

    Translator.run_translation_export(
        translator,
        source=Translator.ExportSource.MANUAL,
        apply_mtool_postprocess=True,
    )

    translator.mtool_optimizer_postprocess.assert_called_once()
    translator.check_and_wirte_result.assert_called_once()
    assert emitted_events(translator)[0] == (
        Base.Event.PROGRESS_TOAST,
        {
            "sub_event": Base.SubEvent.RUN,
            "message": "start",
            "indeterminate": True,
        },
    )
    assert emitted_events(translator)[-1] == (
        Base.Event.TOAST,
        {
            "type": Base.ToastType.SUCCESS,
            "message": "success",
        },
    )


def test_run_translation_export_emits_error_toast_when_write_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.resolve_export_items = lambda: [Item(src="a", dst="b")]
    translator.mtool_optimizer_postprocess = MagicMock()
    translator.check_and_wirte_result = MagicMock(side_effect=RuntimeError("boom"))
    logger = FakeLogger()
    monkeypatch.setattr(
        translator_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(
        translator_module.Localizer,
        "get",
        staticmethod(
            lambda: SimpleNamespace(
                export_translation_start="start",
                export_translation_success="success",
                export_translation_failed="failed",
            )
        ),
    )

    Translator.run_translation_export(
        translator,
        source=Translator.ExportSource.MANUAL,
        apply_mtool_postprocess=True,
    )

    assert has_emitted(
        translator,
        Base.Event.TOAST,
        {
            "type": Base.ToastType.ERROR,
            "message": "failed",
        },
    )


def test_project_check_run_ignores_non_request_sub_event() -> None:
    translator = create_translator_stub()

    Translator.project_check_run(
        translator,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert emitted_events(translator) == []


def test_project_check_run_emits_done_with_loaded_project(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    dm = create_data_manager(loaded=True)
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.project_check_run(
        translator,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted_events(translator) == [
        (
            Base.Event.PROJECT_CHECK,
            {
                "sub_event": Base.SubEvent.DONE,
                "status": Base.ProjectStatus.PROCESSING,
                "extras": {"line": 9, "time": 3},
                "analysis_extras": {"line": 5, "time": 2},
                "analysis_candidate_count": 1,
            },
        )
    ]


def test_project_check_run_emits_none_payload_when_project_unloaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    dm = create_data_manager(loaded=False)
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.project_check_run(
        translator,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted_events(translator) == [
        (
            Base.Event.PROJECT_CHECK,
            {
                "sub_event": Base.SubEvent.DONE,
                "status": Base.ProjectStatus.NONE,
                "extras": {},
                "analysis_extras": {},
                "analysis_candidate_count": 0,
            },
        )
    ]


def test_translation_run_event_ignores_non_request_sub_event() -> None:
    translator = create_translator_stub()
    translator.translation_run = MagicMock()

    Translator.translation_run_event(
        translator,
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )

    translator.translation_run.assert_not_called()


def test_translation_stop_event_ignores_non_request_sub_event() -> None:
    translator = create_translator_stub()
    translator.translation_require_stop = MagicMock()

    Translator.translation_stop_event(
        translator,
        Base.Event.TRANSLATION_REQUEST_STOP,
        {"sub_event": Base.SubEvent.ERROR},
    )

    translator.translation_require_stop.assert_not_called()


def test_translation_run_emits_busy_toast_and_error_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine(Base.TaskStatus.TRANSLATING)
    monkeypatch.setattr(translator_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        translator_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(task_running="task running")),
    )

    Translator.translation_run(
        translator,
        {"sub_event": Base.SubEvent.REQUEST, "mode": Base.TranslationMode.NEW},
    )

    assert emitted_events(translator) == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "task running",
            },
        ),
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": "task running",
            },
        ),
    ]


def test_translation_run_emits_error_when_thread_start_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    logger = FakeLogManager()
    dm = create_data_manager(loaded=True)
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)

    class StartFailThread:
        def __init__(self, target: Any, args: tuple[Any, ...]) -> None:
            self.target = target
            self.args = args

        def start(self) -> None:
            raise RuntimeError("thread failed")

    monkeypatch.setattr(translator_module.threading, "Thread", StartFailThread)

    Translator.translation_run(
        translator,
        {"sub_event": Base.SubEvent.REQUEST, "mode": Base.TranslationMode.NEW},
    )

    assert engine.status == Base.TaskStatus.IDLE
    assert has_emitted(
        translator,
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.ERROR,
            "message": "task_failed",
        },
    )
    assert logger.error_messages == ["task_failed"]


def test_translation_reset_returns_when_project_not_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=False)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted_events(translator) == []


def test_translation_reset_ignores_non_request_sub_event() -> None:
    translator = create_translator_stub()

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert emitted_events(translator) == []


def test_translation_reset_emits_warning_when_engine_busy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine(Base.TaskStatus.TRANSLATING)
    dm = create_data_manager(loaded=True)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert has_emitted(
        translator,
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.ERROR},
    )


def test_translation_reset_all_runs_reset_task_and_emits_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    items = [Item(src="a")]
    dm = create_data_manager(loaded=True, items=items)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    dm.get_items_for_translation.assert_called_once_with(
        translator.config,
        Base.TranslationMode.RESET,
    )
    dm.replace_all_items.assert_called_once_with(items)
    dm.set_project_status.assert_called_once_with(Base.ProjectStatus.NONE)
    dm.run_project_prefilter.assert_called_once_with(
        translator.config,
        reason="translation_reset",
    )
    assert has_emitted(
        translator,
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.DONE},
    )


def test_translation_reset_failed_updates_extras_when_returned(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    dm.reset_failed_items_sync = MagicMock(return_value={"line": 22})
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert translator.extras == {"line": 22}


def test_translation_reset_failed_keeps_extras_when_reset_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.extras = {"line": 1}
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    dm.reset_failed_items_sync = MagicMock(return_value=None)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert translator.extras == {"line": 1}


def test_translation_reset_emits_error_when_task_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    dm.reset_failed_items_sync = MagicMock(side_effect=RuntimeError("boom"))
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert has_emitted(
        translator,
        Base.Event.TOAST,
        {
            "type": Base.ToastType.ERROR,
            "message": "task_failed",
        },
    )
    assert has_emitted(
        translator,
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.ERROR},
    )


def test_run_translation_export_finishes_progress_when_no_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    translator.resolve_export_items = lambda: []
    translator.check_and_wirte_result = MagicMock()

    Translator.run_translation_export(
        translator,
        source=Translator.ExportSource.MANUAL,
    )

    translator.check_and_wirte_result.assert_not_called()
    assert emitted_events(translator)[-1] == (
        Base.Event.PROGRESS_TOAST,
        {"sub_event": Base.SubEvent.DONE},
    )


def test_run_translation_export_auto_source_error_has_no_result_toast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    translator.resolve_export_items = lambda: [Item(src="a", dst="b")]
    translator.mtool_optimizer_postprocess = MagicMock()
    translator.check_and_wirte_result = MagicMock(side_effect=RuntimeError("boom"))

    Translator.run_translation_export(
        translator,
        source=Translator.ExportSource.AUTO_ON_FINISH,
        apply_mtool_postprocess=False,
    )

    translator.mtool_optimizer_postprocess.assert_not_called()
    assert not has_emitted(translator, Base.Event.TOAST)


def test_run_translation_export_auto_source_success_skips_result_toast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    translator.resolve_export_items = lambda: [Item(src="a", dst="b")]
    translator.mtool_optimizer_postprocess = MagicMock()
    translator.check_and_wirte_result = MagicMock()

    Translator.run_translation_export(
        translator,
        source=Translator.ExportSource.AUTO_ON_FINISH,
        apply_mtool_postprocess=True,
    )

    translator.mtool_optimizer_postprocess.assert_called_once()
    assert not has_emitted(translator, Base.Event.TOAST)


def test_translation_export_spawns_thread_when_not_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.run_translation_export = MagicMock()
    engine = create_engine()
    dm = create_data_manager(loaded=True)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module.threading, "Thread", InlineThread)

    Translator.translation_export(
        translator,
        Base.Event.TRANSLATION_EXPORT,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    translator.run_translation_export.assert_called_once_with(
        source=Translator.ExportSource.MANUAL
    )


def test_start_handles_project_not_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=False)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    translator.mtool_optimizer_postprocess = MagicMock()
    translator.run_translation_export = MagicMock()
    monkeypatch.setattr(
        translator_module.QualityRuleSnapshot, "capture", staticmethod(lambda: object())
    )

    Translator.start(translator, {})

    assert has_emitted(
        translator,
        Base.Event.TOAST,
        {
            "type": Base.ToastType.WARNING,
            "message": "project_not_loaded",
        },
    )


def test_start_handles_no_active_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    config = Config()
    config.get_active_model = lambda: None  # type: ignore[method-assign]
    engine = create_engine()
    dm = create_data_manager(loaded=True, items=[Item(src="a")])
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(
        translator_module.QualityRuleSnapshot, "capture", staticmethod(lambda: object())
    )

    Translator.start(
        translator,
        {"config": config, "mode": Base.TranslationMode.NEW},
    )

    assert has_emitted(
        translator,
        Base.Event.TOAST,
        {
            "type": Base.ToastType.WARNING,
            "message": "no_active_model",
        },
    )


def test_start_emits_warning_when_items_are_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    config = Config()
    config.get_active_model = lambda: {  # type: ignore[method-assign]
        "api_format": Base.APIFormat.OPENAI,
        "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
    }
    dm = create_data_manager(loaded=True, items=[])
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(
        translator_module.QualityRuleSnapshot, "capture", staticmethod(lambda: object())
    )

    Translator.start(
        translator,
        {"config": config, "mode": Base.TranslationMode.NEW},
    )

    assert has_emitted(
        translator,
        Base.Event.TOAST,
        {
            "type": Base.ToastType.WARNING,
            "message": "no_items",
        },
    )


def test_start_success_flow_triggers_auto_export(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    item = Item(src="line")
    dm = create_data_manager(loaded=True, items=[item])
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module, "ProgressBar", FakeProgressBar)
    monkeypatch.setattr(translator_module, "TaskLimiter", FakeTaskLimiter)
    monkeypatch.setattr(translator_module, "PromptBuilder", FakePromptBuilder)
    monkeypatch.setattr(
        translator_module.QualityRuleSnapshot, "capture", staticmethod(lambda: object())
    )
    config = Config()
    config.get_active_model = lambda: {
        "api_format": Base.APIFormat.OPENAI,
        "name": "model",
        "api_url": "url",
        "model_id": "id",
        "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
    }  # type: ignore[method-assign]

    def fake_pipeline(**kwargs: Any) -> None:
        del kwargs
        item.set_status(Base.ProjectStatus.PROCESSED)

    translator.start_translation_pipeline = fake_pipeline
    translator.run_translation_export = MagicMock()

    Translator.start(
        translator,
        {"config": config, "mode": Base.TranslationMode.NEW},
    )

    translator.run_translation_export.assert_called_once_with(
        source=Translator.ExportSource.AUTO_ON_FINISH,
        apply_mtool_postprocess=False,
    )
    assert any(
        event == Base.Event.TRANSLATION_TASK
        and payload.get("final_status") == "SUCCESS"
        for event, payload in emitted_events(translator)
    )


@pytest.mark.parametrize(
    ("engine_status", "expected_final_status"),
    [
        (Base.TaskStatus.STOPPING, "STOPPED"),
        (Base.TaskStatus.IDLE, "FAILED"),
    ],
)
def test_start_continue_mode_handles_stop_and_failed_states(
    monkeypatch: pytest.MonkeyPatch,
    engine_status: Base.TaskStatus,
    expected_final_status: str,
) -> None:
    translator = create_translator_stub()
    item = Item(src="line")
    dm = create_data_manager(loaded=True, items=[item])
    dm.get_translation_extras = MagicMock(return_value={"time": 8})
    engine = create_engine(engine_status)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translator_module, "ProgressBar", FakeProgressBar)
    monkeypatch.setattr(translator_module, "TaskLimiter", FakeTaskLimiter)
    monkeypatch.setattr(translator_module, "PromptBuilder", FakePromptBuilder)
    monkeypatch.setattr(
        translator_module.QualityRuleSnapshot, "capture", staticmethod(lambda: object())
    )
    config = Config()
    config.get_active_model = lambda: {
        "api_format": Base.APIFormat.SAKURALLM,
        "name": "model",
        "api_url": "url",
        "model_id": "id",
        "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
    }  # type: ignore[method-assign]
    translator.start_translation_pipeline = lambda **kwargs: None
    translator.run_translation_export = MagicMock()

    Translator.start(
        translator,
        {"config": config, "mode": Base.TranslationMode.CONTINUE},
    )

    assert any(
        event == Base.Event.TRANSLATION_TASK
        and payload.get("final_status") == expected_final_status
        for event, payload in emitted_events(translator)
    )


def test_start_emits_error_toast_when_exception_occurs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    config = Config()
    config.get_active_model = lambda: {
        "threshold": {"concurrency_limit": 1, "rpm_limit": 0}
    }  # type: ignore[method-assign]
    dm = create_data_manager(loaded=True, items=[Item(src="line")])
    dm.open_db = MagicMock(side_effect=RuntimeError("open failed"))
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)

    Translator.start(translator, {"config": config})

    assert has_emitted(
        translator,
        Base.Event.TOAST,
        {
            "type": Base.ToastType.ERROR,
            "message": "task_failed",
        },
    )


def test_get_item_count_copy_and_close_db_helpers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    dm = create_data_manager(loaded=True)
    monkeypatch.setattr(translator_module.DataManager, "get", staticmethod(lambda: dm))

    assert Translator.get_item_count_by_status(translator, Base.ProjectStatus.NONE) == 0
    assert Translator.copy_items(translator) == []

    Translator.close_db_connection(translator)
    dm.close_db.assert_called_once()


def test_sync_extras_line_stats_returns_when_items_cache_is_none() -> None:
    translator = create_translator_stub()
    translator.items_cache = None
    translator.extras = {"start_time": 10.0}

    Translator.sync_extras_line_stats(translator)

    assert translator.extras == {"start_time": 10.0}


def test_sync_extras_line_stats_ignores_untracked_item_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    item = Item(src="x")
    item.set_status(Base.ProjectStatus.EXCLUDED)
    translator.items_cache = [item]
    translator.extras = {"start_time": 0.0}
    monkeypatch.setattr(translator_module.time, "time", lambda: 1.0)

    Translator.sync_extras_line_stats(translator)

    assert translator.extras["processed_line"] == 0
    assert translator.extras["error_line"] == 0
    assert translator.extras["total_line"] == 0


def test_merge_glossary_covers_mismatch_and_empty_parts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    snapshot = FakeSnapshot()
    translator.quality_snapshot = snapshot

    def fake_split(text: str, split_by_space: bool = True) -> list[str]:
        del split_by_space
        if text == "mismatch_src":
            return ["A", "B"]
        if text == "mismatch_dst":
            return ["甲"]
        if text == "empty_src":
            return [""]
        if text == "empty_dst":
            return [""]
        return [text]

    monkeypatch.setattr(
        translator_module.TextHelper,
        "split_by_punctuation",
        staticmethod(fake_split),
    )

    Translator.merge_glossary(
        translator,
        [
            {"src": "mismatch_src", "dst": "mismatch_dst", "info": "female"},
            {"src": "empty_src", "dst": "empty_dst", "info": "male"},
        ],
        persist=False,
    )

    assert snapshot.merged_entries[0]["src"] == "mismatch_src"
    assert snapshot.merged_entries[0]["dst"] == "mismatch_dst"


def test_save_translation_state_without_extras_still_sets_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.items_cache = [Item(src="a")]
    translator.extras = {}
    dm = create_data_manager(loaded=True)
    monkeypatch.setattr(translator_module.DataManager, "get", staticmethod(lambda: dm))

    Translator.save_translation_state(translator, Base.ProjectStatus.PROCESSED)

    dm.set_translation_extras.assert_not_called()
    dm.set_project_status.assert_called_once_with(Base.ProjectStatus.PROCESSED)


def test_initialize_task_limits_defaults_when_rpm_and_concurrency_are_zero() -> None:
    translator = create_translator_stub()
    translator.model = {"threshold": {"concurrency_limit": 0, "rpm_limit": 0}}

    assert Translator.initialize_task_limits(translator) == (8, 8, 0)


def test_start_translation_pipeline_builds_pipeline_and_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    called: dict[str, Any] = {}

    class FakePipeline:
        def __init__(self, **kwargs: Any) -> None:
            called.update(kwargs)

        def run(self) -> None:
            called["ran"] = True

    monkeypatch.setattr(translator_module, "TranslatorTaskPipeline", FakePipeline)

    Translator.start_translation_pipeline(
        translator,
        progress=FakeProgressBar(),
        pid=3,
        task_limiter=FakeTaskLimiter(rps=1, rpm=0, max_concurrency=1),
        max_workers=2,
    )

    assert called["translator"] is translator
    assert called["max_workers"] == 2
    assert called["ran"] is True


def test_mtool_optimizer_postprocess_groups_kvjson_and_expands_lines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.config.mtool_optimizer_enable = True
    logger = FakeLogManager()
    monkeypatch.setattr(translator_module, "ProgressBar", FakeProgressBar)
    monkeypatch.setattr(
        translator_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(
        translator_module.Localizer, "get", staticmethod(build_localizer)
    )

    item = Item(src="a\nb", dst="甲\n乙")
    item.set_file_type(Item.FileType.KVJSON)
    item.set_file_path("scene.json")
    plain_item = Item(src="single", dst="单行")
    plain_item.set_file_type(Item.FileType.KVJSON)
    plain_item.set_file_path("scene.json")
    ignored_item = Item(src="ignored", dst="ignored")
    ignored_item.set_file_type(Item.FileType.TXT)
    ignored_item.set_file_path("note.txt")
    items = [item, plain_item, ignored_item]

    Translator.mtool_optimizer_postprocess(translator, items)

    assert len(items) == 5
    assert any(value.get_src() == "a" for value in items[3:])
    assert any(value.get_src() == "b" for value in items[3:])
    assert logger.info_messages[-1] == "mtool_done"


def test_check_and_wirte_result_emits_glossary_event_and_opens_output_folder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.config.auto_glossary_enable = True
    translator.persist_quality_rules = True
    translator.config.output_folder_open_on_finish = True
    logger = FakeLogManager()
    open_mock = MagicMock()
    monkeypatch.setattr(translator_module, "FileManager", FakeFileManager)
    monkeypatch.setattr(
        translator_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(
        translator_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(translator_module.webbrowser, "open", open_mock)

    Translator.check_and_wirte_result(translator, [Item(src="a", dst="b")])

    assert has_emitted(
        translator,
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": [DataManager.RuleType.GLOSSARY.value]},
    )
    open_mock.assert_called_once()


def test_check_and_wirte_result_skips_glossary_event_and_open_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.config.auto_glossary_enable = False
    translator.persist_quality_rules = True
    translator.config.output_folder_open_on_finish = False
    logger = FakeLogManager()
    open_mock = MagicMock()
    monkeypatch.setattr(translator_module, "FileManager", FakeFileManager)
    monkeypatch.setattr(
        translator_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(
        translator_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(translator_module.webbrowser, "open", open_mock)

    Translator.check_and_wirte_result(translator, [Item(src="a", dst="b")])

    assert emitted_events(translator) == []
    open_mock.assert_not_called()
