from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import module.Data.DataManager as data_manager_module
from base.Base import Base
from module.Data.DataManager import DataManager
from module.Data.Database.DatabaseContracts import DatabaseRuleType
from module.Localizer.Localizer import Localizer


def build_data_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DataManager, list[tuple[Base.Event, dict]]]:
    # 构造一个真实初始化后的 DataManager，再替换边界依赖。

    meta_store: dict[str, object] = {}
    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)
    dm = DataManager()
    dm.session.db = SimpleNamespace(open=MagicMock(), close=MagicMock())
    dm.session.lg_path = "demo/project.lg"
    dm.meta_service = SimpleNamespace(
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
    )
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
    )
    dm.translation_item_service = SimpleNamespace(get_items_for_translation=MagicMock())
    dm.analysis_service = SimpleNamespace(
        refresh_analysis_progress_snapshot_cache=MagicMock(return_value={"line": 1})
    )
    emitted_events: list[tuple[Base.Event, dict]] = []

    def capture_emit(event: Base.Event, data: dict) -> None:
        emitted_events.append((event, data))

    dm.emit = capture_emit
    dm.test_meta_store = meta_store
    return dm, emitted_events


def test_data_manager_init_sets_up_services(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)

    dm = DataManager()

    assert dm.session is not None
    assert dm.project_service is not None
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


def test_on_translation_activity_clears_item_cache_and_emits_refresh_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.on_translation_activity(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )

    dm.item_service.clear_item_cache.assert_called_once()
    assert emitted_events == []


def test_set_meta_updates_rule_meta_without_emitting_legacy_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.set_meta("glossary_enable", True)

    dm.meta_service.set_meta.assert_called_once_with("glossary_enable", True)
    assert emitted_events == []


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
    dm.analysis_service.refresh_analysis_progress_snapshot_cache = MagicMock(
        side_effect=lambda: call_order.append("refresh") or {"line": 1}
    )

    def capture_emit(event: Base.Event, data: dict) -> None:
        call_order.append("emit")
        emitted_events.append((event, data))

    dm.emit = capture_emit
    dm.load_project("demo/project.lg")

    dm.analysis_service.refresh_analysis_progress_snapshot_cache.assert_called_once()
    assert call_order == [
        ("load", "demo/project.lg"),
        "refresh",
        "emit",
    ]
    assert emitted_events == [(Base.Event.PROJECT_LOADED, {"path": "demo/project.lg"})]


def test_update_batch_no_longer_emits_legacy_quality_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.update_batch(
        rules={DatabaseRuleType.GLOSSARY: [{"src": "HP", "dst": "生命"}]},
        meta={"glossary_enable": True, "name": "demo"},
    )

    dm.batch_service.update_batch.assert_called_once()
    assert emitted_events == []


def test_apply_translation_batch_update_emits_items_patch_for_project_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.update_batch = MagicMock()

    change = dm.apply_translation_batch_update(
        [
            {
                "id": 7,
                "file_path": "script/a.txt",
                "dst": "译文",
            }
        ],
        {"line": 3},
    )

    assert change.item_ids == (7,)
    assert emitted_events == [
        (
            Base.Event.PROJECT_RUNTIME_PATCH,
            {
                "source": "translation_batch_update",
                "updatedSections": ["items"],
                "patch": [
                    {
                        "op": "merge_items",
                        "item_ids": [7],
                    }
                ],
            },
        )
    ]


def test_output_path_helpers_delegate_to_export_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)

    assert dm.get_translated_path() == "/tmp/translated"
    assert dm.get_bilingual_path() == "/tmp/bilingual"


def test_create_project_logs_when_presets_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _emitted_events = build_data_manager(monkeypatch)
    dm.project_service.create = MagicMock(return_value=["术语表"])
    logger = MagicMock()
    monkeypatch.setattr(
        data_manager_module.LogManager, "get", staticmethod(lambda: logger)
    )

    class FakeLocalizer:
        quality_default_preset_loaded_message = "已加载 {NAME}"

    original = Localizer.get
    Localizer.get = staticmethod(lambda: FakeLocalizer)  # type: ignore[assignment]
    try:
        dm.create_project("src", "out")
    finally:
        Localizer.get = original  # type: ignore[assignment]

    logger.info.assert_called_once_with("已加载 术语表")
