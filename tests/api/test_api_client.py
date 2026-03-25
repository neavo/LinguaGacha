from unittest.mock import Mock
from types import SimpleNamespace

from PySide6.QtWidgets import QApplication

from api.Application.ProjectAppService import ProjectAppService
from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Client.ApiClient import ApiClient
from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Server.ServerBootstrap import ServerBootstrap
from base.Base import Base
from frontend.AppSettingsPage import AppSettingsPage
import frontend.ProjectPage as project_page_module
from frontend.Analysis.AnalysisPage import AnalysisPage
from frontend.ProjectPage import ProjectPage
from frontend.ProjectPage import ProjectInfoPanel
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.ExpertSettingsPage import ExpertSettingsPage
from frontend.Translation.TranslationPage import TranslationPage
from frontend.Workbench.WorkbenchPage import WorkbenchPage
from model.Item import Item
from model.Api.ProjectModels import ProjectPreview
from model.Api.ProjectModels import ProjectSnapshot
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSearchResult
from model.Api.ProofreadingModels import ProofreadingSnapshot
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot
from model.Api.SettingsModels import AppSettingsSnapshot
from model.Api.SettingsModels import RecentProjectEntry
from model.Api.TaskModels import TaskSnapshot
from model.Api.WorkbenchModels import WorkbenchFileEntry
from model.Api.WorkbenchModels import WorkbenchSnapshot
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterOptions
from module.Data.Proofreading.ProofreadingSnapshotService import ProofreadingLoadKind
from module.Data.Proofreading.ProofreadingSnapshotService import ProofreadingLoadResult
from module.ResultChecker import WarningType
from module.Localizer.Localizer import Localizer


def ensure_qt_application() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_project_api_client_load_project_returns_project_snapshot(
    fake_project_manager,
    lg_path: str,
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=project_app_service
    )
    try:
        api_client = ApiClient(base_url)
        project_client = ProjectApiClient(api_client)

        result = project_client.load_project({"path": lg_path})

        assert isinstance(result, ProjectSnapshot)
        assert result.path == lg_path
        assert result.loaded is True
    finally:
        shutdown()


def test_project_api_client_get_project_snapshot_returns_snapshot(
    fake_project_manager,
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=project_app_service
    )
    try:
        api_client = ApiClient(base_url)
        project_client = ProjectApiClient(api_client)

        result = project_client.get_project_snapshot()

        assert isinstance(result, ProjectSnapshot)
        assert result.loaded is False
    finally:
        shutdown()


def test_project_api_client_get_project_preview_returns_preview(
    fake_project_manager,
    lg_path: str,
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=project_app_service
    )
    try:
        api_client = ApiClient(base_url)
        project_client = ProjectApiClient(api_client)

        result = project_client.get_project_preview(lg_path)

        assert isinstance(result, ProjectPreview)
        assert result.path == lg_path
        assert result.source_language == "JA"
        assert result.target_language == "ZH"
        assert result.total_items == 8
        assert result.translated_items == 3
        assert result.progress == 0.375
    finally:
        shutdown()


def test_quality_api_client_returns_object() -> None:
    quality_rule_facade = Mock()
    quality_rule_facade.get_rule_snapshot.return_value = {
        "rule_type": "glossary",
        "revision": 2,
        "meta": {"enabled": True},
        "statistics": {"available": False, "results": {}},
        "entries": [
            {
                "entry_id": "glossary:0",
                "src": "勇者",
                "dst": "Hero",
                "info": "",
                "regex": False,
                "case_sensitive": False,
            }
        ],
    }
    base_url, shutdown = ServerBootstrap.start_for_test(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )
    try:
        api_client = ApiClient(base_url)
        quality_client = QualityRuleApiClient(api_client)

        snapshot = quality_client.get_rule_snapshot("glossary")

        assert isinstance(snapshot, QualityRuleSnapshot)
        assert snapshot.rule_type == "glossary"
        assert snapshot.entries[0].src == "勇者"
    finally:
        shutdown()


def test_quality_api_client_query_proofreading_returns_lookup_object() -> None:
    quality_rule_facade = Mock()
    base_url, shutdown = ServerBootstrap.start_for_test(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )
    try:
        api_client = ApiClient(base_url)
        quality_client = QualityRuleApiClient(api_client)

        query = quality_client.query_proofreading({"src": "^勇者$", "regex": True})

        assert isinstance(query, ProofreadingLookupQuery)
        assert query.keyword == "^勇者$"
        assert query.is_regex is True
    finally:
        shutdown()


def build_proofreading_app_service() -> tuple[
    ProofreadingAppService,
    list[Item],
]:
    """构造最小校对应用服务，方便把 HTTP 协议固定住。"""

    items = [
        Item(
            id=1,
            src="勇者が来た",
            dst="Hero arrived",
            file_path="script/a.txt",
            status=Base.ProjectStatus.PROCESSED,
        ),
        Item(
            id=2,
            src="旁白",
            dst="Narration",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]

    snapshot_result = ProofreadingLoadResult(
        kind=ProofreadingLoadKind.OK,
        lg_path="demo/project.lg",
        revision=7,
        config=SimpleNamespace(),
        items_all=list(items),
        items=list(items),
        warning_map={id(items[0]): [WarningType.GLOSSARY]},
        checker=SimpleNamespace(),
        failed_terms_by_item_key={id(items[0]): (("勇者", "Hero"),)},
        filter_options=ProofreadingFilterOptions(
            warning_types={"GLOSSARY"},
            statuses={Base.ProjectStatus.NONE, Base.ProjectStatus.PROCESSED},
            file_paths={"script/a.txt", "script/b.txt"},
            glossary_terms={("勇者", "Hero")},
        ),
        summary={
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
    )
    refreshed_items = [
        Item(
            id=1,
            src="勇者が来た",
            dst="Heroine arrived refreshed",
            file_path="script/a.txt",
            row=12,
            status=Base.ProjectStatus.PROCESSED,
        ),
        Item(
            id=2,
            src="旁白",
            dst="Narration refreshed",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]
    refreshed_result = ProofreadingLoadResult(
        kind=ProofreadingLoadKind.OK,
        lg_path="demo/project.lg",
        revision=9,
        config=SimpleNamespace(),
        items_all=list(refreshed_items),
        items=list(refreshed_items),
        warning_map={id(refreshed_items[0]): [WarningType.GLOSSARY]},
        checker=SimpleNamespace(),
        failed_terms_by_item_key={id(refreshed_items[0]): (("勇者", "Hero"),)},
        filter_options=ProofreadingFilterOptions(
            warning_types={"GLOSSARY"},
            statuses={Base.ProjectStatus.NONE, Base.ProjectStatus.PROCESSED},
            file_paths={"script/a.txt", "script/b.txt"},
            glossary_terms={("勇者", "Hero")},
        ),
        summary={
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
    )

    snapshot_service = Mock()
    snapshot_service.load_snapshot.side_effect = [snapshot_result, refreshed_result]

    def filter_items(
        items_ref,
        warning_map,
        options,
        checker,
        *,
        failed_terms_by_item_key=None,
        search_keyword="",
        search_is_regex=False,
        search_dst_only=False,
        enable_search_filter=False,
        enable_glossary_term_filter=True,
    ):
        del warning_map, options, checker
        del failed_terms_by_item_key
        del search_is_regex, search_dst_only
        del enable_search_filter, enable_glossary_term_filter
        if search_keyword == "勇者":
            return [items_ref[0]]
        if search_keyword == "旁白":
            return [items_ref[1]]
        return list(items_ref)

    filter_service = Mock()
    filter_service.filter_items.side_effect = filter_items
    filter_service.build_lookup_filter_options.return_value = snapshot_result.filter_options

    def apply_manual_edit(
        item: Item,
        new_dst: str,
        *,
        expected_revision: int | None = None,
    ) -> int:
        del expected_revision
        item.set_dst(new_dst)
        item.set_status(Base.ProjectStatus.PROCESSED)
        return 1

    def replace_all(
        items_ref,
        *,
        search_text: str,
        replace_text: str,
        is_regex: bool = False,
        expected_revision: int | None = None,
    ) -> dict[str, object]:
        del items_ref, search_text, replace_text, is_regex, expected_revision
        return {
            "revision": 8,
            "changed_item_ids": [1],
            "items": [
                {
                    "id": 1,
                    "dst": "Hero arrived again",
                    "status": Base.ProjectStatus.PROCESSED,
                }
            ],
        }

    mutation_service = Mock()
    mutation_service.apply_manual_edit.side_effect = apply_manual_edit
    mutation_service.replace_all.side_effect = replace_all

    def check_item(
        config,
        item: Item,
    ) -> tuple[list[WarningType], tuple[tuple[str, str], ...] | None]:
        del config
        if item.get_id() == 1:
            return [WarningType.GLOSSARY], (("勇者", "Hero"),)
        return [], None

    recheck_service = Mock()
    recheck_service.check_item.side_effect = check_item

    return (
        ProofreadingAppService(
            snapshot_service=snapshot_service,
            filter_service=filter_service,
            mutation_service=mutation_service,
            recheck_service=recheck_service,
        ),
        items,
    )


def test_proofreading_api_client_get_snapshot_returns_snapshot() -> None:
    app_service, _items = build_proofreading_app_service()
    base_url, shutdown = ServerBootstrap.start_for_test(
        proofreading_app_service=app_service
    )
    try:
        api_client = ApiClient(base_url)
        proofreading_client = ProofreadingApiClient(api_client)

        result = proofreading_client.get_snapshot({})

        assert isinstance(result, ProofreadingSnapshot)
        assert result.revision == 7
        assert result.items[0].item_id == 1
    finally:
        shutdown()


def test_proofreading_api_client_filter_items_returns_snapshot() -> None:
    app_service, _items = build_proofreading_app_service()
    base_url, shutdown = ServerBootstrap.start_for_test(
        proofreading_app_service=app_service
    )
    try:
        api_client = ApiClient(base_url)
        proofreading_client = ProofreadingApiClient(api_client)

        result = proofreading_client.filter_items(
            {
                "search_keyword": "旁白",
                "search_is_regex": False,
            }
        )

        assert isinstance(result, ProofreadingSnapshot)
        assert result.items[0].item_id == 2
    finally:
        shutdown()


def test_proofreading_api_client_search_returns_search_result() -> None:
    app_service, _items = build_proofreading_app_service()
    base_url, shutdown = ServerBootstrap.start_for_test(
        proofreading_app_service=app_service
    )
    try:
        api_client = ApiClient(base_url)
        proofreading_client = ProofreadingApiClient(api_client)

        result = proofreading_client.search(
            {
                "keyword": "勇者",
                "is_regex": False,
            }
        )

        assert isinstance(result, ProofreadingSearchResult)
        assert result.keyword == "勇者"
        assert result.matched_item_ids == (1,)
    finally:
        shutdown()


def test_proofreading_api_client_save_item_returns_mutation_result() -> None:
    app_service, _items = build_proofreading_app_service()
    base_url, shutdown = ServerBootstrap.start_for_test(
        proofreading_app_service=app_service
    )
    try:
        api_client = ApiClient(base_url)
        proofreading_client = ProofreadingApiClient(api_client)

        result = proofreading_client.save_item(
            {
                "item": {
                    "id": 1,
                    "dst": "Hero arrived again",
                    "status": Base.ProjectStatus.PROCESSED,
                },
                "new_dst": "Hero arrived again",
                "expected_revision": 7,
            }
        )

        assert isinstance(result, ProofreadingMutationResult)
        assert result.revision >= 0
        assert result.changed_item_ids == (1,)
    finally:
        shutdown()


def test_proofreading_api_client_replace_all_returns_mutation_result() -> None:
    app_service, _items = build_proofreading_app_service()
    base_url, shutdown = ServerBootstrap.start_for_test(
        proofreading_app_service=app_service
    )
    try:
        api_client = ApiClient(base_url)
        proofreading_client = ProofreadingApiClient(api_client)

        result = proofreading_client.replace_all(
            {
                "items": [
                    {
                        "id": 1,
                        "dst": "Hero arrived",
                        "status": Base.ProjectStatus.PROCESSED,
                    }
                ],
                "search_text": "Hero",
                "replace_text": "Heroine",
                "expected_revision": 7,
            }
        )

        assert isinstance(result, ProofreadingMutationResult)
        assert result.revision == 9
        assert result.changed_item_ids == (1,)
        assert result.items[0].dst == "Heroine arrived refreshed"
        assert result.summary.warning_items == 1
    finally:
        shutdown()


def test_proofreading_api_client_recheck_item_returns_mutation_result() -> None:
    app_service, _items = build_proofreading_app_service()
    base_url, shutdown = ServerBootstrap.start_for_test(
        proofreading_app_service=app_service
    )
    try:
        api_client = ApiClient(base_url)
        proofreading_client = ProofreadingApiClient(api_client)

        result = proofreading_client.recheck_item(
            {
                "item": {
                    "id": 1,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "file_path": "script/a.txt",
                    "status": Base.ProjectStatus.PROCESSED,
                }
            }
        )

        assert isinstance(result, ProofreadingMutationResult)
        assert result.changed_item_ids == (1,)
        assert result.items[0].item_id == 1
    finally:
        shutdown()


def test_project_page_uses_project_api_client(
    monkeypatch,
) -> None:
    ensure_qt_application()
    project_client = Mock()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = AppSettingsSnapshot(
        recent_projects=(),
        project_save_mode="MANUAL",
        project_fixed_path="",
    )
    project_client.load_project.return_value = ProjectSnapshot(
        loaded=True, path="demo.lg"
    )
    api_state_store = ApiStateStore()

    original_start = project_page_module.OpenProjectThread.start

    def run_sync(thread_self) -> None:
        thread_self.run()

    monkeypatch.setattr(project_page_module.OpenProjectThread, "start", run_sync)
    try:
        page = ProjectPage(
            "project_page",
            project_client,
            settings_client,
            api_state_store,
        )
        page.selected_lg_path = "demo.lg"

        page.on_open_project()

        settings_client.get_app_settings.assert_called()
        project_client.load_project.assert_called_once_with({"path": "demo.lg"})
        assert api_state_store.is_project_loaded() is True
    finally:
        monkeypatch.setattr(
            project_page_module.OpenProjectThread,
            "start",
            original_start,
        )


def test_project_page_get_recent_projects_projects_entries() -> None:
    ensure_qt_application()
    project_client = Mock()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = AppSettingsSnapshot(
        recent_projects=(
            RecentProjectEntry(path="demo.lg", name="Demo"),
            RecentProjectEntry(path="", name=""),
        )
    )
    api_state_store = ApiStateStore()

    page = ProjectPage(
        "project_page",
        project_client,
        settings_client,
        api_state_store,
    )

    assert page.get_recent_projects() == [
        {"path": "demo.lg", "name": "Demo"},
        {"path": "", "name": ""},
    ]


def test_project_info_panel_accepts_project_preview_object() -> None:
    ensure_qt_application()
    panel = ProjectInfoPanel()

    panel.set_info(
        ProjectPreview.from_dict(
            {
                "file_count": 3,
                "created_at": "2026-03-24T12:00:00",
                "updated_at": "2026-03-24T12:30:00",
                "progress": 0.5,
                "translated_items": 6,
                "total_items": 12,
            }
        )
    )

    assert panel.rows["file_count"].text() == "3"
    caption_texts = {
        widget.text() for widget in panel.findChildren(project_page_module.CaptionLabel)
    }

    assert (
        Localizer.get().project_info_translated.replace("{COUNT}", "6") in caption_texts
    )
    assert Localizer.get().project_info_total.replace("{COUNT}", "12") in caption_texts


def test_task_api_client_get_task_snapshot_supports_requested_task_type(
    fake_task_data_manager,
    fake_engine,
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 6
    fake_task_data_manager.analysis_candidate_count = 3
    base_url, shutdown = ServerBootstrap.start_for_test(
        task_app_service=TaskAppService(
            data_manager=fake_task_data_manager,
            engine=fake_engine,
        )
    )
    try:
        api_client = ApiClient(base_url)
        task_client = TaskApiClient(api_client)

        result = task_client.get_task_snapshot({"task_type": "analysis"})

        assert isinstance(result, TaskSnapshot)
        assert result.task_type == "analysis"
        assert result.analysis_candidate_count == 3
    finally:
        shutdown()


def test_workbench_api_client_get_snapshot_returns_snapshot(
    fake_workbench_manager,
) -> None:
    base_url, shutdown = ServerBootstrap.start_for_test(
        workbench_app_service=WorkbenchAppService(fake_workbench_manager)
    )
    try:
        api_client = ApiClient(base_url)
        workbench_client = WorkbenchApiClient(api_client)

        result = workbench_client.get_snapshot()

        assert isinstance(result, WorkbenchSnapshot)
        assert result.entries[0].rel_path == "script/a.txt"
    finally:
        shutdown()


def test_workbench_page_apply_snapshot_consumes_snapshot_model() -> None:
    ensure_qt_application()
    workbench_client = Mock()
    workbench_client.get_snapshot.return_value = WorkbenchSnapshot()
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )

    page = WorkbenchPage(
        "workbench_page",
        workbench_client,
        api_state_store,
    )

    page.apply_snapshot(
        WorkbenchSnapshot(
            file_count=1,
            total_items=3,
            translated=1,
            translated_in_past=0,
            untranslated=2,
            file_op_running=True,
            entries=(
                WorkbenchFileEntry(
                    rel_path="script/a.txt",
                    item_count=3,
                    file_type="TXT",
                ),
            ),
        )
    )

    assert page.file_entries == [
        {
            "rel_path": "script/a.txt",
            "format": page.get_format_label("TXT", "script/a.txt"),
            "item_count": 3,
        }
    ]


def test_settings_api_client_get_app_settings_returns_snapshot(
    fake_settings_config,
) -> None:
    base_url, shutdown = ServerBootstrap.start_for_test(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    try:
        api_client = ApiClient(base_url)
        settings_client = SettingsApiClient(api_client)

        result = settings_client.get_app_settings()

        assert isinstance(result, AppSettingsSnapshot)
        assert result.request_timeout == 120
        assert result.target_language == "ZH"
    finally:
        shutdown()


def test_settings_api_client_add_recent_project_returns_snapshot(
    fake_settings_config,
) -> None:
    base_url, shutdown = ServerBootstrap.start_for_test(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    try:
        api_client = ApiClient(base_url)
        settings_client = SettingsApiClient(api_client)

        result = settings_client.add_recent_project("demo.lg", "demo")

        assert isinstance(result, AppSettingsSnapshot)
        assert result.recent_projects == (
            RecentProjectEntry(path="demo.lg", name="demo"),
        )
    finally:
        shutdown()


def test_app_settings_page_reads_initial_snapshot_from_settings_api_client() -> None:
    ensure_qt_application()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = AppSettingsSnapshot(
        expert_mode=False,
        proxy_url="",
        proxy_enable=False,
        scale_factor="",
    )

    AppSettingsPage("app_settings_page", settings_client, None)

    settings_client.get_app_settings.assert_called_once_with()


def test_basic_settings_page_uses_api_state_store_busy_state() -> None:
    ensure_qt_application()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = AppSettingsSnapshot(
        source_language="JA",
        target_language="ZH",
        project_save_mode="MANUAL",
        project_fixed_path="",
        output_folder_open_on_finish=False,
        request_timeout=120,
    )
    api_state_store = ApiStateStore()
    api_state_store.hydrate_task(
        TaskSnapshot.from_dict({"task_type": "translation", "busy": True})
    )

    page = BasicSettingsPage(
        "basic_settings_page",
        settings_client,
        api_state_store,
        None,
    )

    assert page.source_language_combo.isEnabled() is False
    assert page.target_language_combo.isEnabled() is False


def test_expert_settings_page_reads_initial_snapshot_from_settings_api_client() -> None:
    ensure_qt_application()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = AppSettingsSnapshot(
        preceding_lines_threshold=0,
        clean_ruby=False,
        deduplication_in_trans=True,
        deduplication_in_bilingual=True,
        check_kana_residue=True,
        check_hangeul_residue=True,
        check_similarity=True,
        write_translated_name_fields_to_file=True,
        auto_process_prefix_suffix_preserved_text=True,
    )

    ExpertSettingsPage("expert_settings_page", settings_client, None)

    settings_client.get_app_settings.assert_called_once_with()


def test_translation_page_uses_task_api_client() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_translation.return_value = TaskSnapshot(
        task_type="translation",
        status="REQUEST",
        busy=True,
    )
    api_state_store = ApiStateStore()

    page = TranslationPage(
        "translation_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_translation()

    task_client.start_translation.assert_called_once_with({"mode": "NEW"})
    assert api_state_store.get_task_snapshot().task_type == "translation"


def test_translation_page_keeps_stop_enabled_during_own_request_state() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_translation.return_value = TaskSnapshot(
        task_type="translation",
        status="REQUEST",
        busy=True,
    )
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )

    page = TranslationPage(
        "translation_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_translation()
    page.update_button_status(Base.Event.PROJECT_UNLOADED, {})

    assert page.action_start.isEnabled() is False
    assert page.action_stop.isEnabled() is True
    assert page.action_reset.isEnabled() is False
    assert page.action_timer.isEnabled() is False


def test_analysis_page_uses_task_api_client() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_analysis.return_value = TaskSnapshot(
        task_type="analysis",
        status="REQUEST",
        busy=True,
    )
    task_client.get_task_snapshot.return_value = TaskSnapshot(
        task_type="analysis",
        status="IDLE",
        busy=False,
        analysis_candidate_count=0,
    )
    api_state_store = ApiStateStore()

    page = AnalysisPage(
        "analysis_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_analysis()

    task_client.start_analysis.assert_called_once_with({"mode": "NEW"})
    assert api_state_store.get_task_snapshot().task_type == "analysis"


def test_analysis_page_keeps_stop_enabled_during_own_request_state() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_analysis.return_value = TaskSnapshot(
        task_type="analysis",
        status="REQUEST",
        busy=True,
    )
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )

    page = AnalysisPage(
        "analysis_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_analysis()
    page.update_button_status(Base.Event.PROJECT_UNLOADED, {})

    assert page.action_start.isEnabled() is False
    assert page.action_stop.isEnabled() is True
    assert page.action_reset.isEnabled() is False
    assert page.action_import.isEnabled() is False


def test_analysis_page_tick_refreshes_buttons_after_stop_done() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.get_task_snapshot.return_value = TaskSnapshot(
        task_type="analysis",
        status="IDLE",
        busy=False,
        analysis_candidate_count=0,
    )
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )
    api_state_store.hydrate_task(
        TaskSnapshot(
            task_type="analysis",
            status="STOPPING",
            busy=True,
            line=3,
            total_line=10,
        )
    )

    page = AnalysisPage(
        "analysis_page",
        None,
        task_client,
        api_state_store,
    )
    page.is_stopping_toast_active = True
    page.update_button_status(Base.Event.PROJECT_UNLOADED, {})

    assert page.action_start.isEnabled() is False
    assert page.action_stop.isEnabled() is False

    api_state_store.hydrate_task(
        TaskSnapshot(
            task_type="analysis",
            status="DONE",
            busy=False,
            line=3,
            total_line=10,
        )
    )

    page.update_ui_tick()

    assert page.action_start.isEnabled() is True
    assert page.action_stop.isEnabled() is False
    assert page.action_reset.isEnabled() is True
    assert page.action_import.isEnabled() is False
    assert page.action_start.text() == Localizer.get().analysis_page_continue
    assert page.is_stopping_toast_active is False


def test_workbench_page_uses_workbench_api_client() -> None:
    ensure_qt_application()
    workbench_client = Mock()
    workbench_client.add_file.return_value = {"accepted": True}
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )

    page = WorkbenchPage(
        "workbench_page",
        workbench_client,
        api_state_store,
    )

    page.request_add_file("script/b.txt")

    workbench_client.add_file.assert_called_once_with("script/b.txt")
