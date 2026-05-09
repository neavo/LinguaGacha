from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
import module.Engine.Translation.Translation as translation_module
from module.Engine.Translation.Translation import Translation


class EventRecorder:
    def __init__(self) -> None:
        self.events: list[tuple[Base.Event, dict[str, Any]]] = []

    def emit(self, event: Base.Event, payload: dict[str, Any]) -> bool:
        self.events.append((event, payload))
        return True


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


def create_translation_stub() -> Translation:
    translation = Translation()
    recorder = EventRecorder()
    translation.extras = {}
    translation.items_cache = None
    translation.task_limiter = None
    translation.stop_requested = False
    translation.quality_snapshot = None
    translation.config = Config(
        mtool_optimizer_enable=False,
        output_folder_open_on_finish=False,
    )
    setattr(translation, "emit", recorder.emit)
    setattr(translation, "emitted_events", recorder.events)
    return translation


def emitted_events(translation: Translation) -> list[tuple[Base.Event, dict[str, Any]]]:
    return list(getattr(translation, "emitted_events", []))


def has_emitted(
    translation: Translation,
    event: Base.Event,
    payload: dict[str, Any] | None = None,
) -> bool:
    if payload is None:
        return any(
            emitted_event == event for emitted_event, _ in emitted_events(translation)
        )
    return any(
        emitted_event == event and emitted_payload == payload
        for emitted_event, emitted_payload in emitted_events(translation)
    )


class FakeLogManager:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.error_messages: list[str] = []
        self.progress_sessions: list["FakeProgressSession"] = []

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

    def progress(self, *, transient: bool) -> "FakeProgressSession":
        session = FakeProgressSession(transient=transient)
        self.progress_sessions.append(session)
        return session


class InlineThread:
    def __init__(self, target: Any, args: tuple[Any, ...] = (), **kwargs: Any) -> None:
        del kwargs
        self.target = target
        self.args = args

    def start(self) -> None:
        self.target(*self.args)


class FakeProgressSession:
    def __init__(self, *, transient: bool = False) -> None:
        self.transient = transient
        self.last_new: dict[str, int] = {}
        self.updates: list[tuple[int, dict[str, int]]] = []

    def __enter__(self) -> "FakeProgressSession":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        del exc_type, exc, tb
        return False

    def new_task(self, total: int = 0, completed: int = 0) -> int:
        self.last_new = {"total": total, "completed": completed}
        return 1

    def update_task(self, pid: int, **kwargs: int) -> None:
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


def build_localizer() -> Any:
    return SimpleNamespace(
        task_running="task_running",
        task_failed="task_failed",
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
        translation_mtool_optimizer_post_log="mtool_done",
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
        get_translation_extras=MagicMock(return_value={"line": 9, "time": 3}),
        get_analysis_extras=MagicMock(return_value={"line": 5, "time": 2}),
        get_analysis_progress_snapshot=MagicMock(return_value={"line": 5, "time": 2}),
        get_analysis_candidate_count=MagicMock(return_value=1),
        get_items_for_translation=MagicMock(return_value=item_list),
        replace_all_items=MagicMock(),
        set_translation_extras=MagicMock(),
        run_project_prefilter=MagicMock(),
        get_all_items=MagicMock(return_value=item_list),
        state_lock=threading.Lock(),
        update_batch=MagicMock(),
        apply_translation_batch_update=MagicMock(),
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
    monkeypatch.setattr(translation_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(translation_module.DataManager, "get", staticmethod(lambda: dm))
    monkeypatch.setattr(
        translation_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(
        translation_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(translation_module.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(translation_module.time, "time", lambda: 100.0)
    monkeypatch.setattr(
        translation_module.TaskRunnerLifecycle,
        "reset_request_runtime",
        staticmethod(lambda reset_text_processor: None),
    )


def test_get_concurrency_helpers_return_zero_without_limiter() -> None:
    translation = create_translation_stub()
    assert Translation.get_concurrency_in_use(translation) == 0
    assert Translation.get_concurrency_limit(translation) == 0


def test_get_concurrency_helpers_delegate_to_limiter() -> None:
    translation = create_translation_stub()
    translation.task_limiter = SimpleNamespace(
        get_concurrency_in_use=lambda: 3,
        get_concurrency_limit=lambda: 9,
    )

    assert Translation.get_concurrency_in_use(translation) == 3
    assert Translation.get_concurrency_limit(translation) == 9


def test_get_item_count_by_status_and_copy_items() -> None:
    translation = create_translation_stub()
    first = Item(src="a")
    second = Item(src="b")
    second.set_status(Base.ItemStatus.PROCESSED)
    translation.items_cache = [first, second]

    none_count = Translation.get_item_count_by_status(translation, Base.ItemStatus.NONE)
    copied = Translation.copy_items(translation)
    copied[0].set_src("changed")

    assert none_count == 1
    assert translation.items_cache[0].get_src() == "a"


def test_save_translation_state_skips_when_project_not_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    translation.items_cache = None
    fake_dm = SimpleNamespace(
        is_loaded=lambda: False,
        set_translation_extras=MagicMock(),
    )
    monkeypatch.setattr(
        translation_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translation.save_translation_state(translation)

    fake_dm.set_translation_extras.assert_not_called()


def test_save_translation_state_persists_extras(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    translation.items_cache = [Item(src="a")]
    translation.extras = {"line": 1}
    fake_dm = SimpleNamespace(
        is_loaded=lambda: True,
        set_translation_extras=MagicMock(),
    )
    monkeypatch.setattr(
        translation_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translation.save_translation_state(translation)

    fake_dm.set_translation_extras.assert_called_once_with({"line": 1})


def test_get_task_buffer_size_has_lower_and_upper_bounds() -> None:
    translation = create_translation_stub()
    assert Translation.get_task_buffer_size(translation, 1) == 64
    assert Translation.get_task_buffer_size(translation, 5000) == 4096
    assert Translation.get_task_buffer_size(translation, 40) == 160


def test_translation_require_stop_sets_engine_status_and_emits_run_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    engine = SimpleNamespace(set_status=MagicMock())
    monkeypatch.setattr(translation_module.Engine, "get", staticmethod(lambda: engine))

    Translation.translation_require_stop(translation, {})

    assert translation.stop_requested is True
    engine.set_status.assert_called_once_with(Base.TaskStatus.STOPPING)
    assert emitted_events(translation) == [
        (
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.RUN},
        )
    ]


def test_project_check_run_ignores_non_request_sub_event() -> None:
    translation = create_translation_stub()

    Translation.project_check_run(
        translation,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert emitted_events(translation) == []


def test_project_check_run_emits_done_with_loaded_project(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    dm = create_data_manager(loaded=True)
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translation_module.threading, "Thread", InlineThread)

    Translation.project_check_run(
        translation,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted_events(translation) == [
        (
            Base.Event.PROJECT_CHECK,
            {
                "sub_event": Base.SubEvent.DONE,
                "extras": {"line": 9, "time": 3},
                "analysis_extras": {"line": 5, "time": 2},
                "analysis_candidate_count": 1,
            },
        )
    ]
    dm.get_analysis_progress_snapshot.assert_not_called()
    dm.get_analysis_extras.assert_called_once()


def test_project_check_run_emits_none_payload_when_project_unloaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    dm = create_data_manager(loaded=False)
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translation_module.threading, "Thread", InlineThread)

    Translation.project_check_run(
        translation,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted_events(translation) == [
        (
            Base.Event.PROJECT_CHECK,
            {
                "sub_event": Base.SubEvent.DONE,
                "extras": {},
                "analysis_extras": {},
                "analysis_candidate_count": 0,
            },
        )
    ]


def test_translation_run_event_ignores_non_request_sub_event() -> None:
    translation = create_translation_stub()
    translation.translation_run = MagicMock()

    Translation.translation_run_event(
        translation,
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )

    translation.translation_run.assert_not_called()


def test_translation_stop_event_ignores_non_request_sub_event() -> None:
    translation = create_translation_stub()
    translation.translation_require_stop = MagicMock()

    Translation.translation_stop_event(
        translation,
        Base.Event.TRANSLATION_REQUEST_STOP,
        {"sub_event": Base.SubEvent.ERROR},
    )

    translation.translation_require_stop.assert_not_called()


def test_translation_run_emits_busy_error_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    engine = create_engine(Base.TaskStatus.TRANSLATING)
    monkeypatch.setattr(translation_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        translation_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(task_running="task running")),
    )

    Translation.translation_run(
        translation,
        {"sub_event": Base.SubEvent.REQUEST, "mode": Base.TranslationMode.NEW},
    )

    assert emitted_events(translation) == [
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
    translation = create_translation_stub()
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

    monkeypatch.setattr(translation_module.threading, "Thread", StartFailThread)

    Translation.translation_run(
        translation,
        {"sub_event": Base.SubEvent.REQUEST, "mode": Base.TranslationMode.NEW},
    )

    assert engine.status == Base.TaskStatus.IDLE
    assert has_emitted(
        translation,
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.ERROR,
            "message": "task_failed",
        },
    )
    assert logger.error_messages == ["task_failed"]


def test_start_handles_project_not_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    engine = create_engine()
    dm = create_data_manager(loaded=False)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    translation.mtool_optimizer_postprocess = MagicMock()
    monkeypatch.setattr(
        translation_module.QualityRuleSnapshot,
        "capture",
        staticmethod(lambda: object()),
    )

    Translation.start(translation, {})

    assert has_emitted(
        translation,
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.ERROR,
            "message": "project_not_loaded",
        },
    )


def test_start_handles_no_active_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    config = Config(mtool_optimizer_enable=False)
    setattr(config, "get_active_model", lambda: None)
    engine = create_engine()
    dm = create_data_manager(loaded=True, items=[Item(src="a")])
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(
        translation_module.QualityRuleSnapshot,
        "capture",
        staticmethod(lambda: object()),
    )

    Translation.start(
        translation,
        {"config": config, "mode": Base.TranslationMode.NEW},
    )

    assert has_emitted(
        translation,
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.ERROR,
            "message": "no_active_model",
        },
    )


def test_start_emits_error_when_items_are_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    setattr(translation, "finalize_translation_run", MagicMock())
    setattr(translation, "cleanup_translation_run", MagicMock())
    config = Config(mtool_optimizer_enable=False)
    setattr(
        config,
        "get_active_model",
        lambda: {
            "api_format": Base.APIFormat.OPENAI,
            "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
        },
    )
    dm = create_data_manager(loaded=True, items=[])
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(
        translation_module.QualityRuleSnapshot,
        "capture",
        staticmethod(lambda: object()),
    )

    Translation.start(
        translation,
        {"config": config, "mode": Base.TranslationMode.NEW},
    )

    assert has_emitted(
        translation,
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.ERROR,
            "message": "no_items",
        },
    )
    assert not any(
        event == Base.Event.TRANSLATION_TASK
        and payload.get("sub_event") == Base.SubEvent.DONE
        for event, payload in emitted_events(translation)
    )
    translation.finalize_translation_run.assert_not_called()
    translation.cleanup_translation_run.assert_called_once_with()


def test_start_success_flow_saves_project_fact_without_writing_translation_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    item = Item(src="line")
    dm = create_data_manager(loaded=True, items=[item])
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translation_module, "TaskLimiter", FakeTaskLimiter)
    monkeypatch.setattr(translation_module, "PromptBuilder", FakePromptBuilder)
    monkeypatch.setattr(
        translation_module.QualityRuleSnapshot,
        "capture",
        staticmethod(lambda: object()),
    )
    config = Config(mtool_optimizer_enable=False)
    setattr(
        config,
        "get_active_model",
        lambda: {
            "api_format": Base.APIFormat.OPENAI,
            "name": "model",
            "api_url": "url",
            "model_id": "id",
            "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
        },
    )

    def fake_pipeline(**kwargs: Any) -> None:
        del kwargs
        item.set_status(Base.ItemStatus.PROCESSED)

    translation.start_translation_pipeline = fake_pipeline

    Translation.start(
        translation,
        {"config": config, "mode": Base.TranslationMode.NEW},
    )

    assert any(
        event == Base.Event.TRANSLATION_TASK
        and payload.get("final_status") == "SUCCESS"
        for event, payload in emitted_events(translation)
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
    translation = create_translation_stub()
    item = Item(src="line")
    dm = create_data_manager(loaded=True, items=[item])
    dm.get_translation_extras = MagicMock(return_value={"time": 8})
    engine = create_engine(engine_status)
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)
    monkeypatch.setattr(translation_module, "TaskLimiter", FakeTaskLimiter)
    monkeypatch.setattr(translation_module, "PromptBuilder", FakePromptBuilder)
    monkeypatch.setattr(
        translation_module.QualityRuleSnapshot,
        "capture",
        staticmethod(lambda: object()),
    )
    config = Config(mtool_optimizer_enable=False)
    setattr(
        config,
        "get_active_model",
        lambda: {
            "api_format": Base.APIFormat.SAKURALLM,
            "name": "model",
            "api_url": "url",
            "model_id": "id",
            "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
        },
    )
    translation.start_translation_pipeline = lambda **kwargs: None

    Translation.start(
        translation,
        {"config": config, "mode": Base.TranslationMode.CONTINUE},
    )

    assert any(
        event == Base.Event.TRANSLATION_TASK
        and payload.get("final_status") == expected_final_status
        for event, payload in emitted_events(translation)
    )


def test_start_emits_failed_terminal_event_when_exception_occurs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    config = Config()
    setattr(
        config,
        "get_active_model",
        lambda: {
            "threshold": {"concurrency_limit": 1, "rpm_limit": 0},
        },
    )
    dm = create_data_manager(loaded=True, items=[Item(src="line")])
    dm.open_db = MagicMock(side_effect=RuntimeError("open failed"))
    engine = create_engine()
    logger = FakeLogManager()
    setup_common_patches(monkeypatch, engine=engine, dm=dm, logger=logger)

    Translation.start(translation, {"config": config})

    assert has_emitted(
        translation,
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "final_status": "FAILED",
            "message": "task_failed",
        },
    )


def test_get_item_count_copy_and_close_db_helpers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    dm = create_data_manager(loaded=True)
    monkeypatch.setattr(translation_module.DataManager, "get", staticmethod(lambda: dm))

    assert Translation.get_item_count_by_status(translation, Base.ItemStatus.NONE) == 0
    assert Translation.copy_items(translation) == []

    Translation.close_db_connection(translation)
    dm.close_db.assert_called_once()


def test_save_translation_state_without_extras_skips_meta_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    translation.items_cache = [Item(src="a")]
    translation.extras = {}
    dm = create_data_manager(loaded=True)
    monkeypatch.setattr(translation_module.DataManager, "get", staticmethod(lambda: dm))

    Translation.save_translation_state(translation)

    dm.set_translation_extras.assert_not_called()


def test_start_translation_pipeline_builds_pipeline_and_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    called: dict[str, Any] = {}

    class FakeHooks:
        def __init__(self, **kwargs: Any) -> None:
            called.update(kwargs)

        def build_pipeline_sizes(self) -> tuple[int, int, int]:
            return 4, 8, 4

    class FakePipeline:
        def __init__(self, **kwargs: Any) -> None:
            called.update(kwargs)

        def run(self) -> None:
            called["ran"] = True

    monkeypatch.setattr(translation_module, "TranslationTaskHooks", FakeHooks)
    monkeypatch.setattr(translation_module, "TaskPipeline", FakePipeline)

    Translation.start_translation_pipeline(
        translation,
        task_limiter=FakeTaskLimiter(rps=1, rpm=0, max_concurrency=1),
        max_workers=2,
    )

    assert called["translation"] is translation
    assert called["max_workers"] == 2
    assert isinstance(called["hooks"], FakeHooks)
    assert called["ran"] is True


def test_mtool_optimizer_postprocess_groups_kvjson_and_expands_lines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    translation.config.mtool_optimizer_enable = True
    logger = FakeLogManager()
    monkeypatch.setattr(
        translation_module.LogManager, "get", staticmethod(lambda: logger)
    )
    monkeypatch.setattr(
        translation_module.Localizer, "get", staticmethod(build_localizer)
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

    Translation.mtool_optimizer_postprocess(translation, items)

    assert len(items) == 5
    assert any(value.get_src() == "a" for value in items[3:])
    assert any(value.get_src() == "b" for value in items[3:])
    assert logger.info_messages[-1] == "mtool_done"
