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
    fake_dm = SimpleNamespace(update_batch=MagicMock())
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translator.apply_batch_update_sync(
        translator,
        finalized_items=[{"id": 1, "dst": "a"}],
        glossaries=[{"src": "A", "dst": "甲"}],
        extras_snapshot={"line": 1},
    )

    kwargs = fake_dm.update_batch.call_args.kwargs
    assert kwargs["items"] == [{"id": 1, "dst": "a"}]
    assert kwargs["rules"] == {}
    assert kwargs["meta"]["project_status"] == Base.ProjectStatus.PROCESSING


def test_apply_batch_update_sync_with_auto_glossary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = create_translator_stub()
    translator.config.auto_glossary_enable = True
    translator.merge_glossary = MagicMock(return_value=[{"src": "A", "dst": "甲"}])
    fake_dm = SimpleNamespace(update_batch=MagicMock())
    monkeypatch.setattr(
        translator_module.DataManager, "get", staticmethod(lambda: fake_dm)
    )

    Translator.apply_batch_update_sync(
        translator,
        finalized_items=[{"id": 1, "dst": "a"}],
        glossaries=[{"src": "A", "dst": "甲"}],
        extras_snapshot={"line": 1},
    )

    kwargs = fake_dm.update_batch.call_args.kwargs
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
    translator.emit.assert_called_once_with(
        Base.Event.TRANSLATION_REQUEST_STOP,
        {"sub_event": Base.SubEvent.RUN},
    )


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
    assert translator.emit.call_args_list[0].args == (
        Base.Event.PROGRESS_TOAST,
        {
            "sub_event": Base.SubEvent.RUN,
            "message": "start",
            "indeterminate": True,
        },
    )
    assert translator.emit.call_args_list[-1].args == (
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

    assert any(
        call.args
        == (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "failed",
            },
        )
        for call in translator.emit.call_args_list
    )
