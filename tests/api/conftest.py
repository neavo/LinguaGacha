from pathlib import Path

import pytest

from api.Application.ProjectAppService import ProjectAppService


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


@pytest.fixture
def fake_project_manager() -> FakeProjectManager:
    return FakeProjectManager()


@pytest.fixture
def project_app_service(fake_project_manager: FakeProjectManager) -> ProjectAppService:
    return ProjectAppService(fake_project_manager)


@pytest.fixture
def lg_path(tmp_path: Path) -> str:
    project_path = tmp_path / "demo.lg"
    project_path.write_text("{}", encoding="utf-8")
    return str(project_path)
