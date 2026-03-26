from collections.abc import Callable
from collections.abc import Generator

import pytest

from api.Application.ProjectAppService import ProjectAppService
from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Server.ServerBootstrap import ServerBootstrap


type ApiService = (
    ProjectAppService
    | ProofreadingAppService
    | QualityRuleAppService
    | SettingsAppService
    | TaskAppService
    | WorkbenchAppService
)

type StartApiServerFactory = Callable[..., str]


@pytest.fixture
def start_api_server() -> Generator[StartApiServerFactory, None, None]:
    runtimes: list[Callable[[], None]] = []

    def factory(**services: ApiService) -> str:
        # 这里按后进先出关闭测试服务，避免后创建的资源泄漏到后续用例。
        base_url, shutdown = ServerBootstrap.start_for_test(**services)
        runtimes.append(shutdown)
        return base_url

    yield factory

    for shutdown in reversed(runtimes):
        shutdown()
