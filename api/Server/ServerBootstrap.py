import threading
from collections.abc import Callable
from dataclasses import dataclass
from http.server import ThreadingHTTPServer

from api.Application.EventStreamService import EventStreamService
from api.Application.ExtraAppService import ExtraAppService
from api.Application.ModelAppService import ModelAppService
from api.Application.ProjectAppService import ProjectAppService
from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.V2.ProjectBootstrapAppService import V2ProjectBootstrapAppService
from api.Application.V2.ProjectAppService import V2ProjectAppService
from api.Application.V2.TaskAppService import V2TaskAppService
from api.Application.V2.ModelAppService import V2ModelAppService
from api.Application.V2.QualityRuleAppService import V2QualityRuleAppService
from api.Application.V2.ProjectMutationAppService import V2ProjectMutationAppService
from api.Bridge.V2.EventBridge import V2EventBridge
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Server.CoreApiServer import CoreApiServer
from api.Server.CoreApiPortCatalog import CoreApiPortCatalog
from api.Server.Routes.ExtraRoutes import ExtraRoutes
from api.Server.Routes.SettingsRoutes import SettingsRoutes
from api.Server.Routes.V2.EventRoutes import V2EventRoutes
from api.Server.Routes.V2.TaskRoutes import V2TaskRoutes
from api.Server.Routes.V2.ModelRoutes import V2ModelRoutes
from api.Server.Routes.V2.QualityRoutes import V2QualityRoutes
from api.Server.Routes.V2.ProjectRoutes import V2ProjectRoutes
from module.Data.DataManager import DataManager
from module.Data.Project.V2.MutationService import V2ProjectMutationService
from module.Data.Project.V2.RevisionService import V2ProjectRevisionService
from module.Data.Project.V2.RuntimeService import V2ProjectRuntimeService


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
    def start(cls) -> ServerRuntime:
        """应用 UI 模式使用的默认启动入口。"""

        project_app_service = ProjectAppService()
        proofreading_app_service = ProofreadingAppService()
        quality_rule_app_service = QualityRuleAppService()
        task_app_service = TaskAppService()
        workbench_app_service = WorkbenchAppService()
        settings_app_service = SettingsAppService()
        extra_app_service = ExtraAppService()
        model_app_service = ModelAppService()
        revision_service = V2ProjectRevisionService()
        project_bootstrap_app_service = V2ProjectBootstrapAppService(
            V2ProjectRuntimeService(DataManager.get())
        )
        project_mutation_app_service = V2ProjectMutationAppService(
            V2ProjectMutationService(DataManager.get(), revision_service)
        )
        v2_project_app_service = V2ProjectAppService(project_app_service)
        v2_task_app_service = V2TaskAppService(task_app_service)
        v2_model_app_service = V2ModelAppService(model_app_service)
        v2_quality_rule_app_service = V2QualityRuleAppService(
            quality_rule_app_service
        )
        return cls.start_for_test(
            project_app_service=project_app_service,
            proofreading_app_service=proofreading_app_service,
            quality_rule_app_service=quality_rule_app_service,
            task_app_service=task_app_service,
            workbench_app_service=workbench_app_service,
            settings_app_service=settings_app_service,
            extra_app_service=extra_app_service,
            model_app_service=model_app_service,
            project_bootstrap_app_service=project_bootstrap_app_service,
            project_mutation_app_service=project_mutation_app_service,
            v2_project_app_service=v2_project_app_service,
            v2_task_app_service=v2_task_app_service,
            v2_model_app_service=v2_model_app_service,
            v2_quality_rule_app_service=v2_quality_rule_app_service,
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
        extra_app_service: ExtraAppService | None = None,
        model_app_service: ModelAppService | None = None,
        project_bootstrap_app_service: V2ProjectBootstrapAppService | None = None,
        project_mutation_app_service: V2ProjectMutationAppService | None = None,
        v2_project_app_service: V2ProjectAppService | None = None,
        v2_task_app_service: V2TaskAppService | None = None,
        v2_model_app_service: V2ModelAppService | None = None,
        v2_quality_rule_app_service: V2QualityRuleAppService | None = None,
        candidate_ports: tuple[int, ...] | None = None,
        as_runtime: bool = False,
    ) -> tuple[str, Callable[[], None]] | ServerRuntime:
        """为测试启动独立服务，返回访问地址与关闭函数。"""

        resolved_v2_project_app_service = v2_project_app_service
        if resolved_v2_project_app_service is None and project_app_service is not None:
            resolved_v2_project_app_service = V2ProjectAppService(project_app_service)

        resolved_v2_task_app_service = v2_task_app_service
        if resolved_v2_task_app_service is None and task_app_service is not None:
            resolved_v2_task_app_service = V2TaskAppService(task_app_service)

        resolved_v2_model_app_service = v2_model_app_service
        if resolved_v2_model_app_service is None and model_app_service is not None:
            resolved_v2_model_app_service = V2ModelAppService(model_app_service)

        resolved_v2_quality_rule_app_service = v2_quality_rule_app_service
        if (
            resolved_v2_quality_rule_app_service is None
            and quality_rule_app_service is not None
        ):
            resolved_v2_quality_rule_app_service = V2QualityRuleAppService(
                quality_rule_app_service
            )

        runtime_service = (
            getattr(project_bootstrap_app_service, "runtime_service", None)
            if project_bootstrap_app_service is not None
            else None
        )
        task_snapshot_builder = None
        if task_app_service is not None:
            task_snapshot_builder = getattr(task_app_service, "build_task_snapshot", None)
        elif v2_task_app_service is not None:
            wrapped_task_app_service = getattr(
                v2_task_app_service,
                "task_app_service",
                None,
            )
            task_snapshot_builder = getattr(
                wrapped_task_app_service,
                "build_task_snapshot",
                None,
            )

        v2_event_stream_service = EventStreamService(
            event_bridge=V2EventBridge(
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
            extra_app_service=extra_app_service,
            model_app_service=model_app_service,
            project_bootstrap_app_service=project_bootstrap_app_service,
            project_mutation_app_service=project_mutation_app_service,
            v2_project_app_service=resolved_v2_project_app_service,
            v2_task_app_service=resolved_v2_task_app_service,
            v2_model_app_service=resolved_v2_model_app_service,
            v2_quality_rule_app_service=resolved_v2_quality_rule_app_service,
            v2_event_stream_service=v2_event_stream_service,
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

            v2_event_stream_service.dispose()
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
        extra_app_service: ExtraAppService | None,
        model_app_service: ModelAppService | None,
        project_bootstrap_app_service: V2ProjectBootstrapAppService | None,
        project_mutation_app_service: V2ProjectMutationAppService | None,
        v2_project_app_service: V2ProjectAppService | None,
        v2_task_app_service: V2TaskAppService | None,
        v2_model_app_service: V2ModelAppService | None,
        v2_quality_rule_app_service: V2QualityRuleAppService | None,
        v2_event_stream_service: EventStreamService,
    ) -> ThreadingHTTPServer:
        """按候选端口顺序尝试绑定，确保前后端发现顺序一致。"""

        last_error: OSError | None = None
        for port in candidate_ports:
            core_api_server = CoreApiServer(port=port)
            core_api_server.register_routes()
            if settings_app_service is not None:
                SettingsRoutes.register(core_api_server, settings_app_service)
            if extra_app_service is not None:
                ExtraRoutes.register(core_api_server, extra_app_service)
            cls.register_v2_routes(
                core_api_server,
                v2_project_app_service=v2_project_app_service,
                workbench_app_service=workbench_app_service,
                proofreading_app_service=proofreading_app_service,
                project_bootstrap_app_service=project_bootstrap_app_service,
                project_mutation_app_service=project_mutation_app_service,
                v2_task_app_service=v2_task_app_service,
                v2_model_app_service=v2_model_app_service,
                v2_quality_rule_app_service=v2_quality_rule_app_service,
                v2_event_stream_service=v2_event_stream_service,
            )

            try:
                return core_api_server.create_http_server()
            except OSError as e:
                last_error = e

        raise RuntimeError(
            "Core API 候选端口全部被占用，无法启动服务。"
        ) from last_error

    @classmethod
    def register_v2_routes(
        cls,
        core_api_server: CoreApiServer,
        *,
        v2_project_app_service: V2ProjectAppService | None = None,
        workbench_app_service: WorkbenchAppService | None = None,
        proofreading_app_service: ProofreadingAppService | None = None,
        project_bootstrap_app_service: V2ProjectBootstrapAppService | None = None,
        project_mutation_app_service: V2ProjectMutationAppService | None = None,
        v2_task_app_service: V2TaskAppService | None = None,
        v2_model_app_service: V2ModelAppService | None = None,
        v2_quality_rule_app_service: V2QualityRuleAppService | None = None,
        v2_event_stream_service: EventStreamService | None = None,
    ) -> None:
        """统一收口 V2 路由注册入口，方便迁移期按版本逐组接入。"""

        del cls
        if v2_event_stream_service is not None:
            V2EventRoutes.register(core_api_server, v2_event_stream_service)
        if (
            v2_project_app_service is not None
            or workbench_app_service is not None
            or proofreading_app_service is not None
            or project_bootstrap_app_service is not None
            or project_mutation_app_service is not None
        ):
            V2ProjectRoutes.register(
                core_api_server,
                v2_project_app_service,
                workbench_app_service,
                proofreading_app_service,
                project_bootstrap_app_service,
                project_mutation_app_service,
            )
        if v2_task_app_service is not None:
            V2TaskRoutes.register(core_api_server, v2_task_app_service)
        if v2_model_app_service is not None:
            V2ModelRoutes.register(core_api_server, v2_model_app_service)
        if v2_quality_rule_app_service is not None:
            V2QualityRoutes.register(core_api_server, v2_quality_rule_app_service)
