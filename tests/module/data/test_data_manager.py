from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock
from unittest.mock import call

import pytest

from base.Base import Base
from module.Data.DataManager import DataManager
from module.Data.Core.DataTypes import ProjectFileMutationResult
from module.Data.Core.DataTypes import ProjectPrefilterScheduleResult
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
    assert emitted_events == []


def test_set_meta_emits_quality_rule_update_for_rule_meta_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.set_meta("glossary_enable", True)

    dm.meta_service.set_meta.assert_called_once_with("glossary_enable", True)
    assert emitted_events == [
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {"meta_keys": ["glossary_enable"], "scope": "global"},
        )
    ]


def test_on_quality_rule_update_does_not_refresh_workbench_for_rule_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.on_quality_rule_update(
        Base.Event.QUALITY_RULE_UPDATE,
        {
            "rule_types": ["glossary"],
            "scope": "entry",
            "rel_paths": ["script/a.txt"],
        },
    )

    assert emitted_events == []


def test_emit_project_item_change_refresh_emits_workbench_and_proofreading_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from module.Data.Core.DataTypes import ProjectItemChange

    dm, emitted_events = build_data_manager(monkeypatch)

    dm.emit_project_item_change_refresh(
        ProjectItemChange(
            item_ids=(1, 2),
            rel_paths=("script/a.txt",),
            reason="translation_batch_update",
        ),
        source_event=Base.Event.TRANSLATION_TASK,
    )

    assert emitted_events == [
        (
            Base.Event.WORKBENCH_REFRESH,
            {
                "reason": "translation_batch_update",
                "scope": "file",
                "rel_paths": ["script/a.txt"],
            },
        ),
        (
            Base.Event.PROOFREADING_REFRESH,
            {
                "reason": "translation_batch_update",
                "scope": "entry",
                "source_event": Base.Event.TRANSLATION_TASK.value,
                "item_ids": [1, 2],
                "rel_paths": ["script/a.txt"],
            },
        ),
    ]


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

    assert dm.meta_service.set_meta.call_args_list == [
        call("source_language", "JA"),
        call("target_language", "EN"),
    ]
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
        token=7,
        emit_refresh_events=True,
    )
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
        Base.Event.WORKBENCH_REFRESH,
        {"reason": "file_op", "scope": "global"},
    ) in emitted_events


def test_project_prefilter_worker_can_skip_page_refresh_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    request = SimpleNamespace(
        reason="file_op",
        lg_path="demo/project.lg",
        token=7,
        emit_refresh_events=False,
    )
    dm.prefilter_service = SimpleNamespace(
        pop_pending_request=MagicMock(side_effect=[request, None]),
        mark_request_handled=MagicMock(),
        finish_worker=MagicMock(),
    )
    dm.apply_project_prefilter_once = MagicMock(return_value=SimpleNamespace())
    dm.log_prefilter_result = MagicMock()

    dm.project_prefilter_worker(token=7)

    assert all(event != Base.Event.WORKBENCH_REFRESH for event, _data in emitted_events)
    assert all(
        event != Base.Event.PROOFREADING_REFRESH for event, _data in emitted_events
    )


def test_emit_project_file_update_emits_single_structured_batch_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.emit_project_file_update(
        ProjectFileMutationResult(
            rel_paths=("script/a.txt", "script/b.txt"),
            removed_rel_paths=("script/old.txt",),
        )
    )

    assert emitted_events == [
        (
            Base.Event.PROJECT_FILE_UPDATE,
            {
                "rel_paths": ["script/a.txt", "script/b.txt"],
                "removed_rel_paths": ["script/old.txt"],
                "order_changed": False,
            },
        ),
        (
            Base.Event.WORKBENCH_REFRESH,
            {
                "reason": "project_file_update",
                "scope": "file",
                "rel_paths": ["script/a.txt", "script/b.txt"],
                "removed_rel_paths": ["script/old.txt"],
            },
        ),
        (
            Base.Event.PROOFREADING_REFRESH,
            {
                "reason": "project_file_update",
                "scope": "file",
                "source_event": Base.Event.PROJECT_FILE_UPDATE.value,
                "rel_paths": ["script/a.txt", "script/b.txt"],
                "removed_rel_paths": ["script/old.txt"],
            },
        ),
    ]


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
            {
                "rule_types": [LGDatabase.RuleType.GLOSSARY.value],
                "scope": "global",
            },
        ),
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {"meta_keys": ["glossary_enable"], "scope": "global"},
        ),
    ]


def test_on_config_updated_defers_proofreading_refresh_when_prefilter_accepts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed_with_result = MagicMock(
        return_value=ProjectPrefilterScheduleResult(needed=True, accepted=True)
    )
    dm.sync_project_language_meta = MagicMock()

    dm.on_config_updated(
        Base.Event.CONFIG_UPDATED,
        {"keys": ["source_language", "unrelated_key"]},
    )

    dm.sync_project_language_meta.assert_called_once_with()
    dm.schedule_prefilter_if_needed_with_result.assert_called_once_with(
        reason="config_updated"
    )
    assert emitted_events == []


def test_on_config_updated_falls_back_to_proofreading_refresh_when_prefilter_not_accepted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed_with_result = MagicMock(
        return_value=ProjectPrefilterScheduleResult(needed=True, accepted=False)
    )
    dm.sync_project_language_meta = MagicMock()

    dm.on_config_updated(
        Base.Event.CONFIG_UPDATED,
        {"keys": ["source_language", "unrelated_key"]},
    )

    dm.sync_project_language_meta.assert_called_once_with()
    dm.schedule_prefilter_if_needed_with_result.assert_called_once_with(
        reason="config_updated"
    )
    assert emitted_events == [
        (
            Base.Event.PROOFREADING_REFRESH,
            {
                "reason": "config_updated",
                "scope": "global",
                "source_event": Base.Event.CONFIG_UPDATED.value,
                "keys": ["source_language", "unrelated_key"],
            },
        )
    ]


@pytest.mark.parametrize(
    ("changed_key"),
    [
        ("check_similarity"),
        ("check_kana_residue"),
        ("check_hangeul_residue"),
    ],
)
def test_on_config_updated_ignores_checker_toggle_keys_for_page_refresh(
    monkeypatch: pytest.MonkeyPatch,
    changed_key: str,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed_with_result = MagicMock()
    dm.sync_project_language_meta = MagicMock()

    dm.on_config_updated(
        Base.Event.CONFIG_UPDATED,
        {"keys": [changed_key]},
    )

    dm.schedule_prefilter_if_needed_with_result.assert_not_called()
    dm.sync_project_language_meta.assert_not_called()
    assert emitted_events == []


def test_on_config_updated_syncs_target_language_without_triggering_page_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed_with_result = MagicMock()
    dm.sync_project_language_meta = MagicMock()

    dm.on_config_updated(
        Base.Event.CONFIG_UPDATED,
        {"keys": ["target_language"]},
    )

    dm.sync_project_language_meta.assert_called_once_with()
    dm.schedule_prefilter_if_needed_with_result.assert_not_called()
    assert emitted_events == []


def test_on_config_updated_ignores_irrelevant_keys_and_unloaded_project(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)
    dm.schedule_prefilter_if_needed_with_result = MagicMock()

    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["ignored_key"]})
    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["app_language"]})
    dm.session.db = None
    dm.on_config_updated(Base.Event.CONFIG_UPDATED, {"keys": ["source_language"]})

    dm.schedule_prefilter_if_needed_with_result.assert_not_called()


def test_emit_project_file_update_also_invalidates_proofreading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)

    dm.emit_project_file_update(
        ProjectFileMutationResult(
            rel_paths=("chapter/a.txt",),
            removed_rel_paths=("chapter/b.txt",),
        )
    )

    assert emitted_events == [
        (
            Base.Event.PROJECT_FILE_UPDATE,
            {
                "rel_paths": ["chapter/a.txt"],
                "removed_rel_paths": ["chapter/b.txt"],
                "order_changed": False,
            },
        ),
        (
            Base.Event.WORKBENCH_REFRESH,
            {
                "reason": "project_file_update",
                "scope": "file",
                "rel_paths": ["chapter/a.txt"],
                "removed_rel_paths": ["chapter/b.txt"],
            },
        ),
        (
            Base.Event.PROOFREADING_REFRESH,
            {
                "reason": "project_file_update",
                "scope": "file",
                "source_event": Base.Event.PROJECT_FILE_UPDATE.value,
                "rel_paths": ["chapter/a.txt"],
                "removed_rel_paths": ["chapter/b.txt"],
            },
        ),
    ]


def test_import_analysis_candidates_emits_precise_quality_rule_update_when_impact_is_known(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.analysis_service.import_analysis_candidates = MagicMock(side_effect=[2, 0, None])
    dm.build_quality_rule_snapshot_payload = MagicMock(
        return_value={"entries": [], "meta": {}}
    )
    dm.analyze_quality_rule_update_impact = MagicMock(
        return_value=SimpleNamespace(
            scope="entry",
            item_ids=(11, 12),
            rel_paths=("script/a.txt",),
        )
    )

    assert dm.import_analysis_candidates() == 2
    assert dm.import_analysis_candidates() == 0
    assert dm.import_analysis_candidates() is None
    assert emitted_events == [
        (
            Base.Event.QUALITY_RULE_UPDATE,
            {
                "rule_types": [LGDatabase.RuleType.GLOSSARY.value],
                "scope": "entry",
                "item_ids": [11, 12],
                "rel_paths": ["script/a.txt"],
            },
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
