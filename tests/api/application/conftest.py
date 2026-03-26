import pytest

from api.Application.ProjectAppService import ProjectAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from base.Base import Base
from tests.api.support.application_fakes import FakeEngine
from tests.api.support.application_fakes import FakeProjectManager
from tests.api.support.application_fakes import FakeSettingsConfig
from tests.api.support.application_fakes import FakeTaskDataManager
from tests.api.support.application_fakes import FakeWorkbenchManager


@pytest.fixture
def project_app_service(fake_project_manager: FakeProjectManager) -> ProjectAppService:
    return ProjectAppService(fake_project_manager)


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
def workbench_app_service(
    fake_workbench_manager: FakeWorkbenchManager,
) -> WorkbenchAppService:
    return WorkbenchAppService(fake_workbench_manager)


@pytest.fixture
def settings_app_service(
    fake_settings_config: FakeSettingsConfig,
) -> SettingsAppService:
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []

    def capture_emit(event: Base.Event, data: dict[str, object]) -> None:
        emitted_events.append((event, data))

    service = SettingsAppService(
        config_loader=lambda: fake_settings_config,
        event_emitter=capture_emit,
    )
    service.emitted_events = emitted_events
    return service
