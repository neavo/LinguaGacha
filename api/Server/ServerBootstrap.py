import threading
from collections.abc import Callable
from dataclasses import dataclass
from http.server import ThreadingHTTPServer

from api.Application.EventStreamService import EventStreamService
from api.Application.CoreLifecycleAppService import CoreLifecycleAppService
from api.Application.ModelProbeAppService import ModelProbeAppService
from api.Application.RuntimeBridgeAppService import RuntimeBridgeAppService
from api.Bridge.ProjectPatchEventBridge import ProjectPatchEventBridge
from api.Server.CoreApiServer import CoreApiServer
from api.Server.CoreApiPortCatalog import CoreApiPortCatalog
from api.Server.Routes.EventRoutes import EventRoutes
from api.Server.Routes.LifecycleRoutes import LifecycleRoutes
from api.Server.Routes.ModelProbeRoutes import ModelProbeRoutes
from api.Server.Routes.RuntimeBridgeRoutes import RuntimeBridgeRoutes


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
        runtime_bridge_app_service: RuntimeBridgeAppService | None = None,
    ) -> ServerRuntime:
        """应用 UI 模式使用的默认启动入口。"""

        model_probe_app_service = ModelProbeAppService()
        return cls.start_for_test(
            model_probe_app_service=model_probe_app_service,
            core_lifecycle_app_service=core_lifecycle_app_service,
            runtime_bridge_app_service=runtime_bridge_app_service,
            candidate_ports=CoreApiPortCatalog.load_candidates(),
            as_runtime=True,
        )

    @classmethod
    def start_for_test(
        cls,
        *,
        model_probe_app_service: ModelProbeAppService | None = None,
        core_lifecycle_app_service: CoreLifecycleAppService | None = None,
        runtime_bridge_app_service: RuntimeBridgeAppService | None = None,
        candidate_ports: tuple[int, ...] | None = None,
        as_runtime: bool = False,
    ) -> tuple[str, Callable[[], None]] | ServerRuntime:
        """为测试启动独立服务，返回访问地址与关闭函数。"""

        event_stream_service = EventStreamService(
            event_bridge=ProjectPatchEventBridge()
        )
        resolved_candidate_ports = (
            cls.TEST_DEFAULT_PORTS if candidate_ports is None else candidate_ports
        )
        http_server = cls.create_http_server_with_candidates(
            candidate_ports=resolved_candidate_ports,
            model_probe_app_service=model_probe_app_service,
            core_lifecycle_app_service=core_lifecycle_app_service,
            runtime_bridge_app_service=runtime_bridge_app_service,
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
        model_probe_app_service: ModelProbeAppService | None,
        core_lifecycle_app_service: CoreLifecycleAppService | None,
        runtime_bridge_app_service: RuntimeBridgeAppService | None,
        event_stream_service: EventStreamService,
    ) -> ThreadingHTTPServer:
        """按候选端口顺序尝试绑定，确保前后端发现顺序一致。"""

        last_error: OSError | None = None
        for port in candidate_ports:
            core_api_server = CoreApiServer(port=port)
            core_api_server.register_routes()
            cls.register_api_routes(
                core_api_server,
                model_probe_app_service=model_probe_app_service,
                core_lifecycle_app_service=core_lifecycle_app_service,
                runtime_bridge_app_service=runtime_bridge_app_service,
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
        model_probe_app_service: ModelProbeAppService | None = None,
        core_lifecycle_app_service: CoreLifecycleAppService | None = None,
        runtime_bridge_app_service: RuntimeBridgeAppService | None = None,
        event_stream_service: EventStreamService | None = None,
    ) -> None:
        """统一收口 API 路由注册入口，确保服务端只暴露单一版本边界。"""

        del cls
        if core_lifecycle_app_service is not None:
            LifecycleRoutes.register(core_api_server, core_lifecycle_app_service)
        if runtime_bridge_app_service is not None:
            RuntimeBridgeRoutes.register(core_api_server, runtime_bridge_app_service)
        if event_stream_service is not None:
            EventRoutes.register(core_api_server, event_stream_service)
        if model_probe_app_service is not None:
            ModelProbeRoutes.register(core_api_server, model_probe_app_service)
