import pytest

from api.Application.TaskAppService import TaskAppService
from base.Base import Base
from tests.api.support.application_fakes import FakeEngine
from tests.api.support.application_fakes import FakeSettingsConfig
from tests.api.support.application_fakes import FakeTaskDataManager


@pytest.fixture
def fake_task_data_manager() -> FakeTaskDataManager:
    return FakeTaskDataManager()


@pytest.fixture
def fake_engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def fake_settings_config() -> FakeSettingsConfig:
    return FakeSettingsConfig()


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
