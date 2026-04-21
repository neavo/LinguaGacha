import pytest

from api.v2.Application.ProjectAppService import ProjectAppService
from api.v2.Application.SettingsAppService import SettingsAppService
from api.v2.Application.TaskAppService import TaskAppService
from api.v2.Application.WorkbenchAppService import WorkbenchAppService
from base.Base import Base
from tests.api.support.application_fakes import FakeEngine
from tests.api.support.application_fakes import FakeProjectManager
from tests.api.support.application_fakes import FakeSettingsConfig
from tests.api.support.application_fakes import FakeTaskDataManager
from tests.api.support.application_fakes import FakeWorkbenchManager


@pytest.fixture
def fake_project_manager() -> FakeProjectManager:
    return FakeProjectManager()


@pytest.fixture
def fake_task_data_manager() -> FakeTaskDataManager:
    return FakeTaskDataManager()


@pytest.fixture
def fake_engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def fake_workbench_manager() -> FakeWorkbenchManager:
    return FakeWorkbenchManager()


@pytest.fixture
def fake_settings_config() -> FakeSettingsConfig:
    return FakeSettingsConfig()


@pytest.fixture
def project_app_service(
    fake_project_manager: FakeProjectManager,
) -> ProjectAppService:
    return ProjectAppService(fake_project_manager)


@pytest.fixture
def task_app_service(
    fake_task_data_manager: FakeTaskDataManager,
    fake_engine: FakeEngine,
    fake_settings_config: FakeSettingsConfig,
) -> TaskAppService:
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []

    def capture_emit(event: Base.Event, data: dict[str, object]) -> None:
        emitted_events.append((event, data))

    service = TaskAppService(
        data_manager=fake_task_data_manager,
        engine=fake_engine,
        event_emitter=capture_emit,
        config_loader=lambda: fake_settings_config,
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
    applied_localizer_languages: list[object] = []
    applied_model_languages: list[object] = []

    def capture_emit(event: Base.Event, data: dict[str, object]) -> None:
        emitted_events.append((event, data))

    def capture_localizer_language(language: object) -> None:
        applied_localizer_languages.append(language)

    def capture_model_language(language: object) -> None:
        applied_model_languages.append(language)

    service = SettingsAppService(
        config_loader=lambda: fake_settings_config,
        event_emitter=capture_emit,
        localizer_language_setter=capture_localizer_language,
        model_language_setter=capture_model_language,
    )
    service.emitted_events = emitted_events
    service.applied_localizer_languages = applied_localizer_languages
    service.applied_model_languages = applied_model_languages
    return service
