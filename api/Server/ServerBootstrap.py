import threading
from collections.abc import Callable
from dataclasses import dataclass

from api.Application.EventStreamService import EventStreamService
from api.Application.ProjectAppService import ProjectAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Server.CoreApiServer import CoreApiServer
from api.Server.Routes.EventRoutes import EventRoutes
from api.Server.Routes.ProjectRoutes import ProjectRoutes
from api.Server.Routes.QualityRoutes import QualityRoutes
from api.Server.Routes.SettingsRoutes import SettingsRoutes
from api.Server.Routes.TaskRoutes import TaskRoutes
from api.Server.Routes.WorkbenchRoutes import WorkbenchRoutes


class ServerBootstrap:
    """统一维护本地 HTTP 服务的启动与关闭入口。"""

    @dataclass(frozen=True)
    class ServerRuntime:
        """聚合运行期对象，避免启动方自己拼凑散乱返回值。"""

        base_url: str
        shutdown: Callable[[], None]

    @classmethod
    def start(cls) -> ServerRuntime:
        """应用 UI 模式使用的默认启动入口。"""

        project_app_service = ProjectAppService()
        quality_rule_app_service = QualityRuleAppService()
        task_app_service = TaskAppService()
        workbench_app_service = WorkbenchAppService()
        settings_app_service = SettingsAppService()
        return cls.start_for_test(
            project_app_service=project_app_service,
            quality_rule_app_service=quality_rule_app_service,
            task_app_service=task_app_service,
            workbench_app_service=workbench_app_service,
            settings_app_service=settings_app_service,
            as_runtime=True,
        )

    @classmethod
    def start_for_test(
        cls,
        *,
        project_app_service: ProjectAppService | None = None,
        quality_rule_app_service: QualityRuleAppService | None = None,
        task_app_service: TaskAppService | None = None,
        workbench_app_service: WorkbenchAppService | None = None,
        settings_app_service: SettingsAppService | None = None,
        as_runtime: bool = False,
    ) -> tuple[str, Callable[[], None]] | ServerRuntime:
        """为测试启动独立服务，返回访问地址与关闭函数。"""

        core_api_server = CoreApiServer()
        event_stream_service = EventStreamService()
        core_api_server.register_routes()
        EventRoutes.register(core_api_server, event_stream_service)
        if project_app_service is not None:
            ProjectRoutes.register(core_api_server, project_app_service)
        if quality_rule_app_service is not None:
            QualityRoutes.register(core_api_server, quality_rule_app_service)
        if task_app_service is not None:
            TaskRoutes.register(core_api_server, task_app_service)
        if workbench_app_service is not None:
            WorkbenchRoutes.register(core_api_server, workbench_app_service)
        if settings_app_service is not None:
            SettingsRoutes.register(core_api_server, settings_app_service)
        http_server = core_api_server.create_http_server()
        serve_thread = threading.Thread(
            target=http_server.serve_forever,
            daemon=True,
        )
        serve_thread.start()

        host, port = http_server.server_address
        base_url = f"http://{host}:{port}"

        def shutdown() -> None:
            """测试结束时统一关闭监听线程，避免端口泄漏。"""

            http_server.shutdown()
            http_server.server_close()
            serve_thread.join(timeout=1)

        if as_runtime:
            return cls.ServerRuntime(base_url=base_url, shutdown=shutdown)
        return base_url, shutdown
