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
    # 同 src 存在多种译法时：选择出现次数最多的 dst；并列则取最早出现的。
    assert inserted[1]["dst"] == "A1"
    assert inserted[1]["name_dst"] == "N1"
    assert inserted[2]["src"] == "c"
    assert inserted[2]["dst"] == ""


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
