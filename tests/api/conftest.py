from pathlib import Path

import pytest

from api.Application.ProjectAppService import ProjectAppService
from api.Application.TaskAppService import TaskAppService
from base.Base import Base


class FakeProjectManager:
    """为 API 用例层测试提供最小工程读写桩。"""

    def __init__(self) -> None:
        self.loaded: bool = False
        self.project_path: str = ""
        self.load_calls: list[str] = []
        self.create_calls: list[tuple[str, str]] = []

    def load_project(self, path: str) -> None:
        self.loaded = True
        self.project_path = path
        self.load_calls.append(path)

    def create_project(self, source_path: str, output_path: str) -> None:
        self.create_calls.append((source_path, output_path))
        self.project_path = output_path

    def unload_project(self) -> None:
        self.loaded = False
        self.project_path = ""

    def is_loaded(self) -> bool:
        return self.loaded

    def get_lg_path(self) -> str:
        return self.project_path

    def get_supported_extensions(self) -> set[str]:
        return {".txt", ".json"}

    def collect_source_files(self, path: str) -> list[str]:
        return [path]

    def get_project_preview(self, path: str) -> dict[str, object]:
        return {
            "name": Path(path).stem,
            "file_count": 1,
            "created_at": "",
            "updated_at": "",
            "progress": 0,
        }


class FakeEngine:
    """任务 API 测试使用的最小引擎桩。"""

    def __init__(self) -> None:
        self.status = Base.TaskStatus.IDLE

    def get_status(self) -> Base.TaskStatus:
        return self.status


class FakeTaskDataManager:
    """提供任务快照所需的最小数据桩。"""

    def __init__(self) -> None:
        self.translation_extras = {
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
        }
        self.analysis_snapshot = {
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
        }

    def get_translation_extras(self) -> dict[str, int]:
        return dict(self.translation_extras)

    def get_analysis_progress_snapshot(self) -> dict[str, int]:
        return dict(self.analysis_snapshot)


@pytest.fixture
def fake_project_manager() -> FakeProjectManager:
    return FakeProjectManager()


@pytest.fixture
def project_app_service(fake_project_manager: FakeProjectManager) -> ProjectAppService:
    return ProjectAppService(fake_project_manager)


@pytest.fixture
def fake_task_data_manager() -> FakeTaskDataManager:
    return FakeTaskDataManager()


@pytest.fixture
def fake_engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def task_app_service(
    fake_task_data_manager: FakeTaskDataManager,
    fake_engine: FakeEngine,
) -> TaskAppService:
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []

    def capture_emit(event: Base.Event, data: dict[str, object]) -> None:
        emitted_events.append((event, data))

    service = TaskAppService(
        data_manager=fake_task_data_manager,
        engine=fake_engine,
        event_emitter=capture_emit,
    )
    service.emitted_events = emitted_events
    return service


@pytest.fixture
def lg_path(tmp_path: Path) -> str:
    project_path = tmp_path / "demo.lg"
    project_path.write_text("{}", encoding="utf-8")
    return str(project_path)
