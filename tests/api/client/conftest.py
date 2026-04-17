from collections.abc import Callable
from collections.abc import Generator

import pytest

from api.Application.ModelAppService import ModelAppService
from api.Application.ProjectAppService import ProjectAppService
from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Server.ServerBootstrap import ServerBootstrap
from tests.api.support.application_fakes import FakeEngine
from tests.api.support.application_fakes import FakeProjectManager
from tests.api.support.application_fakes import FakeSettingsConfig
from tests.api.support.application_fakes import FakeTaskDataManager
from tests.api.support.application_fakes import FakeWorkbenchManager


type ServiceOverride = (
    ModelAppService
    | ProjectAppService
    | ProofreadingAppService
    | QualityRuleAppService
    | SettingsAppService
    | TaskAppService
    | WorkbenchAppService
)

type StartApiServerFactory = Callable[..., str]


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
def start_api_server() -> Generator[StartApiServerFactory, None, None]:
    runtimes: list[Callable[[], None]] = []

    def factory(**services: ServiceOverride) -> str:
        # 这里按后进先出关闭测试服务，避免后创建的资源泄漏到后续用例。
        base_url, shutdown = ServerBootstrap.start_for_test(**services)
        runtimes.append(shutdown)
        return base_url

    yield factory

    for shutdown in reversed(runtimes):
        shutdown()
