from unittest.mock import Mock

from PySide6.QtWidgets import QApplication

from api.Application.ProjectAppService import ProjectAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Client.ApiClient import ApiClient
from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Server.ServerBootstrap import ServerBootstrap
from base.Base import Base
from frontend.AppSettingsPage import AppSettingsPage
import frontend.ProjectPage as project_page_module
from frontend.Analysis.AnalysisPage import AnalysisPage
from frontend.ProjectPage import ProjectPage
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.ExpertSettingsPage import ExpertSettingsPage
from frontend.Translation.TranslationPage import TranslationPage
from frontend.Workbench.WorkbenchPage import WorkbenchPage


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

        assert result["project"]["path"] == lg_path
        assert result["project"]["loaded"] is True
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

        assert result["project"]["loaded"] is False
    finally:
        shutdown()


def test_project_page_uses_project_api_client(
    monkeypatch,
) -> None:
    ensure_qt_application()
    project_client = Mock()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = {
        "settings": {
            "recent_projects": [],
            "project_save_mode": "MANUAL",
            "project_fixed_path": "",
        }
    }
    project_client.load_project.return_value = {
        "project": {"loaded": True, "path": "demo.lg"}
    }
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

        assert result["task"]["task_type"] == "analysis"
        assert result["task"]["analysis_candidate_count"] == 3
    finally:
        shutdown()


def test_workbench_api_client_get_snapshot_returns_serializable_snapshot(
    fake_workbench_manager,
) -> None:
    base_url, shutdown = ServerBootstrap.start_for_test(
        workbench_app_service=WorkbenchAppService(fake_workbench_manager)
    )
    try:
        api_client = ApiClient(base_url)
        workbench_client = WorkbenchApiClient(api_client)

        result = workbench_client.get_snapshot()

        assert result["snapshot"]["entries"][0]["rel_path"] == "script/a.txt"
    finally:
        shutdown()


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

        assert result["settings"]["request_timeout"] == 120
        assert result["settings"]["target_language"] == "ZH"
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

        assert result["settings"]["recent_projects"] == [
            {"path": "demo.lg", "name": "demo"}
        ]
    finally:
        shutdown()


def test_app_settings_page_reads_initial_snapshot_from_settings_api_client() -> None:
    ensure_qt_application()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = {
        "settings": {
            "expert_mode": False,
            "proxy_url": "",
            "proxy_enable": False,
            "scale_factor": "",
        }
    }

    AppSettingsPage("app_settings_page", settings_client, None)

    settings_client.get_app_settings.assert_called_once_with()


def test_basic_settings_page_uses_api_state_store_busy_state() -> None:
    ensure_qt_application()
    settings_client = Mock()
    settings_client.get_app_settings.return_value = {
        "settings": {
            "source_language": "JA",
            "target_language": "ZH",
            "project_save_mode": "MANUAL",
            "project_fixed_path": "",
            "output_folder_open_on_finish": False,
            "request_timeout": 120,
        }
    }
    api_state_store = ApiStateStore()
    api_state_store.hydrate_task({"task_type": "translation", "busy": True})

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
    settings_client.get_app_settings.return_value = {
        "settings": {
            "preceding_lines_threshold": 0,
            "clean_ruby": False,
            "deduplication_in_trans": True,
            "deduplication_in_bilingual": True,
            "check_kana_residue": True,
            "check_hangeul_residue": True,
            "check_similarity": True,
            "write_translated_name_fields_to_file": True,
            "auto_process_prefix_suffix_preserved_text": True,
        }
    }

    ExpertSettingsPage("expert_settings_page", settings_client, None)

    settings_client.get_app_settings.assert_called_once_with()


def test_translation_page_uses_task_api_client() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_translation.return_value = {
        "task": {"task_type": "translation", "status": "REQUEST", "busy": True}
    }
    api_state_store = ApiStateStore()

    page = TranslationPage(
        "translation_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_translation()

    task_client.start_translation.assert_called_once_with({"mode": "NEW"})
    assert api_state_store.get_task_snapshot()["task_type"] == "translation"


def test_translation_page_keeps_stop_enabled_during_own_request_state() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_translation.return_value = {
        "task": {"task_type": "translation", "status": "REQUEST", "busy": True}
    }
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project({"loaded": True, "path": "demo.lg"})

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
    task_client.start_analysis.return_value = {
        "task": {"task_type": "analysis", "status": "REQUEST", "busy": True}
    }
    task_client.get_task_snapshot.return_value = {
        "task": {
            "task_type": "analysis",
            "status": "IDLE",
            "busy": False,
            "analysis_candidate_count": 0,
        }
    }
    api_state_store = ApiStateStore()

    page = AnalysisPage(
        "analysis_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_analysis()

    task_client.start_analysis.assert_called_once_with({"mode": "NEW"})
    assert api_state_store.get_task_snapshot()["task_type"] == "analysis"


def test_analysis_page_keeps_stop_enabled_during_own_request_state() -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_analysis.return_value = {
        "task": {"task_type": "analysis", "status": "REQUEST", "busy": True}
    }
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project({"loaded": True, "path": "demo.lg"})

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


def test_workbench_page_uses_workbench_api_client() -> None:
    ensure_qt_application()
    workbench_client = Mock()
    workbench_client.add_file.return_value = {"accepted": True}
    api_state_store = ApiStateStore()
    api_state_store.hydrate_project({"loaded": True, "path": "demo.lg"})

    page = WorkbenchPage(
        "workbench_page",
        workbench_client,
        api_state_store,
    )

    page.request_add_file("script/b.txt")

    workbench_client.add_file.assert_called_once_with("script/b.txt")
