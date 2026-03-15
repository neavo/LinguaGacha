from __future__ import annotations

import contextlib
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from module.Data.DataManager import DataManager
from module.Data.Storage.LGDatabase import LGDatabase
from module.Localizer.Localizer import Localizer


def build_data_manager() -> DataManager:
    """构造一个不走完整初始化的门脸对象。"""

    dm = DataManager.__new__(DataManager)
    dm.session = SimpleNamespace(
        db=SimpleNamespace(open=MagicMock(), close=MagicMock()),
        lg_path="demo/project.lg",
        state_lock=contextlib.nullcontext(),
    )
    dm.state_lock = threading.RLock()  # type: ignore[name-defined]
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
    dm.emit = MagicMock()
    return dm


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
    dm = build_data_manager()

    dm.open_db()
    dm.close_db()

    dm.session.db.open.assert_called_once()
    dm.session.db.close.assert_called_once()


def test_on_translation_activity_clears_item_cache_and_emits_refresh_signal() -> None:
    dm = build_data_manager()

    dm.on_translation_activity(
        Base.Event.TRANSLATION_TASK,
        {"sub_event": Base.SubEvent.DONE},
    )

    dm.item_service.clear_item_cache.assert_called_once()
    dm.emit.assert_called_once_with(
        Base.Event.WORKBENCH_REFRESH,
        {"reason": Base.Event.TRANSLATION_TASK.value},
    )


def test_set_meta_emits_quality_rule_update_for_rule_meta_keys() -> None:
    dm = build_data_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.set_meta("glossary_enable", True)

    dm.meta_service.set_meta.assert_called_once_with("glossary_enable", True)
    dm.emit_quality_rule_update.assert_called_once_with(meta_keys=["glossary_enable"])


def test_update_batch_emits_quality_rule_update_for_rules_and_meta() -> None:
    dm = build_data_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.update_batch(
        rules={LGDatabase.RuleType.GLOSSARY: [{"src": "HP", "dst": "生命"}]},
        meta={"glossary_enable": True, "name": "demo"},
    )

    dm.batch_service.update_batch.assert_called_once()
    assert dm.emit_quality_rule_update.call_args_list[0].kwargs == {
        "rule_types": [LGDatabase.RuleType.GLOSSARY]
    }
    assert dm.emit_quality_rule_update.call_args_list[1].kwargs == {
        "meta_keys": ["glossary_enable"]
    }


def test_output_path_helpers_delegate_to_export_service() -> None:
    dm = build_data_manager()

    assert dm.get_translated_path() == "/tmp/translated"
    assert dm.get_bilingual_path() == "/tmp/bilingual"
    assert dm.export_custom_suffix_context("x") is not None


def test_create_project_emits_toast_when_presets_loaded() -> None:
    dm = build_data_manager()
    dm.project_service.create = MagicMock(return_value=["术语表"])

    class FakeLocalizer:
        quality_default_preset_loaded_toast = "已加载 {NAME}"

    original = Localizer.get
    Localizer.get = staticmethod(lambda: FakeLocalizer)  # type: ignore[assignment]
    try:
        dm.create_project("src", "out")
    finally:
        Localizer.get = original  # type: ignore[assignment]

    assert any(call.args[0] == Base.Event.TOAST for call in dm.emit.call_args_list)
