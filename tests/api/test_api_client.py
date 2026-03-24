from unittest.mock import Mock

from PySide6.QtWidgets import QApplication

from api.Application.ProjectAppService import ProjectAppService
from api.Application.TaskAppService import TaskAppService
from api.Client.ApiClient import ApiClient
from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Server.ServerBootstrap import ServerBootstrap
import frontend.ProjectPage as project_page_module
import frontend.Translation.TranslationPage as translation_page_module
from frontend.Analysis.AnalysisPage import AnalysisPage
from frontend.ProjectPage import ProjectPage
from frontend.Translation.TranslationPage import TranslationPage


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
            api_state_store,
        )
        page.selected_lg_path = "demo.lg"

        page.on_open_project()

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


def test_translation_page_uses_task_api_client(monkeypatch) -> None:
    ensure_qt_application()
    task_client = Mock()
    task_client.start_translation.return_value = {
        "task": {"task_type": "translation", "status": "REQUEST", "busy": True}
    }
    api_state_store = ApiStateStore()

    monkeypatch.setattr(translation_page_module.Config, "load", lambda self: self)
    monkeypatch.setattr(translation_page_module.Config, "save", lambda self: self)

    page = TranslationPage(
        "translation_page",
        None,
        task_client,
        api_state_store,
    )

    page.request_start_translation()

    task_client.start_translation.assert_called_once_with({"mode": "NEW"})
    assert api_state_store.get_task_snapshot()["task_type"] == "translation"


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
