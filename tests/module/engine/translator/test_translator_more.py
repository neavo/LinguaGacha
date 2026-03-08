from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any
from typing import cast
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
import module.Engine.Translator.Translator as translator_module
from module.Engine.Translator.Translator import Translator


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


def create_translator_stub() -> Any:
    translator = cast(Any, Translator.__new__(Translator))
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
    translator.emit = MagicMock()
    return translator


def create_data_manager(*, loaded: bool, items: list[Item] | None = None) -> Any:
    item_list = items or []
    dm = SimpleNamespace(
        is_loaded=lambda: loaded,
        open_db=MagicMock(),
        close_db=MagicMock(),
        get_project_status=MagicMock(return_value=Base.ProjectStatus.PROCESSING),
        get_translation_extras=MagicMock(return_value={"line": 9, "time": 3}),
        get_analysis_extras=MagicMock(return_value={"line": 5, "time": 2}),
        get_analysis_state=MagicMock(
            return_value={"story.txt": Base.ProjectStatus.PROCESSED}
        ),
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


def test_init_loads_config_and_subscribes_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[Base.Event, Any]] = []
    monkeypatch.setattr(translator_module.Config, "load", lambda self: Config())

    def fake_subscribe(self: Translator, event: Base.Event, handler: Any) -> None:
        del self
        calls.append((event, handler))

    monkeypatch.setattr(Translator, "subscribe", fake_subscribe, raising=False)

    translator = Translator()

    assert translator.persist_quality_rules is True
    assert len(calls) == 6
    assert calls[0][0] == Base.Event.PROJECT_CHECK
    assert calls[-1][0] == Base.Event.TRANSLATION_RESET_FAILED


def test_project_check_run_ignores_non_request_sub_event() -> None:
    translator = create_translator_stub()

    Translator.project_check_run(
        translator,
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.DONE},
    )

    translator.emit.assert_not_called()


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

    translator.emit.assert_called_once_with(
        Base.Event.PROJECT_CHECK,
        {
            "sub_event": Base.SubEvent.DONE,
            "status": Base.ProjectStatus.PROCESSING,
            "extras": {"line": 9, "time": 3},
            "analysis_extras": {"line": 5, "time": 2},
            "analysis_state": {"story.txt": Base.ProjectStatus.PROCESSED.value},
        },
    )


def test_project_check_run_emits_done_with_none_when_project_unloaded(
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

    payload = translator.emit.call_args.args[1]
    assert payload["status"] == Base.ProjectStatus.NONE
    assert payload["extras"] == {}


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
    assert any(
        call.args
        == (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": "task_failed",
            },
        )
        for call in translator.emit.call_args_list
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

    translator.emit.assert_not_called()


def test_translation_reset_ignores_non_request_sub_event() -> None:
    translator = create_translator_stub()

    Translator.translation_reset(
        translator,
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.DONE},
    )

    translator.emit.assert_not_called()


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

    assert any(
        call.args
        == (
            Base.Event.TRANSLATION_RESET_FAILED,
            {"sub_event": Base.SubEvent.ERROR},
        )
        for call in translator.emit.call_args_list
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
    assert any(
        call.args
        == (
            Base.Event.TRANSLATION_RESET_ALL,
            {"sub_event": Base.SubEvent.DONE},
        )
        for call in translator.emit.call_args_list
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

    assert any(
        call.args
        == (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "task_failed",
            },
        )
        for call in translator.emit.call_args_list
    )
    assert any(
        call.args
        == (
            Base.Event.TRANSLATION_RESET_FAILED,
            {"sub_event": Base.SubEvent.ERROR},
        )
        for call in translator.emit.call_args_list
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
    assert translator.emit.call_args_list[-1].args == (
        Base.Event.PROGRESS_TOAST,
        {"sub_event": Base.SubEvent.DONE},
    )


def test_run_translation_export_auto_source_error_has_no_toast(
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

    assert translator.mtool_optimizer_postprocess.call_count == 0
    assert not any(
        call.args[0] == Base.Event.TOAST for call in translator.emit.call_args_list
    )


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
    assert not any(
        call.args[0] == Base.Event.TOAST for call in translator.emit.call_args_list
    )


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

    assert any(
        call.args
        == (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "project_not_loaded",
            },
        )
        for call in translator.emit.call_args_list
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

    assert any(
        call.args
        == (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "no_active_model",
            },
        )
        for call in translator.emit.call_args_list
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

    assert any(
        call.args
        == (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "no_items",
            },
        )
        for call in translator.emit.call_args_list
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
    monkeypatch.setattr(
        translator_module.ProgressBar, "ProgressBar", FakeProgressBar, raising=False
    )
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
        call.args[0] == Base.Event.TRANSLATION_TASK
        and call.args[1].get("final_status") == "SUCCESS"
        for call in translator.emit.call_args_list
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
        call.args[0] == Base.Event.TRANSLATION_TASK
        and call.args[1].get("final_status") == expected_final_status
        for call in translator.emit.call_args_list
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

    assert any(
        call.args
        == (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "task_failed",
            },
        )
        for call in translator.emit.call_args_list
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
    snapshot = SimpleNamespace(merge_glossary_entries=MagicMock())
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

    snapshot.merge_glossary_entries.assert_called_once()
    merged_entries = snapshot.merge_glossary_entries.call_args.args[0]
    assert merged_entries[0]["src"] == "mismatch_src"
    assert merged_entries[0]["dst"] == "mismatch_dst"


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
    assert any(v.get_src() == "a" for v in items[3:])
    assert any(v.get_src() == "b" for v in items[3:])
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

    translator.emit.assert_called_once_with(
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

    translator.emit.assert_not_called()
    open_mock.assert_not_called()
