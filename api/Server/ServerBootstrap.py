import threading
from collections.abc import Callable
from dataclasses import dataclass
from http.server import ThreadingHTTPServer

from api.Application.EventStreamService import EventStreamService
from api.Application.CoreLifecycleAppService import CoreLifecycleAppService
from api.Application.ModelAppService import ModelAppService
from api.Application.ProjectAppService import ProjectAppService
from api.Application.ProjectBootstrapAppService import ProjectBootstrapAppService
from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Bridge.ProjectPatchEventBridge import ProjectPatchEventBridge
from api.Server.CoreApiServer import CoreApiServer
from api.Server.CoreApiPortCatalog import CoreApiPortCatalog
from api.Server.Routes.SettingsRoutes import SettingsRoutes
from api.Server.Routes.EventRoutes import EventRoutes
from api.Server.Routes.LifecycleRoutes import LifecycleRoutes
from api.Server.Routes.TaskRoutes import TaskRoutes
from api.Server.Routes.ModelRoutes import ModelRoutes
from api.Server.Routes.QualityRoutes import QualityRoutes
from api.Server.Routes.ProjectRoutes import ProjectRoutes
from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService


class ServerBootstrap:
    """统一维护本地 HTTP 服务的启动与关闭入口。"""

    TEST_DEFAULT_PORTS: tuple[int, ...] = (0,)
    TEST_SERVE_FOREVER_POLL_INTERVAL_SECONDS: float = 0.01

    @dataclass(frozen=True)
    class ServerRuntime:
        """聚合运行期对象，避免启动方自己拼凑散乱返回值。"""

        base_url: str
        shutdown: Callable[[], None]

    @classmethod
    def get_serve_forever_poll_interval(cls, *, as_runtime: bool) -> float:
        """测试服务缩短轮询间隔，避免每次 shutdown 都额外等待 0.5 秒。"""

        if as_runtime:
            return 0.5
        return cls.TEST_SERVE_FOREVER_POLL_INTERVAL_SECONDS

    @classmethod
    def start(
        cls,
        *,
        core_lifecycle_app_service: CoreLifecycleAppService | None = None,
    ) -> ServerRuntime:
        """应用 UI 模式使用的默认启动入口。"""

        project_app_service = ProjectAppService()
        proofreading_app_service = ProofreadingAppService()
        quality_rule_app_service = QualityRuleAppService()
        task_app_service = TaskAppService()
        workbench_app_service = WorkbenchAppService()
        settings_app_service = SettingsAppService()
        model_app_service = ModelAppService()
        project_bootstrap_app_service = ProjectBootstrapAppService(
            ProjectRuntimeService(DataManager.get())
        )
        return cls.start_for_test(
            project_app_service=project_app_service,
            proofreading_app_service=proofreading_app_service,
            quality_rule_app_service=quality_rule_app_service,
            task_app_service=task_app_service,
            workbench_app_service=workbench_app_service,
            settings_app_service=settings_app_service,
            model_app_service=model_app_service,
            project_bootstrap_app_service=project_bootstrap_app_service,
            core_lifecycle_app_service=core_lifecycle_app_service,
            candidate_ports=CoreApiPortCatalog.load_candidates(),
            as_runtime=True,
        )

    @classmethod
    def start_for_test(
        cls,
        *,
        project_app_service: ProjectAppService | None = None,
        proofreading_app_service: ProofreadingAppService | None = None,
        quality_rule_app_service: QualityRuleAppService | None = None,
        task_app_service: TaskAppService | None = None,
        workbench_app_service: WorkbenchAppService | None = None,
        settings_app_service: SettingsAppService | None = None,
        model_app_service: ModelAppService | None = None,
        project_bootstrap_app_service: ProjectBootstrapAppService | None = None,
        core_lifecycle_app_service: CoreLifecycleAppService | None = None,
        candidate_ports: tuple[int, ...] | None = None,
        as_runtime: bool = False,
    ) -> tuple[str, Callable[[], None]] | ServerRuntime:
        """为测试启动独立服务，返回访问地址与关闭函数。"""

        runtime_service = (
            getattr(project_bootstrap_app_service, "runtime_service", None)
            if project_bootstrap_app_service is not None
            else None
        )
        task_snapshot_builder = None
        if task_app_service is not None:
            task_snapshot_builder = getattr(
                task_app_service, "build_task_snapshot", None
            )

        event_stream_service = EventStreamService(
            event_bridge=ProjectPatchEventBridge(
                runtime_service=runtime_service,
                task_snapshot_builder=task_snapshot_builder,
            )
        )
        resolved_candidate_ports = (
            cls.TEST_DEFAULT_PORTS if candidate_ports is None else candidate_ports
        )
        http_server = cls.create_http_server_with_candidates(
            candidate_ports=resolved_candidate_ports,
            project_app_service=project_app_service,
            proofreading_app_service=proofreading_app_service,
            quality_rule_app_service=quality_rule_app_service,
            task_app_service=task_app_service,
            workbench_app_service=workbench_app_service,
            settings_app_service=settings_app_service,
            model_app_service=model_app_service,
            project_bootstrap_app_service=project_bootstrap_app_service,
            core_lifecycle_app_service=core_lifecycle_app_service,
            event_stream_service=event_stream_service,
        )
        serve_forever_poll_interval = cls.get_serve_forever_poll_interval(
            as_runtime=as_runtime
        )

        def serve_http_server() -> None:
            http_server.serve_forever(poll_interval=serve_forever_poll_interval)

        serve_thread = threading.Thread(
            target=serve_http_server,
            daemon=True,
        )
        serve_thread.start()

        host, port = http_server.server_address
        base_url = f"http://{host}:{port}"

        def shutdown() -> None:
            """测试结束时统一关闭监听线程，避免端口泄漏。"""

            event_stream_service.dispose()
            http_server.shutdown()
            http_server.server_close()
            serve_thread.join(timeout=1)

        if as_runtime:
            return cls.ServerRuntime(base_url=base_url, shutdown=shutdown)
        return base_url, shutdown

    @classmethod
    def create_http_server_with_candidates(
        cls,
        *,
        candidate_ports: tuple[int, ...],
        project_app_service: ProjectAppService | None,
        proofreading_app_service: ProofreadingAppService | None,
        quality_rule_app_service: QualityRuleAppService | None,
        task_app_service: TaskAppService | None,
        workbench_app_service: WorkbenchAppService | None,
        settings_app_service: SettingsAppService | None,
        model_app_service: ModelAppService | None,
        project_bootstrap_app_service: ProjectBootstrapAppService | None,
        core_lifecycle_app_service: CoreLifecycleAppService | None,
        event_stream_service: EventStreamService,
    ) -> ThreadingHTTPServer:
        """按候选端口顺序尝试绑定，确保前后端发现顺序一致。"""

        last_error: OSError | None = None
        for port in candidate_ports:
            core_api_server = CoreApiServer(port=port)
            core_api_server.register_routes()
            if settings_app_service is not None:
                SettingsRoutes.register(core_api_server, settings_app_service)
            cls.register_api_routes(
                core_api_server,
                project_app_service=project_app_service,
                workbench_app_service=workbench_app_service,
                proofreading_app_service=proofreading_app_service,
                project_bootstrap_app_service=project_bootstrap_app_service,
                task_app_service=task_app_service,
                model_app_service=model_app_service,
                quality_rule_app_service=quality_rule_app_service,
                core_lifecycle_app_service=core_lifecycle_app_service,
                event_stream_service=event_stream_service,
            )

            try:
                return core_api_server.create_http_server()
            except OSError as e:
                last_error = e

        raise RuntimeError(
            "Core API 候选端口全部被占用，无法启动服务。"
        ) from last_error

    @classmethod
    def register_api_routes(
        cls,
        core_api_server: CoreApiServer,
        *,
        project_app_service: ProjectAppService | None = None,
        workbench_app_service: WorkbenchAppService | None = None,
        proofreading_app_service: ProofreadingAppService | None = None,
        project_bootstrap_app_service: ProjectBootstrapAppService | None = None,
        task_app_service: TaskAppService | None = None,
        model_app_service: ModelAppService | None = None,
        quality_rule_app_service: QualityRuleAppService | None = None,
        core_lifecycle_app_service: CoreLifecycleAppService | None = None,
        event_stream_service: EventStreamService | None = None,
    ) -> None:
        """统一收口 API 路由注册入口，确保服务端只暴露单一版本边界。"""

        del cls
        if core_lifecycle_app_service is not None:
            LifecycleRoutes.register(core_api_server, core_lifecycle_app_service)
        if event_stream_service is not None:
            EventRoutes.register(core_api_server, event_stream_service)
        if (
            project_app_service is not None
            or workbench_app_service is not None
            or proofreading_app_service is not None
            or project_bootstrap_app_service is not None
        ):
            ProjectRoutes.register(
                core_api_server,
                project_app_service,
                workbench_app_service,
                proofreading_app_service,
                project_bootstrap_app_service,
            )
        if task_app_service is not None:
            TaskRoutes.register(core_api_server, task_app_service)
        if model_app_service is not None:
            ModelRoutes.register(core_api_server, model_app_service)
        if quality_rule_app_service is not None:
            QualityRoutes.register(core_api_server, quality_rule_app_service)
