from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import module.Data.DataManager as data_manager_module
from base.Base import Base
from module.Data.DataManager import DataManager
from module.Data.Core.DataTypes import (
    ProjectFileMutationResult,
    ProjectPrefilterScheduleResult,
)
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
        token=7,
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
    assert emitted_events == []


def test_project_prefilter_worker_can_skip_page_refresh_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    request = SimpleNamespace(
        reason="file_op",
        lg_path="demo/project.lg",
        token=7,
    )
    dm.prefilter_service = SimpleNamespace(
        pop_pending_request=MagicMock(side_effect=[request, None]),
        mark_request_handled=MagicMock(),
        finish_worker=MagicMock(),
    )
    dm.apply_project_prefilter_once = MagicMock(return_value=SimpleNamespace())
    dm.log_prefilter_result = MagicMock()

    dm.project_prefilter_worker(token=7)

    assert emitted_events == []


def test_schedule_guarded_file_operation_emits_runtime_refresh_after_finish(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    call_order: list[str] = []

    class ImmediateThread:
        def __init__(self, target, daemon: bool) -> None:
            self.target = target
            self.daemon = daemon

        def start(self) -> None:
            self.target()

    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(
        data_manager_module.LogManager,
        "get",
        lambda: SimpleNamespace(
            info=lambda message: call_order.append(f"log:{message}"),
            warning=lambda message: call_order.append(f"warning:{message}"),
            error=lambda message, error: call_order.append(
                f"error:{message}:{type(error).__name__}"
            ),
        ),
    )
    dm.try_begin_guarded_file_operation = MagicMock()
    dm.run_project_prefilter = MagicMock(
        side_effect=lambda config, reason: call_order.append(f"prefilter:{reason}")
    )
    dm.finish_file_operation = MagicMock(
        side_effect=lambda: call_order.append("finish")
    )

    def mutate_file() -> ProjectFileMutationResult:
        call_order.append("action")
        return ProjectFileMutationResult(rel_paths=("chapter01.txt",))

    dm.schedule_guarded_file_operation(
        "正在添加文件",
        mutate_file,
        "Failed to add file",
    )

    assert call_order == [
        "log:正在添加文件",
        "action",
        "prefilter:file_op",
        "finish",
    ]
    assert emitted_events == [
        (
            Base.Event.PROJECT_RUNTIME_REFRESH,
            {
                "source": "file_op",
                "updatedSections": ["files", "items", "analysis"],
            },
        )
    ]


def test_add_file_runs_guarded_flow_and_emits_runtime_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    call_order: list[str] = []

    monkeypatch.setattr(
        data_manager_module.LogManager,
        "get",
        lambda: SimpleNamespace(
            info=lambda message: call_order.append(f"log:{message}"),
            warning=lambda message: call_order.append(f"warning:{message}"),
            error=lambda message, error: call_order.append(
                f"error:{message}:{type(error).__name__}"
            ),
        ),
    )
    dm.try_begin_guarded_file_operation = MagicMock(
        side_effect=lambda: call_order.append("begin")
    )
    dm.run_project_prefilter = MagicMock(
        side_effect=lambda config, reason: call_order.append(f"prefilter:{reason}")
    )
    dm.finish_file_operation = MagicMock(
        side_effect=lambda: call_order.append("finish")
    )

    def mutate_file(path: str) -> ProjectFileMutationResult:
        call_order.append(f"action:{path}")
        return ProjectFileMutationResult(rel_paths=("chapter01.txt",))

    dm.project_file_service.add_file = MagicMock(side_effect=mutate_file)

    dm.add_file("chapter01.txt")

    assert call_order == [
        "begin",
        f"log:{Localizer.get().workbench_progress_adding_file}",
        "action:chapter01.txt",
        "prefilter:file_op",
        "finish",
    ]
    assert emitted_events == [
        (
            Base.Event.PROJECT_RUNTIME_REFRESH,
            {
                "source": "file_op",
                "updatedSections": ["files", "items", "analysis"],
            },
        )
    ]


def test_add_file_reraises_value_error_without_runtime_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    call_order: list[str] = []

    monkeypatch.setattr(
        data_manager_module.LogManager,
        "get",
        lambda: SimpleNamespace(
            info=lambda message: call_order.append(f"log:{message}"),
            warning=lambda message: call_order.append(f"warning:{message}"),
            error=lambda message, error: call_order.append(
                f"error:{message}:{type(error).__name__}"
            ),
        ),
    )
    dm.try_begin_guarded_file_operation = MagicMock(
        side_effect=lambda: call_order.append("begin")
    )
    dm.run_project_prefilter = MagicMock()
    dm.finish_file_operation = MagicMock(
        side_effect=lambda: call_order.append("finish")
    )
    dm.project_file_service.add_file = MagicMock(side_effect=ValueError("文件已存在 …"))

    with pytest.raises(ValueError, match="文件已存在"):
        dm.add_file("chapter01.txt")

    assert call_order == [
        "begin",
        f"log:{Localizer.get().workbench_progress_adding_file}",
        "warning:文件已存在 …",
        "finish",
    ]
    dm.run_project_prefilter.assert_not_called()
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


def test_on_config_updated_prefilter_rejected_no_longer_emits_legacy_refresh(
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
    assert emitted_events == []


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


def test_import_analysis_candidates_returns_count_without_emitting_legacy_quality_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, emitted_events = build_data_manager(monkeypatch)
    dm.analysis_service.import_analysis_candidates = MagicMock(side_effect=[2, 0, None])

    assert dm.import_analysis_candidates() == 2
    assert dm.import_analysis_candidates() == 0
    assert dm.import_analysis_candidates() is None
    assert emitted_events == []


def test_output_path_helpers_delegate_to_export_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm, _events = build_data_manager(monkeypatch)

    assert dm.get_translated_path() == "/tmp/translated"
    assert dm.get_bilingual_path() == "/tmp/bilingual"
    assert dm.export_custom_suffix_context("x") is not None


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
