from pathlib import Path

import pytest

from api.Application.ProjectAppService import ProjectAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
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
        self.request_in_flight_count: int = 0
        self.active_task_type: str = ""

    def get_status(self) -> Base.TaskStatus:
        return self.status

    def is_busy(self) -> bool:
        return self.status in (
            Base.TaskStatus.TRANSLATING,
            Base.TaskStatus.ANALYZING,
            Base.TaskStatus.STOPPING,
        )

    def get_request_in_flight_count(self) -> int:
        return self.request_in_flight_count

    def get_active_task_type(self) -> str:
        return self.active_task_type


class FakeTaskDataManager:
    """提供任务快照所需的最小数据桩。"""

    def __init__(self) -> None:
        self.translation_extras = {
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "time": 0.0,
            "start_time": 0.0,
        }
        self.analysis_snapshot = {
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "time": 0.0,
            "start_time": 0.0,
        }
        self.analysis_candidate_count: int = 0

    def get_translation_extras(self) -> dict[str, int | float]:
        return dict(self.translation_extras)

    def get_analysis_progress_snapshot(self) -> dict[str, int | float]:
        return dict(self.analysis_snapshot)

    def get_task_progress_snapshot(self, task_type: str) -> dict[str, int | float]:
        if task_type == "analysis":
            return self.get_analysis_progress_snapshot()
        return self.get_translation_extras()

    def get_analysis_candidate_count(self) -> int:
        return self.analysis_candidate_count


class FakeWorkbenchManager:
    """提供工作台快照与文件操作所需的最小数据桩。"""

    def __init__(self) -> None:
        self.file_op_running: bool = False
        self.supported_extensions: set[str] = {".txt", ".json"}
        self.snapshot = {
            "file_count": 1,
            "total_items": 2,
            "translated": 1,
            "translated_in_past": 0,
            "untranslated": 1,
            "entries": (
                {
                    "rel_path": "script/a.txt",
                    "item_count": 2,
                    "file_type": "TXT",
                },
            ),
        }
        self.add_calls: list[str] = []
        self.replace_calls: list[tuple[str, str]] = []
        self.reset_calls: list[str] = []
        self.delete_calls: list[str] = []

    def build_workbench_snapshot(self):
        from module.Data.Core.DataTypes import WorkbenchFileEntrySnapshot
        from module.Data.Core.DataTypes import WorkbenchSnapshot
        from model.Item import Item

        entry_dict = self.snapshot["entries"][0]
        entry = WorkbenchFileEntrySnapshot(
            rel_path=str(entry_dict["rel_path"]),
            item_count=int(entry_dict["item_count"]),
            file_type=Item.FileType(str(entry_dict["file_type"])),
        )
        return WorkbenchSnapshot(
            file_count=int(self.snapshot["file_count"]),
            total_items=int(self.snapshot["total_items"]),
            translated=int(self.snapshot["translated"]),
            translated_in_past=int(self.snapshot["translated_in_past"]),
            untranslated=int(self.snapshot["untranslated"]),
            entries=(entry,),
        )

    def is_file_op_running(self) -> bool:
        return self.file_op_running

    def get_supported_extensions(self) -> set[str]:
        return set(self.supported_extensions)

    def schedule_add_file(self, path: str) -> None:
        self.add_calls.append(path)

    def schedule_replace_file(self, rel_path: str, path: str) -> None:
        self.replace_calls.append((rel_path, path))

    def schedule_reset_file(self, rel_path: str) -> None:
        self.reset_calls.append(rel_path)

    def schedule_delete_file(self, rel_path: str) -> None:
        self.delete_calls.append(rel_path)


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
def fake_workbench_manager() -> FakeWorkbenchManager:
    return FakeWorkbenchManager()


@pytest.fixture
def workbench_app_service(
    fake_workbench_manager: FakeWorkbenchManager,
) -> WorkbenchAppService:
    return WorkbenchAppService(fake_workbench_manager)


@pytest.fixture
def lg_path(tmp_path: Path) -> str:
    project_path = tmp_path / "demo.lg"
    project_path.write_text("{}", encoding="utf-8")
    return str(project_path)
