from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from module.Data.DataManager import DataManager
from module.Data.Storage.LGDatabase import LGDatabase
from module.Localizer.Localizer import Localizer


def build_data_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DataManager, list[tuple[Base.Event, dict]]]:
    """构造一个真实初始化后的 DataManager，再替换边界依赖。"""

    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)
    dm = DataManager()
    dm.session.db = SimpleNamespace(open=MagicMock(), close=MagicMock())
    dm.session.lg_path = "demo/project.lg"
    dm.meta_service = SimpleNamespace(get_meta=MagicMock(), set_meta=MagicMock())
    dm.rule_service = SimpleNamespace(
        get_rules_cached=MagicMock(return_value=[]),
        set_rules_cached=MagicMock(),
        get_rule_text_cached=MagicMock(return_value=""),
        set_rule_text_cached=MagicMock(),
        initialize_project_rules=MagicMock(return_value=[]),
    )
    dm.item_service = SimpleNamespace(
        clear_item_cache=MagicMock(),
        get_all_items=MagicMock(return_value=[]),
        get_all_item_dicts=MagicMock(return_value=[]),
        save_item=MagicMock(return_value=1),
        replace_all_items=MagicMock(return_value=[1]),
    )
    dm.asset_service = SimpleNamespace(
        get_all_asset_paths=MagicMock(return_value=[]),
        get_asset=MagicMock(return_value=None),
        get_asset_decompressed=MagicMock(return_value=None),
        clear_decompress_cache=MagicMock(),
    )
    dm.batch_service = SimpleNamespace(update_batch=MagicMock())
    dm.export_path_service = SimpleNamespace(
        timestamp_suffix_context=MagicMock(return_value=contextlib.nullcontext()),
        custom_suffix_context=MagicMock(return_value=contextlib.nullcontext()),
        get_translated_path=MagicMock(return_value="/tmp/translated"),
        get_bilingual_path=MagicMock(return_value="/tmp/bilingual"),
    )
    dm.project_service = SimpleNamespace(
        progress_callback=None,
        set_progress_callback=MagicMock(),
        create=MagicMock(return_value=[]),
        SUPPORTED_EXTENSIONS={".txt"},
        collect_source_files=MagicMock(return_value=["a.txt"]),
        get_project_preview=MagicMock(return_value={"name": "demo"}),
    )
    dm.translation_item_service = SimpleNamespace(get_items_for_translation=MagicMock())
    dm.analysis_service = SimpleNamespace(
        refresh_analysis_progress_snapshot_cache=MagicMock(return_value={"line": 1})
    )
    emitted_events: list[tuple[Base.Event, dict]] = []

    def capture_emit(event: Base.Event, data: dict) -> None:
        emitted_events.append((event, data))

    dm.emit = capture_emit
    return dm, emitted_events


def test_data_manager_init_sets_up_services(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)

    dm = DataManager()

    assert dm.session is not None
    assert dm.prefilter_service is not None
    assert dm.project_file_service is not None
    assert dm.analysis_service is not None
    assert dm.quality_rule_service is not None


def test_data_manager_get_returns_singleton(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)
    DataManager.instance = None
    try:
        first = DataManager.get()
        second = DataManager.get()
        assert first is second
    finally:
        DataManager.instance = None


def test_open_db_and_close_db_delegate_to_database() -> None:
    monkeypatch = pytest.MonkeyPatch()
    try:
        dm, _events = build_data_manager(monkeypatch)

        dm.open_db()
        dm.close_db()

        dm.session.db.open.assert_called_once()
        dm.session.db.close.assert_called_once()
    finally:
        monkeypatch.undo()


def test_on_translation_activity_clears_item_cache_and_emits_refresh_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.on_translation_activity(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )

    dm.item_service.clear_item_cache.assert_called_once()
    assert emitted_events == [
        (
            Base.Event.WORKBENCH_REFRESH,
            {"reason": Base.Event.TRANSLATION_TASK.value},
        )
    ]


def test_set_meta_emits_quality_rule_update_for_rule_meta_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.set_meta("glossary_enable", True)

    dm.meta_service.set_meta.assert_called_once_with("glossary_enable", True)
    assert emitted_events == [
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {"meta_keys": ["glossary_enable"]},
        )
    ]


def test_load_project_runs_post_actions_before_emitting_loaded_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.session.db = None
    dm.session.lg_path = None
    call_order: list[tuple[str, str] | str] = []
    dm.lifecycle_service = SimpleNamespace(
        load_project=MagicMock(
            side_effect=lambda lg_path: call_order.append(("load", lg_path))
        ),
        unload_project=MagicMock(return_value=None),
    )
    dm.schedule_prefilter_if_needed = MagicMock(
        side_effect=lambda reason: call_order.append(("prefilter", reason)) or False
    )
    dm.analysis_service.refresh_analysis_progress_snapshot_cache = MagicMock(
        side_effect=lambda: call_order.append("refresh") or {"line": 1}
    )

    def capture_emit(event: Base.Event, data: dict) -> None:
        call_order.append("emit")
        emitted_events.append((event, data))

    dm.emit = capture_emit
    dm.load_project("demo/project.lg")

    dm.schedule_prefilter_if_needed.assert_called_once_with(reason="project_loaded")
    dm.analysis_service.refresh_analysis_progress_snapshot_cache.assert_called_once()
    assert call_order == [
        ("load", "demo/project.lg"),
        ("prefilter", "project_loaded"),
        "refresh",
        "emit",
    ]
    assert emitted_events == [(Base.Event.PROJECT_LOADED, {"path": "demo/project.lg"})]


def test_load_project_skips_analysis_refresh_when_prefilter_is_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.session.db = None
    dm.session.lg_path = None
    dm.lifecycle_service = SimpleNamespace(
        load_project=MagicMock(),
        unload_project=MagicMock(return_value=None),
    )
    dm.schedule_prefilter_if_needed = MagicMock(return_value=True)

    dm.load_project("demo/project.lg")

    dm.schedule_prefilter_if_needed.assert_called_once_with(reason="project_loaded")
    dm.analysis_service.refresh_analysis_progress_snapshot_cache.assert_not_called()
    assert emitted_events == [(Base.Event.PROJECT_LOADED, {"path": "demo/project.lg"})]


def test_project_prefilter_worker_refreshes_analysis_snapshot_after_update(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    request = SimpleNamespace(reason="file_op", lg_path="demo/project.lg", token=7)
    dm.prefilter_service = SimpleNamespace(
        pop_pending_request=MagicMock(side_effect=[request, None]),
        mark_request_handled=MagicMock(),
        finish_worker=MagicMock(),
    )
    dm.apply_project_prefilter_once = MagicMock(return_value=SimpleNamespace())
    dm.log_prefilter_result = MagicMock()

    dm.project_prefilter_worker(token=7)

    dm.analysis_service.refresh_analysis_progress_snapshot_cache.assert_called_once()
    dm.prefilter_service.mark_request_handled.assert_called_once_with(request)
    dm.prefilter_service.finish_worker.assert_called_once()
    assert (
        Base.Event.PROJECT_PREFILTER,
        {
            "sub_event": Base.ProjectPrefilterSubEvent.UPDATED,
            "reason": "file_op",
            "token": 7,
            "lg_path": "demo/project.lg",
        },
    ) in emitted_events


def test_update_batch_emits_quality_rule_update_for_rules_and_meta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.update_batch(
        rules={LGDatabase.RuleType.GLOSSARY: [{"src": "HP", "dst": "生命"}]},
        meta={"glossary_enable": True, "name": "demo"},
    )

    dm.batch_service.update_batch.assert_called_once()
    assert emitted_events == [
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {"rule_types": [LGDatabase.RuleType.GLOSSARY.value]},
        ),
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {"meta_keys": ["glossary_enable"]},
        ),
    ]


def test_on_config_updated_schedules_prefilter_for_relevant_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed = MagicMock()

    dm.on_config_updated(
        Base.Event.CONFIG_UPDATED,
        {"keys": ["source_language", "unrelated_key"]},
    )

    dm.schedule_prefilter_if_needed.assert_called_once_with(reason="config_updated")


def test_on_config_updated_ignores_irrelevant_keys_and_unloaded_project(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed = MagicMock()

    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["ignored_key"]})
    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["app_language"]})
    dm.session.db = None
    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["source_language"]})

    dm.schedule_prefilter_if_needed.assert_not_called()


def test_import_analysis_candidates_emits_quality_rule_update_only_when_imported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.analysis_service.import_analysis_candidates = MagicMock(side_effect=[2, 0, None])

    assert dm.import_analysis_candidates() == 2
    assert dm.import_analysis_candidates() == 0
    assert dm.import_analysis_candidates() is None
    assert emitted_events == [
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {"rule_types": [LGDatabase.RuleType.GLOSSARY.value]},
        )
    ]


def test_output_path_helpers_delegate_to_export_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)

    assert dm.get_translated_path() == "/tmp/translated"
    assert dm.get_bilingual_path() == "/tmp/bilingual"
    assert dm.export_custom_suffix_context("x") is not None


def test_create_project_emits_toast_when_presets_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.project_service.create = MagicMock(return_value=["术语表"])

    class FakeLocalizer:
        quality_default_preset_loaded_toast = "已加载 {NAME}"

    original = Localizer.get
    Localizer.get = staticmethod(lambda: FakeLocalizer)  # type: ignore[assignment]
    try:
        dm.create_project("src", "out")
    finally:
        Localizer.get = original  # type: ignore[assignment]

    assert emitted_events == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": "已加载 术语表",
            },
        )
    ]
