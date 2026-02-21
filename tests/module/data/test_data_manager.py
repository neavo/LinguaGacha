import contextlib
import importlib
import threading
from types import SimpleNamespace
from typing import Any
from typing import cast
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
from module.Data.DataManager import DataManager
from module.Data.LGDatabase import LGDatabase
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleMerger import QualityRuleMerger


data_manager_module = importlib.import_module("module.Data.DataManager")


def build_manager(*, loaded: bool = True) -> Any:
    dm = cast(Any, DataManager.__new__(DataManager))
    db = None
    if loaded:
        conn = SimpleNamespace(commit=MagicMock())
        db = SimpleNamespace(
            open=MagicMock(),
            close=MagicMock(),
            connection=MagicMock(return_value=contextlib.nullcontext(conn)),
            add_asset=MagicMock(return_value=1),
            get_items_by_file_path=MagicMock(return_value=[]),
            delete_items_by_file_path=MagicMock(return_value=0),
            delete_asset=MagicMock(),
            update_asset=MagicMock(),
            update_asset_path=MagicMock(return_value=1),
            insert_items=MagicMock(return_value=[]),
            asset_path_exists=MagicMock(return_value=False),
            get_all_asset_paths=MagicMock(return_value=[]),
            update_batch=MagicMock(),
        )
    dm.session = SimpleNamespace(
        db=db,
        lg_path="/workspace/demo/project.lg" if loaded else None,
        state_lock=threading.RLock(),
        asset_decompress_cache={},
    )
    dm.state_lock = dm.session.state_lock

    dm.meta_service = SimpleNamespace(get_meta=MagicMock(), set_meta=MagicMock())
    dm.rule_service = SimpleNamespace(
        get_rules_cached=MagicMock(return_value=[]),
        set_rules_cached=MagicMock(),
        get_rule_text_cached=MagicMock(return_value=""),
        set_rule_text_cached=MagicMock(),
        initialize_project_rules=MagicMock(return_value=[]),
    )
    dm.batch_service = SimpleNamespace(update_batch=MagicMock())
    dm.item_service = SimpleNamespace(
        clear_item_cache=MagicMock(),
        get_all_items=MagicMock(return_value=[]),
    )
    dm.asset_service = SimpleNamespace(
        clear_decompress_cache=MagicMock(),
        get_all_asset_paths=MagicMock(return_value=[]),
        get_asset=MagicMock(return_value=None),
        get_asset_decompressed=MagicMock(return_value=None),
    )
    dm.export_path_service = SimpleNamespace(
        timestamp_suffix_context=MagicMock(return_value=contextlib.nullcontext()),
        custom_suffix_context=MagicMock(return_value=contextlib.nullcontext()),
        get_translated_path=MagicMock(return_value="/workspace/out/translated"),
        get_bilingual_path=MagicMock(return_value="/workspace/out/bilingual"),
    )
    dm.project_service = SimpleNamespace(
        progress_callback="old",
        set_progress_callback=MagicMock(),
        create=MagicMock(return_value=[]),
        SUPPORTED_EXTENSIONS={".txt"},
        collect_source_files=MagicMock(return_value=["a.txt"]),
        get_project_preview=MagicMock(return_value={"name": "demo"}),
    )
    dm.translation_item_service = SimpleNamespace(get_items_for_translation=MagicMock())

    dm.emit = MagicMock()
    return dm


def test_data_manager_init_sets_up_locks_and_services(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 避免触发 EventManager(Python/Qt) 的全局副作用：这里不需要验证订阅行为本身。
    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)

    dm = DataManager()

    assert dm.session is not None
    assert dm.state_lock is dm.session.state_lock
    assert dm.prefilter_cond is not None
    assert dm.file_op_lock is not None


def test_data_manager_get_returns_singleton(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(DataManager, "subscribe", lambda *args, **kwargs: None)

    DataManager.instance = None
    try:
        dm1 = DataManager.get()
        dm2 = DataManager.get()
        assert dm1 is dm2
    finally:
        # 清理单例，避免污染其它用例。
        DataManager.instance = None


def test_open_db_and_close_db_guard_on_unloaded_project() -> None:
    dm = build_manager(loaded=False)

    dm.open_db()
    dm.close_db()

    # 不抛异常即可：工程未加载时应静默返回


def test_open_db_and_close_db_delegate_to_database() -> None:
    dm = build_manager()
    db = SimpleNamespace(open=MagicMock(), close=MagicMock())
    dm.session.db = db

    dm.open_db()
    dm.close_db()

    db.open.assert_called_once()
    db.close.assert_called_once()


@pytest.mark.parametrize(
    ("event", "expect_emit"),
    [
        (Base.Event.TRANSLATION_RUN, False),
        (Base.Event.TRANSLATION_DONE, True),
        (Base.Event.TRANSLATION_RESET, True),
        (Base.Event.TRANSLATION_RESET_FAILED, True),
    ],
)
def test_on_translation_activity_clears_item_cache_and_emits_refresh_signal(
    event: Base.Event, expect_emit: bool
) -> None:
    dm = build_manager()
    dm.item_service.clear_item_cache = MagicMock()

    dm.on_translation_activity(event, {})

    dm.item_service.clear_item_cache.assert_called_once()
    if expect_emit:
        dm.emit.assert_called_once_with(
            Base.Event.PROJECT_FILE_UPDATE,
            {"reason": event.value},
        )
    else:
        dm.emit.assert_not_called()


def test_emit_quality_rule_update_builds_payload() -> None:
    dm = build_manager()

    dm.emit_quality_rule_update(
        rule_types=[LGDatabase.RuleType.GLOSSARY],
        meta_keys=["text_preserve_mode"],
    )

    dm.emit.assert_called_once_with(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["GLOSSARY"], "meta_keys": ["text_preserve_mode"]},
    )


def test_set_meta_emits_quality_rule_update_for_rule_meta_keys() -> None:
    dm = build_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.set_meta("glossary_enable", True)

    dm.meta_service.set_meta.assert_called_once_with("glossary_enable", True)
    dm.emit_quality_rule_update.assert_called_once_with(meta_keys=["glossary_enable"])


def test_set_meta_does_not_emit_quality_rule_update_for_irrelevant_key() -> None:
    dm = build_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.set_meta("name", "demo")

    dm.meta_service.set_meta.assert_called_once_with("name", "demo")
    dm.emit_quality_rule_update.assert_not_called()


def test_update_batch_emits_quality_rule_update_for_rules_and_rule_meta_keys() -> None:
    dm = build_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.update_batch(
        items=[{"id": 1, "src": "A"}],
        rules={LGDatabase.RuleType.GLOSSARY: [{"src": "HP", "dst": "Health"}]},
        meta={"glossary_enable": True, "name": "demo"},
    )

    dm.batch_service.update_batch.assert_called_once()
    assert dm.emit_quality_rule_update.call_args_list[0].kwargs == {
        "rule_types": [LGDatabase.RuleType.GLOSSARY]
    }
    assert dm.emit_quality_rule_update.call_args_list[1].kwargs == {
        "meta_keys": ["glossary_enable"]
    }


def test_set_rules_cached_emits_quality_rule_update_only_when_save_true() -> None:
    dm = build_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.set_rules_cached(LGDatabase.RuleType.GLOSSARY, [], save=False)
    dm.emit_quality_rule_update.assert_not_called()

    dm.set_rules_cached(LGDatabase.RuleType.GLOSSARY, [], save=True)
    dm.emit_quality_rule_update.assert_called_once_with(
        rule_types=[LGDatabase.RuleType.GLOSSARY]
    )


def test_set_rule_text_cached_always_emits_quality_rule_update() -> None:
    dm = build_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.set_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, "prompt")

    dm.rule_service.set_rule_text_cached.assert_called_once_with(
        LGDatabase.RuleType.CUSTOM_PROMPT_ZH, "prompt"
    )
    dm.emit_quality_rule_update.assert_called_once_with(
        rule_types=[LGDatabase.RuleType.CUSTOM_PROMPT_ZH]
    )


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("smart", DataManager.TextPreserveMode.SMART),
        ("custom", DataManager.TextPreserveMode.CUSTOM),
        ("off", DataManager.TextPreserveMode.OFF),
        ("invalid", DataManager.TextPreserveMode.SMART),
        (123, DataManager.TextPreserveMode.SMART),
    ],
)
def test_get_text_preserve_mode_normalizes_invalid(
    raw: object, expected: object
) -> None:
    dm = build_manager()
    dm.get_meta = MagicMock(return_value=raw)

    assert dm.get_text_preserve_mode() == expected


@pytest.mark.parametrize(
    "mode,expected",
    [
        (DataManager.TextPreserveMode.CUSTOM, "custom"),
        ("smart", "smart"),
        ("invalid", "off"),
    ],
)
def test_set_text_preserve_mode_normalizes_input(mode: object, expected: str) -> None:
    dm = build_manager()
    dm.set_meta = MagicMock()

    dm.set_text_preserve_mode(mode)

    dm.set_meta.assert_called_once_with("text_preserve_mode", expected)


@pytest.mark.parametrize(
    "raw,expected",
    [
        (Base.ProjectStatus.PROCESSING, Base.ProjectStatus.PROCESSING),
        ("PROCESSED", Base.ProjectStatus.PROCESSED),
        ("BAD", Base.ProjectStatus.NONE),
        (None, Base.ProjectStatus.NONE),
    ],
)
def test_get_project_status_handles_legacy_types(
    raw: object, expected: Base.ProjectStatus
) -> None:
    dm = build_manager()
    dm.get_meta = MagicMock(return_value=raw)

    assert dm.get_project_status() == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ({"line": 1}, {"line": 1}),
        ([], {}),
        (None, {}),
    ],
)
def test_get_translation_extras_returns_dict_or_empty(
    raw: object, expected: dict
) -> None:
    dm = build_manager()
    dm.get_meta = MagicMock(return_value=raw)

    assert dm.get_translation_extras() == expected


def test_reset_failed_items_sync_returns_none_when_unloaded_or_empty() -> None:
    dm = build_manager(loaded=False)
    dm.update_batch = MagicMock()
    assert dm.reset_failed_items_sync() is None
    dm.update_batch.assert_not_called()

    dm = build_manager()
    dm.update_batch = MagicMock()
    dm.item_service.get_all_items = MagicMock(return_value=[])
    assert dm.reset_failed_items_sync() is None
    dm.update_batch.assert_not_called()


def test_reset_failed_items_sync_resets_error_items_and_updates_progress_meta() -> None:
    dm = build_manager()
    dm.get_translation_extras = MagicMock(return_value={})
    dm.update_batch = MagicMock()

    error_with_id = Item(
        id=1,
        src="A",
        dst="bad",
        status=Base.ProjectStatus.ERROR,
        retry_count=3,
    )
    error_without_id = Item(
        id=None,
        src="B",
        dst="bad",
        status=Base.ProjectStatus.ERROR,
        retry_count=1,
    )
    processed = Item(id=2, src="C", status=Base.ProjectStatus.PROCESSED)
    pending = Item(id=3, src="D", status=Base.ProjectStatus.NONE)
    excluded = Item(id=4, src="E", status=Base.ProjectStatus.EXCLUDED)

    dm.item_service.get_all_items = MagicMock(
        return_value=[error_with_id, error_without_id, processed, pending, excluded]
    )

    extras = dm.reset_failed_items_sync()
    assert extras == {
        "processed_line": 1,
        "error_line": 0,
        "line": 1,
        "total_line": 4,
    }

    assert error_with_id.get_dst() == ""
    assert error_with_id.get_status() == Base.ProjectStatus.NONE
    assert error_with_id.get_retry_count() == 0

    assert error_without_id.get_dst() == ""
    assert error_without_id.get_status() == Base.ProjectStatus.NONE
    assert error_without_id.get_retry_count() == 0

    dm.update_batch.assert_called_once()
    call_kwargs = dm.update_batch.call_args.kwargs
    assert call_kwargs["meta"] == {
        "translation_extras": extras,
        "project_status": Base.ProjectStatus.PROCESSING,
    }

    assert [item_dict["id"] for item_dict in call_kwargs["items"]] == [1]
    assert call_kwargs["items"][0]["status"] == Base.ProjectStatus.NONE
    assert call_kwargs["items"][0]["retry_count"] == 0


def test_timestamp_suffix_context_and_paths_raise_when_project_not_loaded() -> None:
    dm = build_manager(loaded=False)
    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.timestamp_suffix_context()

    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.get_translated_path()

    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.get_bilingual_path()


def test_timestamp_suffix_context_and_paths_delegate_to_export_path_service() -> None:
    dm = build_manager()
    dm.export_path_service.timestamp_suffix_context = MagicMock(
        return_value=contextlib.nullcontext()
    )

    ctx = dm.timestamp_suffix_context()
    assert ctx is not None
    dm.export_path_service.timestamp_suffix_context.assert_called_once_with(
        "/workspace/demo/project.lg"
    )

    assert dm.get_translated_path() == "/workspace/out/translated"
    dm.export_path_service.get_translated_path.assert_called_once_with(
        "/workspace/demo/project.lg"
    )
    assert dm.get_bilingual_path() == "/workspace/out/bilingual"
    dm.export_path_service.get_bilingual_path.assert_called_once_with(
        "/workspace/demo/project.lg"
    )


def test_export_custom_suffix_context_delegates_to_export_path_service() -> None:
    dm = build_manager()

    ctx = dm.export_custom_suffix_context("_s")

    assert ctx is not None
    dm.export_path_service.custom_suffix_context.assert_called_once_with("_s")


def test_create_project_restores_progress_callback_and_emits_toast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager()

    class FakeLocalizer:
        quality_default_preset_loaded_toast = "Loaded: {NAME}"

    monkeypatch.setattr(
        data_manager_module.Localizer,
        "get",
        staticmethod(lambda: FakeLocalizer),
    )

    dm.project_service.create = MagicMock(return_value=["Glossary", "TextPreserve"])
    dm.emit = MagicMock()

    callback = object()
    dm.create_project("/src", "/out", progress_callback=callback)

    assert dm.project_service.set_progress_callback.call_args_list[0].args == (
        callback,
    )
    assert dm.project_service.set_progress_callback.call_args_list[1].args == ("old",)
    dm.project_service.create.assert_called_once_with(
        "/src",
        "/out",
        init_rules=dm.rule_service.initialize_project_rules,
    )

    dm.emit.assert_called_once()
    event, payload = dm.emit.call_args.args
    assert event == Base.Event.TOAST
    assert payload["type"] == Base.ToastType.SUCCESS
    assert payload["message"] == "Loaded: Glossary | TextPreserve"


def test_create_project_does_not_emit_toast_when_no_presets_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager()

    class FakeLocalizer:
        quality_default_preset_loaded_toast = "Loaded: {NAME}"

    monkeypatch.setattr(
        data_manager_module.Localizer,
        "get",
        staticmethod(lambda: FakeLocalizer),
    )

    dm.project_service.create = MagicMock(return_value=[])
    dm.emit = MagicMock()

    dm.create_project("/src", "/out", progress_callback=None)

    dm.emit.assert_not_called()
    assert dm.project_service.set_progress_callback.call_count == 2


def test_is_prefilter_needed_compares_expected_config_snapshot() -> None:
    dm = build_manager()
    config = SimpleNamespace(
        source_language="EN", target_language="ZH", mtool_optimizer_enable=False
    )

    dm.get_meta = MagicMock(
        return_value={
            "source_language": "EN",
            "target_language": "ZH",
            "mtool_optimizer_enable": False,
        }
    )
    assert dm.is_prefilter_needed(config) is False

    dm.get_meta = MagicMock(return_value="not-a-dict")
    assert dm.is_prefilter_needed(config) is True


def test_on_project_loaded_schedules_prefilter_when_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager()
    dm.schedule_project_prefilter = MagicMock()
    dm.is_prefilter_needed = MagicMock(return_value=True)
    config = SimpleNamespace(
        source_language="EN", target_language="ZH", mtool_optimizer_enable=False
    )
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    dm.on_project_loaded(Base.Event.PROJECT_LOADED, {"path": "demo"})

    dm.schedule_project_prefilter.assert_called_once_with(
        config, reason="project_loaded"
    )


def test_on_project_loaded_does_nothing_when_prefilter_not_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager()
    dm.schedule_project_prefilter = MagicMock()
    dm.is_prefilter_needed = MagicMock(return_value=False)
    config = SimpleNamespace(
        source_language="EN", target_language="ZH", mtool_optimizer_enable=False
    )
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    dm.on_project_loaded(Base.Event.PROJECT_LOADED, {"path": "demo"})

    dm.schedule_project_prefilter.assert_not_called()


def test_on_config_updated_schedules_prefilter_only_on_relevant_keys_and_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = SimpleNamespace(
        source_language="EN", target_language="ZH", mtool_optimizer_enable=False
    )
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    dm = build_manager()
    dm.schedule_project_prefilter = MagicMock()
    dm.is_prefilter_needed = MagicMock(return_value=True)

    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["irrelevant"]})
    dm.schedule_project_prefilter.assert_not_called()

    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["source_language"]})
    dm.schedule_project_prefilter.assert_called_once_with(
        config, reason="config_updated"
    )

    dm = build_manager(loaded=False)
    dm.schedule_project_prefilter = MagicMock()
    dm.is_prefilter_needed = MagicMock(return_value=True)
    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["source_language"]})
    dm.schedule_project_prefilter.assert_not_called()


def test_on_config_updated_ignores_non_list_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = SimpleNamespace(
        source_language="EN", target_language="ZH", mtool_optimizer_enable=False
    )
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    dm = build_manager()
    dm.schedule_project_prefilter = MagicMock()
    dm.is_prefilter_needed = MagicMock(return_value=True)

    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": "not-a-list"})

    dm.schedule_project_prefilter.assert_not_called()


def test_on_config_updated_does_not_schedule_when_prefilter_not_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = SimpleNamespace(
        source_language="EN", target_language="ZH", mtool_optimizer_enable=False
    )
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    dm = build_manager()
    dm.schedule_project_prefilter = MagicMock()
    dm.is_prefilter_needed = MagicMock(return_value=False)

    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["source_language"]})

    dm.schedule_project_prefilter.assert_not_called()


def test_add_file_rejects_duplicate_path(monkeypatch: pytest.MonkeyPatch) -> None:
    dm = build_manager()
    dm.session.db.asset_path_exists = MagicMock(return_value=True)

    with pytest.raises(ValueError) as exc:
        dm.add_file("/workspace/a.txt")

    assert str(exc.value) == Localizer.get().workbench_msg_file_exists


def test_add_file_rejects_unsupported_extension() -> None:
    dm = build_manager()

    with pytest.raises(ValueError) as exc:
        dm.add_file("/workspace/a.bad")

    assert str(exc.value) == Localizer.get().workbench_msg_unsupported_format


def test_add_file_success_emits_event_and_clears_cache(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.asset_path_exists = MagicMock(return_value=False)

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {
                        "src": "A",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    path = tmp_path / "a.txt"
    path.write_bytes(b"hello")

    dm.add_file(str(path))

    assert dm.session.db.add_asset.call_args.args[0] == "a.txt"
    assert dm.session.db.add_asset.call_args.args[2] == 5
    assert isinstance(dm.session.db.add_asset.call_args.args[1], (bytes, bytearray))
    assert dm.session.db.insert_items.call_args.args[0][0]["src"] == "A"

    dm.item_service.clear_item_cache.assert_called_once()
    dm.emit.assert_called_once_with(
        Base.Event.PROJECT_FILE_UPDATE, {"rel_path": "a.txt"}
    )


def test_update_file_matches_by_src_and_returns_stats(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.asset_decompress_cache = {"a.txt": b"cached"}

    dm.session.db.asset_path_exists = MagicMock(side_effect=lambda p: p == "a.txt")
    dm.session.db.get_all_asset_paths = MagicMock(return_value=["a.txt"])

    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "A1",
                "name_dst": "N1",
                "status": Base.ProjectStatus.PROCESSED,
                "retry_count": 1,
                "file_type": "TXT",
                "file_path": "a.txt",
            },
            {
                "id": 2,
                "src": "a",
                "dst": "A2",
                "name_dst": "N2",
                "status": Base.ProjectStatus.ERROR,
                "retry_count": 0,
                "file_type": "TXT",
                "file_path": "a.txt",
            },
        ]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                ),
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                ),
                Item.from_dict(
                    {
                        "src": "c",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                ),
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    conn = SimpleNamespace(commit=MagicMock())
    dm.session.db.connection = MagicMock(return_value=contextlib.nullcontext(conn))

    new_path = tmp_path / "new.txt"
    new_path.write_bytes(b"data")

    stats = dm.update_file("a.txt", str(new_path))

    assert stats == {"matched": 2, "new": 1, "total": 3}
    conn.commit.assert_called_once()

    assert "a.txt" not in dm.session.asset_decompress_cache
    dm.item_service.clear_item_cache.assert_called_once()
    dm.emit.assert_called_once_with(
        Base.Event.PROJECT_FILE_UPDATE,
        {"rel_path": "new.txt", "old_rel_path": "a.txt"},
    )

    inserted = dm.session.db.insert_items.call_args.args[0]
    assert inserted[0]["dst"] == "A1"
    assert inserted[0]["name_dst"] == "N1"
    assert inserted[0]["status"] == Base.ProjectStatus.PROCESSED
    assert inserted[0]["retry_count"] == 1
    # 同 src 存在多种译法时：选择出现次数最多的 dst；并列则取最早出现的。
    assert inserted[1]["dst"] == "A1"
    assert inserted[1]["name_dst"] == "N1"
    assert inserted[1]["status"] == Base.ProjectStatus.PROCESSED
    assert inserted[1]["retry_count"] == 1
    assert inserted[2]["src"] == "c"
    assert inserted[2]["dst"] == ""
    assert inserted[2]["status"] == Base.ProjectStatus.NONE


def test_update_file_only_inherits_translation_from_processed_items(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.asset_path_exists = MagicMock(return_value=True)

    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "OLD",
                "name_dst": "N",
                "status": Base.ProjectStatus.ERROR,
                "retry_count": 3,
                "file_type": "TXT",
                "file_path": "a.txt",
            }
        ]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    new_path = tmp_path / "a.txt"
    new_path.write_bytes(b"data")

    dm.update_file("a.txt", str(new_path))

    inserted = dm.session.db.insert_items.call_args.args[0]
    assert inserted[0]["dst"] == ""
    assert inserted[0]["name_dst"] is None
    assert inserted[0]["status"] == Base.ProjectStatus.NONE
    assert inserted[0]["retry_count"] == 0


def test_update_file_does_not_override_structural_status(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.asset_path_exists = MagicMock(return_value=True)

    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "OLD",
                "name_dst": "N",
                "status": Base.ProjectStatus.PROCESSED,
                "retry_count": 1,
                "file_type": "TXT",
                "file_path": "a.txt",
            }
        ]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                        "status": Base.ProjectStatus.EXCLUDED,
                    }
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    new_path = tmp_path / "a.txt"
    new_path.write_bytes(b"data")

    dm.update_file("a.txt", str(new_path))

    inserted = dm.session.db.insert_items.call_args.args[0]
    assert inserted[0]["dst"] == "OLD"
    assert inserted[0]["name_dst"] == "N"
    assert inserted[0]["status"] == Base.ProjectStatus.EXCLUDED
    assert inserted[0]["retry_count"] == 1


def test_build_workbench_snapshot_excludes_structural_statuses() -> None:
    dm = build_manager()
    dm.asset_service.get_all_asset_paths = MagicMock(return_value=["a.txt"])
    dm.item_service.get_all_item_dicts = MagicMock(
        return_value=[
            {
                "file_path": "a.txt",
                "file_type": "TXT",
                "status": Base.ProjectStatus.EXCLUDED,
            },
            {
                "file_path": "a.txt",
                "file_type": "TXT",
                "status": Base.ProjectStatus.RULE_SKIPPED,
            },
            {
                "file_path": "a.txt",
                "file_type": "TXT",
                "status": Base.ProjectStatus.NONE,
            },
            {
                "file_path": "a.txt",
                "file_type": "TXT",
                "status": Base.ProjectStatus.PROCESSED,
            },
        ]
    )

    snapshot = dm.build_workbench_snapshot()

    assert snapshot.file_count == 1
    assert snapshot.total_items == 2
    assert snapshot.translated == 1
    assert snapshot.untranslated == 1
    assert snapshot.entries[0].rel_path == "a.txt"
    assert snapshot.entries[0].item_count == 2


def test_update_file_raises_on_format_mismatch(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[{"id": 1, "src": "a", "file_type": "TXT", "file_path": "a.txt"}]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {"src": "a", "file_path": rel_path, "file_type": Item.FileType.MD}
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    new_path = tmp_path / "new.txt"
    new_path.write_bytes(b"data")

    with pytest.raises(ValueError) as exc:
        dm.update_file("a.txt", str(new_path))

    assert str(exc.value) == Localizer.get().workbench_msg_update_format_mismatch


def test_update_file_raises_when_asset_missing(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[{"id": 1, "src": "a", "file_type": "TXT", "file_path": "a.txt"}]
    )
    dm.session.db.asset_path_exists = MagicMock(return_value=False)

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {"src": "a", "file_path": rel_path, "file_type": Item.FileType.TXT}
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    new_path = tmp_path / "new.txt"
    new_path.write_bytes(b"data")

    with pytest.raises(ValueError) as exc:
        dm.update_file("a.txt", str(new_path))

    assert str(exc.value) == Localizer.get().workbench_msg_file_not_found


def test_update_file_raises_on_name_conflict(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[{"id": 1, "src": "a", "file_type": "TXT", "file_path": "a.txt"}]
    )
    dm.session.db.asset_path_exists = MagicMock(return_value=True)
    dm.session.db.get_all_asset_paths = MagicMock(return_value=["a.txt", "b.txt"])

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {"src": "a", "file_path": rel_path, "file_type": Item.FileType.TXT}
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    new_path = tmp_path / "b.txt"
    new_path.write_bytes(b"data")

    with pytest.raises(ValueError) as exc:
        dm.update_file("a.txt", str(new_path))

    assert "b.txt" in str(exc.value)


def test_update_file_counts_items_with_non_string_src_as_new(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.asset_decompress_cache = {"a.txt": b"cached"}
    dm.session.db.asset_path_exists = MagicMock(return_value=True)
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "A",
                "status": Base.ProjectStatus.PROCESSED,
                "retry_count": 0,
                "file_type": "TXT",
                "file_path": "a.txt",
            }
        ]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {"src": None, "file_path": rel_path, "file_type": Item.FileType.TXT}
                ),
                Item.from_dict(
                    {"src": "a", "file_path": rel_path, "file_type": Item.FileType.TXT}
                ),
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    conn = SimpleNamespace(commit=MagicMock())
    dm.session.db.connection = MagicMock(return_value=contextlib.nullcontext(conn))

    new_path = tmp_path / "a.txt"
    new_path.write_bytes(b"data")

    stats = dm.update_file("a.txt", str(new_path))
    assert stats == {"matched": 1, "new": 1, "total": 2}


def test_reset_file_clears_translation_fields() -> None:
    dm = build_manager()
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "X",
                "name_dst": "N",
                "status": Base.ProjectStatus.PROCESSED,
                "retry_count": 3,
                "file_type": "TXT",
                "file_path": "a.txt",
            }
        ]
    )

    dm.reset_file("a.txt")

    dm.session.db.update_batch.assert_called_once()
    updated = dm.session.db.update_batch.call_args.kwargs["items"]
    assert updated[0]["dst"] == ""
    assert updated[0]["name_dst"] is None
    assert updated[0]["status"] == Base.ProjectStatus.NONE
    assert updated[0]["retry_count"] == 0
    assert updated[0]["src"] == "a"

    dm.item_service.clear_item_cache.assert_called_once()
    dm.emit.assert_called_once_with(
        Base.Event.PROJECT_FILE_UPDATE, {"rel_path": "a.txt"}
    )


def test_delete_file_emits_event_and_clears_caches() -> None:
    dm = build_manager()
    dm.session.asset_decompress_cache = {"a.txt": b"cached"}

    conn = SimpleNamespace(commit=MagicMock())
    dm.session.db.connection = MagicMock(return_value=contextlib.nullcontext(conn))

    dm.delete_file("a.txt")

    dm.session.db.delete_items_by_file_path.assert_called_once_with("a.txt", conn=conn)
    dm.session.db.delete_asset.assert_called_once_with("a.txt", conn=conn)
    conn.commit.assert_called_once()

    dm.item_service.clear_item_cache.assert_called_once()
    assert "a.txt" not in dm.session.asset_decompress_cache
    dm.emit.assert_called_once_with(
        Base.Event.PROJECT_FILE_UPDATE, {"rel_path": "a.txt"}
    )


def test_on_translation_activity_does_not_emit_when_project_unloaded() -> None:
    dm = build_manager(loaded=False)
    dm.item_service.clear_item_cache = MagicMock()

    dm.on_translation_activity(Base.Event.TRANSLATION_DONE, {})

    dm.item_service.clear_item_cache.assert_called_once()
    dm.emit.assert_not_called()


def test_emit_quality_rule_update_ignores_empty_fields() -> None:
    dm = build_manager()

    dm.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.GLOSSARY])
    dm.emit_quality_rule_update(meta_keys=["glossary_enable"])
    dm.emit_quality_rule_update()

    assert dm.emit.call_args_list[0].args == (
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["GLOSSARY"]},
    )
    assert dm.emit.call_args_list[1].args == (
        Base.Event.QUALITY_RULE_UPDATE,
        {"meta_keys": ["glossary_enable"]},
    )
    assert dm.emit.call_args_list[2].args == (Base.Event.QUALITY_RULE_UPDATE, {})


def test_status_and_translation_extras_setters_delegate_to_meta() -> None:
    dm = build_manager()
    dm.set_meta = MagicMock()

    dm.set_project_status(Base.ProjectStatus.PROCESSED)
    dm.set_translation_extras({"line": 2})

    assert dm.set_meta.call_args_list[0].args == ("project_status", "PROCESSED")
    assert dm.set_meta.call_args_list[1].args == ("translation_extras", {"line": 2})


def test_rule_prompt_item_and_asset_proxies_delegate_to_services() -> None:
    dm = build_manager()
    dm.rule_service.get_rules_cached = MagicMock(return_value=[{"src": "A"}])
    dm.rule_service.get_rule_text_cached = MagicMock(return_value="prompt")
    dm.set_rules_cached = MagicMock()
    dm.set_rule_text_cached = MagicMock()
    dm.item_service.save_item = MagicMock(return_value=10)
    dm.item_service.replace_all_items = MagicMock(return_value=[10, 11])

    assert dm.get_rules_cached(LGDatabase.RuleType.GLOSSARY) == [{"src": "A"}]
    assert dm.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH) == "prompt"
    assert dm.get_glossary() == [{"src": "A"}]
    assert dm.get_text_preserve() == [{"src": "A"}]
    assert dm.get_pre_replacement() == [{"src": "A"}]
    assert dm.get_post_replacement() == [{"src": "A"}]
    assert dm.get_custom_prompt_zh() == "prompt"
    assert dm.get_custom_prompt_en() == "prompt"

    dm.set_text_preserve([{"src": "tp"}])
    dm.set_pre_replacement([{"src": "pre"}])
    dm.set_post_replacement([{"src": "post"}])
    dm.set_custom_prompt_zh("zh")
    dm.set_custom_prompt_en("en")

    assert dm.set_rules_cached.call_args_list[0].args == (
        LGDatabase.RuleType.TEXT_PRESERVE,
        [{"src": "tp"}],
        True,
    )
    assert dm.set_rules_cached.call_args_list[1].args == (
        LGDatabase.RuleType.PRE_REPLACEMENT,
        [{"src": "pre"}],
        True,
    )
    assert dm.set_rules_cached.call_args_list[2].args == (
        LGDatabase.RuleType.POST_REPLACEMENT,
        [{"src": "post"}],
        True,
    )
    assert dm.set_rule_text_cached.call_args_list[0].args == (
        LGDatabase.RuleType.CUSTOM_PROMPT_ZH,
        "zh",
    )
    assert dm.set_rule_text_cached.call_args_list[1].args == (
        LGDatabase.RuleType.CUSTOM_PROMPT_EN,
        "en",
    )

    sample_item = Item(src="hello")
    assert dm.save_item(sample_item) == 10
    assert dm.replace_all_items([sample_item]) == [10, 11]
    dm.item_service.clear_item_cache.reset_mock()
    dm.clear_item_cache()
    dm.item_service.clear_item_cache.assert_called_once()

    assert dm.get_asset("a.txt") is None
    assert dm.get_asset_decompressed("a.txt") is None


@pytest.mark.parametrize(
    ("getter", "meta_key", "default", "raw", "expected"),
    [
        ("get_glossary_enable", "glossary_enable", True, 0, False),
        (
            "get_pre_replacement_enable",
            "pre_translation_replacement_enable",
            True,
            "yes",
            True,
        ),
        (
            "get_post_replacement_enable",
            "post_translation_replacement_enable",
            True,
            "",
            False,
        ),
        ("get_custom_prompt_zh_enable", "custom_prompt_zh_enable", False, 1, True),
        ("get_custom_prompt_en_enable", "custom_prompt_en_enable", False, 0, False),
    ],
)
def test_boolean_meta_getters_normalize_to_bool(
    getter: str, meta_key: str, default: bool, raw: object, expected: bool
) -> None:
    dm = build_manager()
    dm.get_meta = MagicMock(return_value=raw)

    assert getattr(dm, getter)() is expected
    dm.get_meta.assert_called_once_with(meta_key, default)


@pytest.mark.parametrize(
    ("setter", "meta_key", "value", "expected"),
    [
        ("set_glossary_enable", "glossary_enable", 0, False),
        (
            "set_pre_replacement_enable",
            "pre_translation_replacement_enable",
            "non-empty",
            True,
        ),
        (
            "set_post_replacement_enable",
            "post_translation_replacement_enable",
            "",
            False,
        ),
        ("set_custom_prompt_zh_enable", "custom_prompt_zh_enable", 1, True),
        ("set_custom_prompt_en_enable", "custom_prompt_en_enable", None, False),
    ],
)
def test_boolean_meta_setters_normalize_to_bool(
    setter: str, meta_key: str, value: object, expected: bool
) -> None:
    dm = build_manager()
    dm.set_meta = MagicMock()

    getattr(dm, setter)(value)

    dm.set_meta.assert_called_once_with(meta_key, expected)


def test_normalize_quality_rules_for_write_returns_input_on_unknown_type() -> None:
    dm = build_manager()
    data = [{"src": "A", "dst": "B"}]

    class UnknownRuleType:
        value = "UNKNOWN"

    result = dm.normalize_quality_rules_for_write(cast(Any, UnknownRuleType()), data)

    assert result == data


def test_merge_glossary_incoming_returns_none_when_no_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager()
    dm.get_glossary = MagicMock(return_value=[{"src": "A", "dst": "B"}])
    dm.set_glossary = MagicMock()

    empty_report = QualityRuleMerger.Report(
        added=0,
        updated=0,
        filled=0,
        deduped=0,
        skipped_empty_src=0,
        conflicts=(),
    )
    monkeypatch.setattr(
        data_manager_module.QualityRuleMerger,
        "merge",
        MagicMock(return_value=([{"src": "A", "dst": "B"}], empty_report)),
    )

    merged, report = dm.merge_glossary_incoming(
        incoming=[{"src": "A", "dst": "B"}],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
        save=True,
    )

    assert merged is None
    assert report == empty_report
    dm.set_glossary.assert_not_called()


def test_merge_glossary_incoming_updates_cache_when_changed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager()
    dm.get_glossary = MagicMock(return_value=[{"src": "A", "dst": "B"}])
    dm.set_glossary = MagicMock()

    changed_report = QualityRuleMerger.Report(
        added=1,
        updated=0,
        filled=0,
        deduped=0,
        skipped_empty_src=0,
        conflicts=(),
    )
    merged_rules = [{"src": "A", "dst": "B"}, {"src": "C", "dst": "D"}]
    monkeypatch.setattr(
        data_manager_module.QualityRuleMerger,
        "merge",
        MagicMock(return_value=(merged_rules, changed_report)),
    )

    merged, report = dm.merge_glossary_incoming(
        incoming=[{"src": "C", "dst": "D"}],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
        save=False,
    )

    assert merged == merged_rules
    assert report == changed_report
    dm.set_glossary.assert_called_once_with(merged_rules, save=False)


def test_file_operation_state_helpers() -> None:
    dm = build_manager()
    dm.file_op_lock = threading.Lock()
    dm.file_op_running = False

    assert dm.is_file_op_running() is False
    assert dm.try_begin_file_operation() is True
    assert dm.is_file_op_running() is True
    assert dm.try_begin_file_operation() is False

    dm.finish_file_operation()
    assert dm.is_file_op_running() is False


def test_add_update_reset_delete_raise_when_project_not_loaded() -> None:
    dm = build_manager(loaded=False)

    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.add_file("/workspace/a.txt")
    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.update_file("a.txt", "/workspace/a.txt")
    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.reset_file("a.txt")
    with pytest.raises(RuntimeError, match="工程未加载"):
        dm.delete_file("a.txt")


def test_reset_file_skips_batch_update_when_items_empty() -> None:
    dm = build_manager()
    dm.session.db.get_items_by_file_path = MagicMock(return_value=[])

    dm.reset_file("a.txt")

    dm.session.db.update_batch.assert_not_called()
    dm.item_service.clear_item_cache.assert_called_once()
    dm.emit.assert_called_once_with(
        Base.Event.PROJECT_FILE_UPDATE, {"rel_path": "a.txt"}
    )


def test_get_meta_delegates_to_meta_service() -> None:
    dm = build_manager()
    dm.meta_service.get_meta = MagicMock(return_value="v")

    assert dm.get_meta("k", "d") == "v"
    dm.meta_service.get_meta.assert_called_once_with("k", "d")


def test_update_batch_does_not_emit_when_rules_or_relevant_meta_missing() -> None:
    dm = build_manager()
    dm.emit_quality_rule_update = MagicMock()

    dm.update_batch(items=[{"id": 1}])
    dm.update_batch(meta={"name": "demo"})

    dm.emit_quality_rule_update.assert_not_called()


def test_data_manager_get_returns_existing_instance_when_set_during_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeLock:
        def __enter__(self) -> None:
            DataManager.instance = cast(Any, sentinel)

        def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
            del exc_type
            del exc
            del tb
            return False

    sentinel = object()
    old_lock = DataManager.lock
    DataManager.instance = None
    monkeypatch.setattr(DataManager, "lock", FakeLock())
    try:
        assert DataManager.get() is sentinel
    finally:
        DataManager.lock = old_lock
        DataManager.instance = None


def test_update_file_with_empty_new_path_keeps_old_rel_path_before_open() -> None:
    dm = build_manager()
    dm.session.db.get_items_by_file_path = MagicMock(return_value=[])

    with pytest.raises(FileNotFoundError):
        dm.update_file("dir/a.txt", "")


def test_update_file_rename_keeps_parent_and_handles_non_conflict_paths(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.asset_decompress_cache = {"dir/a.txt": b"cached"}
    dm.session.db.asset_path_exists = MagicMock(return_value=True)
    dm.session.db.get_all_asset_paths = MagicMock(
        return_value=[None, "", "dir/a.txt", "dir/c.txt"]
    )
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": None,
                "dst": "",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": Item.FileType.NONE,
                "file_path": "dir/a.txt",
            },
            {
                "id": 2,
                "src": "a",
                "dst": "X",
                "name_dst": "NX",
                "status": Base.ProjectStatus.PROCESSED,
                "retry_count": 1,
                "file_type": "TXT",
                "file_path": "dir/a.txt",
            },
            {
                "id": 3,
                "src": "a",
                "dst": "Y",
                "name_dst": "NY",
                "status": "BAD_STATUS",
                "retry_count": 2,
                "file_type": "TXT",
                "file_path": "dir/a.txt",
            },
            {
                "id": 4,
                "src": "a",
                "dst": "Y",
                "name_dst": "NY2",
                "status": "BAD_STATUS",
                "retry_count": 3,
                "file_type": "TXT",
                "file_path": "dir/a.txt",
            },
        ]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            assert rel_path.replace("\\", "/") == "dir/b.txt"
            return [
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.NONE,
                    }
                ),
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                ),
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    conn = SimpleNamespace(commit=MagicMock())
    dm.session.db.connection = MagicMock(return_value=contextlib.nullcontext(conn))

    new_path = tmp_path / "b.txt"
    new_path.write_bytes(b"data")

    stats = dm.update_file("dir/a.txt", str(new_path))

    assert stats == {"matched": 2, "new": 0, "total": 2}
    update_args, update_kwargs = dm.session.db.update_asset_path.call_args
    assert update_args[0] == "dir/a.txt"
    assert update_args[1].replace("\\", "/") == "dir/b.txt"
    assert update_kwargs["conn"] is conn
    inserted = dm.session.db.insert_items.call_args.args[0]
    assert inserted[0]["dst"] == ""
    assert inserted[0]["status"] == Base.ProjectStatus.NONE
    event, payload = dm.emit.call_args.args
    assert event == Base.Event.PROJECT_FILE_UPDATE
    assert payload["old_rel_path"] == "dir/a.txt"
    assert payload["rel_path"].replace("\\", "/") == "dir/b.txt"


def test_update_file_accepts_none_file_type_on_both_sides(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.asset_path_exists = MagicMock(return_value=True)
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[{"id": 1, "src": "a", "file_type": Item.FileType.NONE}]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.NONE,
                    }
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    conn = SimpleNamespace(commit=MagicMock())
    dm.session.db.connection = MagicMock(return_value=contextlib.nullcontext(conn))

    new_path = tmp_path / "a.txt"
    new_path.write_bytes(b"data")

    stats = dm.update_file("a.txt", str(new_path))

    assert stats == {"matched": 1, "new": 0, "total": 1}


def test_update_file_non_string_old_status_falls_back_to_none(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dm = build_manager()
    dm.session.db.asset_path_exists = MagicMock(return_value=True)
    dm.session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "OLD",
                "status": None,
                "file_type": "TXT",
                "file_path": "a.txt",
            }
        ]
    )

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict(
                    {
                        "src": "a",
                        "file_path": rel_path,
                        "file_type": Item.FileType.TXT,
                    }
                )
            ]

    file_manager_module = importlib.import_module("module.File.FileManager")
    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    conn = SimpleNamespace(commit=MagicMock())
    dm.session.db.connection = MagicMock(return_value=contextlib.nullcontext(conn))

    new_path = tmp_path / "a.txt"
    new_path.write_bytes(b"data")

    stats = dm.update_file("a.txt", str(new_path))

    assert stats == {"matched": 1, "new": 0, "total": 1}
    inserted = dm.session.db.insert_items.call_args.args[0]
    assert inserted[0]["status"] == Base.ProjectStatus.NONE
    assert inserted[0]["dst"] == ""
