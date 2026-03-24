from unittest.mock import Mock

from PySide6.QtWidgets import QApplication

from api.Application.ProjectAppService import ProjectAppService
from api.Client.ApiStateStore import ApiStateStore
from api.Client.ApiClient import ApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Server.ServerBootstrap import ServerBootstrap
import frontend.ProjectPage as project_page_module
from frontend.ProjectPage import ProjectPage


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
