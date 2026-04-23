from __future__ import annotations

import contextlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import module.Data.DataManager as data_manager_module
from base.Base import Base
from module.Data.DataManager import DataManager
from module.Data.Core.Item import Item
from module.Data.Storage.LGDatabase import LGDatabase
from module.Localizer.Localizer import Localizer


def build_data_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DataManager, list[tuple[Base.Event, dict]]]:
    """构造一个真实初始化后的 DataManager，再替换边界依赖。"""

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
    dm.test_meta_store = meta_store
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


def test_sync_project_language_meta_updates_current_project_meta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    class FakeConfig:
        source_language = "JA"
        target_language = "EN"

    monkeypatch.setattr(
        "module.Data.DataManager.Config.load",
        lambda self: FakeConfig(),
    )

    dm.sync_project_language_meta()

    assert dm.test_meta_store == {
        "source_language": "JA",
        "target_language": "EN",
    }
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
    request = SimpleNamespace(
        reason="file_op",
        lg_path="demo/project.lg",
    )
    dm.prefilter_service = SimpleNamespace(
        pop_pending_request=MagicMock(side_effect=[request, None]),
        finish_worker=MagicMock(),
    )
    dm.apply_project_prefilter_once = MagicMock(return_value=SimpleNamespace())
    dm.log_prefilter_result = MagicMock()

    dm.project_prefilter_worker()

    dm.analysis_service.refresh_analysis_progress_snapshot_cache.assert_called_once()
    dm.prefilter_service.finish_worker.assert_called_once()
    assert emitted_events == []


def test_project_prefilter_worker_can_skip_page_refresh_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    request = SimpleNamespace(
        reason="file_op",
        lg_path="demo/project.lg",
    )
    dm.prefilter_service = SimpleNamespace(
        pop_pending_request=MagicMock(side_effect=[request, None]),
        finish_worker=MagicMock(),
    )
    dm.apply_project_prefilter_once = MagicMock(return_value=SimpleNamespace())
    dm.log_prefilter_result = MagicMock()

    dm.project_prefilter_worker()

    assert emitted_events == []


def test_update_batch_no_longer_emits_legacy_quality_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.update_batch(
        rules={LGDatabase.RuleType.GLOSSARY: [{"src": "HP", "dst": "生命"}]},
        meta={"glossary_enable": True, "name": "demo"},
    )

    dm.batch_service.update_batch.assert_called_once()
    assert emitted_events == []


def test_apply_translation_batch_update_emits_items_patch_for_project_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.update_batch = MagicMock()

    class FakeRuntimeService:
        def __init__(self, data_manager: DataManager) -> None:
            self.data_manager = data_manager

        def build_item_records(self, item_ids: list[int]) -> list[dict[str, object]]:
            assert self.data_manager is dm
            return [
                {
                    "item_id": item_id,
                    "file_path": "script/a.txt",
                    "src": "原文",
                    "dst": "译文",
                    "status": "DONE",
                }
                for item_id in item_ids
            ]

        def get_section_revision(self, section: str) -> int:
            assert section == "items"
            return 3

        def build_section_revisions(self) -> dict[str, int]:
            return {"items": 3}

    monkeypatch.setattr(
        "module.Data.Project.ProjectRuntimeService.ProjectRuntimeService",
        FakeRuntimeService,
    )

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
                "sectionRevisions": {"items": 3},
                "projectRevision": 3,
                "patch": [
                    {
                        "op": "merge_items",
                        "items": [
                            {
                                "item_id": 7,
                                "file_path": "script/a.txt",
                                "src": "原文",
                                "dst": "译文",
                                "status": "DONE",
                            }
                        ],
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


def test_persist_add_file_payload_compresses_asset_before_store(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    connection = SimpleNamespace(commit=MagicMock())
    db = SimpleNamespace(
        asset_path_exists=MagicMock(return_value=False),
        add_asset=MagicMock(),
        set_items=MagicMock(),
        delete_analysis_item_checkpoints=MagicMock(),
        clear_analysis_candidate_aggregates=MagicMock(),
        connection=MagicMock(return_value=contextlib.nullcontext(connection)),
    )
    dm.session.db = db
    dm.session.asset_decompress_cache = {}
    dm.get_all_asset_records = MagicMock(return_value=[])
    dm.build_analysis_reset_meta = MagicMock(return_value={})
    dm.write_meta_in_connection = MagicMock()
    dm.replace_session_item_cache = MagicMock()
    dm.sync_session_meta_cache = MagicMock()
    dm.bump_project_runtime_section_revisions = MagicMock()
    dm.try_begin_guarded_file_operation = MagicMock()
    dm.finish_file_operation = MagicMock()

    source_path = tmp_path / "sample_02.txt"
    source_path.write_bytes(b"new content")

    compress = MagicMock(return_value=b"compressed")
    monkeypatch.setattr(data_manager_module.ZstdTool, "compress", compress)

    dm.persist_add_file_payload(
        str(source_path),
        "sample_02.txt",
        file_record={"rel_path": "sample_02.txt", "sort_index": 1},
        parsed_items=[],
        translation_extras={},
        project_status="IDLE",
        prefilter_config={},
    )

    compress.assert_called_once_with(b"new content")
    db.add_asset.assert_called_once_with(
        "sample_02.txt",
        b"compressed",
        len(b"new content"),
        sort_order=1,
        conn=connection,
    )


def test_persist_replace_file_payload_compresses_asset_before_store(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    connection = SimpleNamespace(commit=MagicMock())
    db = SimpleNamespace(
        asset_path_exists=MagicMock(return_value=True),
        update_asset=MagicMock(),
        update_asset_path=MagicMock(),
        set_items=MagicMock(),
        delete_analysis_item_checkpoints=MagicMock(),
        clear_analysis_candidate_aggregates=MagicMock(),
        connection=MagicMock(return_value=contextlib.nullcontext(connection)),
    )
    dm.session.db = db
    dm.session.asset_decompress_cache = {}
    dm.build_analysis_reset_meta = MagicMock(return_value={})
    dm.write_meta_in_connection = MagicMock()
    dm.replace_session_item_cache = MagicMock()
    dm.sync_session_meta_cache = MagicMock()
    dm.bump_project_runtime_section_revisions = MagicMock()
    dm.try_begin_guarded_file_operation = MagicMock()
    dm.finish_file_operation = MagicMock()

    source_path = tmp_path / "sample_01.txt"
    source_path.write_bytes(b"updated content")

    compress = MagicMock(return_value=b"compressed")
    monkeypatch.setattr(data_manager_module.ZstdTool, "compress", compress)

    dm.persist_replace_file_payload(
        str(source_path),
        "sample_01.txt",
        "sample_01.txt",
        file_record={"rel_path": "sample_01.txt"},
        parsed_items=[],
        translation_extras={},
        project_status="IDLE",
        prefilter_config={},
    )

    compress.assert_called_once_with(b"updated content")
    db.update_asset.assert_called_once_with(
        "sample_01.txt",
        b"compressed",
        len(b"updated content"),
        conn=connection,
    )
    db.update_asset_path.assert_not_called()


def test_preview_translation_reset_all_assigns_preview_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    parsed_items = [Item(src="A"), Item(src="B")]
    dm.translation_item_service = SimpleNamespace(
        get_items_for_translation=MagicMock(return_value=parsed_items)
    )
    dm.item_service = SimpleNamespace(
        preview_replace_all_item_ids=MagicMock(return_value=[9, 10])
    )

    preview_items = dm.preview_translation_reset_all(SimpleNamespace())

    assert [item["id"] for item in preview_items] == [9, 10]
    assert [item["src"] for item in preview_items] == ["A", "B"]


def test_apply_translation_reset_all_payload_replaces_items_and_clears_analysis_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    connection = SimpleNamespace(commit=MagicMock())
    db = SimpleNamespace(
        connection=MagicMock(return_value=contextlib.nullcontext(connection)),
        set_items=MagicMock(),
        delete_analysis_item_checkpoints=MagicMock(),
        clear_analysis_candidate_aggregates=MagicMock(),
    )
    dm.session.db = db
    dm.write_meta_in_connection = MagicMock()
    dm.replace_session_item_cache = MagicMock()
    dm.sync_session_meta_cache = MagicMock()
    dm.assert_expected_runtime_revisions = MagicMock()
    dm.bump_project_runtime_section_revisions = MagicMock()

    items = dm.apply_translation_reset_all_payload(
        item_payloads=[
            {
                "id": 11,
                "src": "原文",
                "dst": "",
                "name_src": "Alice",
                "name_dst": None,
                "extra_field": "",
                "tag": "",
                "row": 1,
                "file_type": "TXT",
                "file_path": "script/a.txt",
                "text_type": "NONE",
                "status": "NONE",
                "retry_count": 0,
            }
        ],
        translation_extras={"line": 0},
        project_status="NONE",
        prefilter_config={"source_language": "JA"},
        expected_section_revisions={"items": 1, "analysis": 2},
    )

    assert items == [
        {
            "id": 11,
            "src": "原文",
            "dst": "",
            "name_src": "Alice",
            "name_dst": None,
            "extra_field": "",
            "tag": "",
            "row": 1,
            "file_type": "TXT",
            "file_path": "script/a.txt",
            "text_type": "NONE",
            "status": "NONE",
            "retry_count": 0,
        }
    ]
    db.set_items.assert_called_once_with(items, conn=connection)
    db.delete_analysis_item_checkpoints.assert_called_once_with(conn=connection)
    db.clear_analysis_candidate_aggregates.assert_called_once_with(conn=connection)
    dm.replace_session_item_cache.assert_called_once_with(items)
    dm.sync_session_meta_cache.assert_called_once()
    dm.bump_project_runtime_section_revisions.assert_called_once_with(
        ("items", "analysis")
    )


def test_apply_translation_reset_failed_payload_updates_items_and_meta_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    dm.merge_partial_item_payloads = MagicMock(
        return_value=[
            {
                "id": 11,
                "src": "原文",
                "dst": "",
                "status": "NONE",
                "retry_count": 0,
            }
        ]
    )
    dm.update_batch = MagicMock()
    dm.assert_expected_runtime_revisions = MagicMock()
    dm.bump_project_runtime_section_revision = MagicMock()

    items = dm.apply_translation_reset_failed_payload(
        item_payloads=[{"id": 11, "dst": "", "status": "NONE", "retry_count": 0}],
        translation_extras={"line": 3, "error_line": 0},
        project_status="PROCESSING",
        expected_section_revisions={"items": 2},
    )

    assert items == [
        {
            "id": 11,
            "src": "原文",
            "dst": "",
            "status": "NONE",
            "retry_count": 0,
        }
    ]
    dm.update_batch.assert_called_once_with(
        items=items,
        meta={
            "translation_extras": {"line": 3, "error_line": 0},
            "project_status": "PROCESSING",
        },
    )
    dm.bump_project_runtime_section_revision.assert_called_once_with("items")


def test_apply_analysis_reset_all_payload_uses_analysis_service_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    dm.analysis_service = SimpleNamespace(
        clear_analysis_progress_with_snapshot=MagicMock(
            return_value={"line": 0, "total_line": 5}
        )
    )
    dm.assert_expected_runtime_revisions = MagicMock()
    dm.bump_project_runtime_section_revision = MagicMock()

    snapshot = dm.apply_analysis_reset_all_payload(
        analysis_extras={"line": 0, "total_line": 5},
        expected_section_revisions={"analysis": 3},
    )

    assert snapshot == {"line": 0, "total_line": 5}
    dm.analysis_service.clear_analysis_progress_with_snapshot.assert_called_once_with(
        {"line": 0, "total_line": 5}
    )
    dm.bump_project_runtime_section_revision.assert_called_once_with("analysis")


def test_apply_analysis_reset_failed_payload_uses_analysis_service_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    dm.analysis_service = SimpleNamespace(
        reset_failed_analysis_with_snapshot=MagicMock(
            return_value=(2, {"line": 3, "processed_line": 3, "error_line": 0})
        )
    )
    dm.assert_expected_runtime_revisions = MagicMock()
    dm.bump_project_runtime_section_revision = MagicMock()

    deleted, snapshot = dm.apply_analysis_reset_failed_payload(
        analysis_extras={"line": 3, "processed_line": 3, "error_line": 0},
        expected_section_revisions={"analysis": 4},
    )

    assert deleted == 2
    assert snapshot == {"line": 3, "processed_line": 3, "error_line": 0}
    dm.analysis_service.reset_failed_analysis_with_snapshot.assert_called_once_with(
        {"line": 3, "processed_line": 3, "error_line": 0}
    )
    dm.bump_project_runtime_section_revision.assert_called_once_with("analysis")
