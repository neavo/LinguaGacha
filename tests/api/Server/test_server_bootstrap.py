import socket
from types import SimpleNamespace

import httpx
import pytest

from api.Application.CoreLifecycleAppService import CoreLifecycleAppService
from api.Application.ModelProbeAppService import ModelProbeAppService
from api.Application.RuntimeBridgeAppService import RuntimeBridgeAppService
from api.Contract.ApiPaths import ModelApiPaths
from api.Contract.ApiPaths import QualityApiPaths
from api.Contract.ApiPaths import SettingsApiPaths
from api.Server.CoreApiServer import CoreApiServer
from api.Server.ServerBootstrap import ServerBootstrap
from base.Base import Base
from tests.api.support.application_fakes import FakeModelConfig


def reserve_tcp_socket() -> socket.socket:
    """预占本地端口，方便验证服务启动时的候选端口回退。"""

    reserved_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    reserved_socket.bind(("127.0.0.1", 0))
    reserved_socket.listen()
    return reserved_socket


def test_start_for_test_exposes_health_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    monkeypatch.setattr(Base, "APP_VERSION", "9.9.9")
    base_url, shutdown = ServerBootstrap.start_for_test()

    try:
        # Act
        response = httpx.get(f"{base_url}/api/health")

        # Assert
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert response.json()["data"] == {
            "status": "ok",
            "service": "linguagacha-core",
            "version": "9.9.9",
        }
    finally:
        shutdown()


def test_start_for_test_does_not_register_migrated_settings_routes() -> None:
    # Arrange
    base_url, shutdown = ServerBootstrap.start_for_test()

    try:
        # Act
        snapshot_response = httpx.post(f"{base_url}/api/settings/app")
        update_response = httpx.post(
            f"{base_url}/api/settings/update",
            json={"app_language": "JA"},
        )

        # Assert
        assert snapshot_response.status_code == 404
        assert update_response.status_code == 404
    finally:
        shutdown()


def test_start_for_test_registers_lifecycle_shutdown_route() -> None:
    # Arrange
    shutdown_calls: list[str] = []
    base_url, shutdown = ServerBootstrap.start_for_test(
        core_lifecycle_app_service=CoreLifecycleAppService(
            instance_token="core-token",
            request_shutdown=lambda: shutdown_calls.append("shutdown"),
        )
    )

    try:
        # Act
        rejected_response = httpx.post(f"{base_url}/api/lifecycle/shutdown")
        accepted_response = httpx.post(
            f"{base_url}/api/lifecycle/shutdown",
            headers={
                CoreLifecycleAppService.SHUTDOWN_TOKEN_HEADER: "core-token",
            },
        )

        # Assert
        assert rejected_response.status_code == 400
        assert rejected_response.json()["ok"] is False
        assert accepted_response.status_code == 200
        assert accepted_response.json()["data"] == {"accepted": True}
        assert shutdown_calls == ["shutdown"]
    finally:
        shutdown()


def test_register_api_routes_delegates_active_route_groups() -> None:
    # Arrange
    core_api_server = CoreApiServer()

    # Act
    ServerBootstrap.register_api_routes(
        core_api_server,
        event_stream_service=SimpleNamespace(
            stream_to_handler=lambda handler: None,
        ),
        project_app_service=object(),
        workbench_app_service=object(),
        project_bootstrap_app_service=SimpleNamespace(
            stream_to_handler=lambda handler: None,
        ),
        task_app_service=object(),
        model_probe_app_service=object(),
        core_lifecycle_app_service=SimpleNamespace(
            shutdown=lambda request, handler: {"accepted": True},
        ),
        runtime_bridge_app_service=SimpleNamespace(
            get_project_state=lambda request, handler: {"loaded": False},
            sync=lambda request, handler: {"accepted": True},
            parse_project_assets=lambda request, handler: {"files": []},
        ),
    )

    # Assert
    active_route_modes = {
        path: core_api_server.route_map[(method, path)].mode
        for method, path in (
            ("GET", "/api/events/stream"),
            ("GET", "/api/project/bootstrap/stream"),
            ("POST", "/api/project/load"),
            ("POST", "/api/project/workbench/parse-file"),
            ("POST", "/api/tasks/start-translation"),
            ("POST", ModelApiPaths.LIST_AVAILABLE_PATH),
            ("POST", ModelApiPaths.TEST_PATH),
            ("POST", "/api/lifecycle/shutdown"),
            ("POST", "/internal/runtime/project-state"),
            ("POST", "/internal/runtime/parse-project-assets"),
        )
    }

    assert active_route_modes == {
        "/api/events/stream": "stream",
        "/api/project/bootstrap/stream": "stream",
        "/api/project/load": "json",
        "/api/project/workbench/parse-file": "json",
        "/api/tasks/start-translation": "json",
        ModelApiPaths.LIST_AVAILABLE_PATH: "json",
        ModelApiPaths.TEST_PATH: "json",
        "/api/lifecycle/shutdown": "context_json",
        "/internal/runtime/project-state": "context_json",
        "/internal/runtime/parse-project-assets": "context_json",
    }


def test_start_for_test_registers_model_probe_routes() -> None:
    # Arrange
    model_probe_app_service = ModelProbeAppService(
        config_loader=lambda: FakeModelConfig(),
        available_models_loader=lambda model: [str(model["model_id"])],
        api_test_runner=lambda model: {"success": True, "model_id": model["id"]},
    )
    base_url, shutdown = ServerBootstrap.start_for_test(
        model_probe_app_service=model_probe_app_service
    )

    try:
        # Act
        list_response = httpx.post(
            f"{base_url}{ModelApiPaths.LIST_AVAILABLE_PATH}",
            json={"model_id": "preset-1"},
        )
        test_response = httpx.post(
            f"{base_url}{ModelApiPaths.TEST_PATH}",
            json={"model_id": "preset-1"},
        )

        # Assert
        assert list_response.status_code == 200
        assert list_response.json()["data"] == {"models": ["gpt-4.1"]}
        assert test_response.status_code == 200
        assert test_response.json()["data"] == {
            "success": True,
            "model_id": "preset-1",
        }
    finally:
        shutdown()


def test_runtime_bridge_routes_require_explicit_service() -> None:
    # Arrange
    service = RuntimeBridgeAppService(instance_token="core-token")
    service.data_manager = SimpleNamespace(
        is_loaded=lambda: False,
        get_lg_path=lambda: "",
    )
    base_url, shutdown = ServerBootstrap.start_for_test(
        runtime_bridge_app_service=service
    )

    try:
        # Act
        rejected_response = httpx.post(f"{base_url}/internal/runtime/project-state")
        accepted_response = httpx.post(
            f"{base_url}/internal/runtime/project-state",
            headers={RuntimeBridgeAppService.TOKEN_HEADER: "core-token"},
        )

        # Assert
        assert rejected_response.status_code == 400
        assert accepted_response.status_code == 200
        assert accepted_response.json()["data"] == {
            "loaded": False,
            "projectPath": "",
            "busy": False,
        }
    finally:
        shutdown()


def test_start_for_test_binds_next_candidate_port_when_previous_is_occupied() -> None:
    # Arrange
    occupied_socket = reserve_tcp_socket()
    fallback_socket = reserve_tcp_socket()
    occupied_port = int(occupied_socket.getsockname()[1])
    fallback_port = int(fallback_socket.getsockname()[1])
    fallback_socket.close()

    # Act
    base_url, shutdown = ServerBootstrap.start_for_test(
        candidate_ports=(occupied_port, fallback_port)
    )

    try:
        # Assert
        assert base_url == f"http://127.0.0.1:{fallback_port}"
    finally:
        shutdown()
        occupied_socket.close()


def test_start_for_test_raises_when_all_candidate_ports_are_occupied() -> None:
    # Arrange
    occupied_sockets = [reserve_tcp_socket() for _ in range(5)]
    occupied_ports = tuple(int(sock.getsockname()[1]) for sock in occupied_sockets)

    try:
        # Act / Assert
        with pytest.raises(RuntimeError, match="候选端口全部被占用"):
            ServerBootstrap.start_for_test(candidate_ports=occupied_ports)
    finally:
        for occupied_socket in occupied_sockets:
            occupied_socket.close()


class FakeThread:
    """最小线程桩：同步执行 target，方便断言启动和关闭语义。"""

    def __init__(self, *, target, daemon: bool) -> None:
        """初始化 FakeThread 依赖和状态，保持对象写入口明确。"""

        self.target = target
        self.daemon = daemon
        self.started = False
        self.join_timeout: float | None = None

    def start(self) -> None:
        """记录线程启动状态，避免 server bootstrap 测试创建真实线程。"""

        self.started = True
        self.target()

    def join(self, timeout: float | None = None) -> None:
        """记录线程 join 调用，帮助断言关闭流程。"""

        self.join_timeout = timeout


class FakeHttpServer:
    """最小 HTTP 服务桩：记录测试启动时使用的轮询间隔与关闭动作。"""

    def __init__(self) -> None:
        """初始化 FakeHttpServer 依赖和状态，保持对象写入口明确。"""

        self.server_address = ("127.0.0.1", 43210)
        self.poll_interval: float | None = None
        self.shutdown_called = False
        self.server_close_called = False

    def serve_forever(self, poll_interval: float = 0.5) -> None:
        """记录 HTTP server 进入服务循环，避免测试阻塞。"""

        self.poll_interval = poll_interval

    def shutdown(self) -> None:
        """记录 shutdown 调用，验证服务停止链路。"""

        self.shutdown_called = True

    def server_close(self) -> None:
        """记录 server close 调用，验证 socket 释放链路。"""

        self.server_close_called = True


def test_start_for_test_uses_short_poll_interval_in_test_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    fake_http_server = FakeHttpServer()
    fake_threads: list[FakeThread] = []

    monkeypatch.setattr(
        ServerBootstrap,
        "create_http_server_with_candidates",
        classmethod(lambda cls, **kwargs: fake_http_server),
    )
    monkeypatch.setattr(
        "api.Server.ServerBootstrap.threading.Thread",
        lambda *, target, daemon: (
            fake_threads.append(FakeThread(target=target, daemon=daemon))
            or fake_threads[-1]
        ),
    )

    # Act
    base_url, shutdown = ServerBootstrap.start_for_test()
    shutdown()

    # Assert
    assert base_url == "http://127.0.0.1:43210"
    assert fake_http_server.poll_interval == (
        ServerBootstrap.TEST_SERVE_FOREVER_POLL_INTERVAL_SECONDS
    )
    assert fake_threads[0].started is True
    assert fake_threads[0].daemon is True
    assert fake_http_server.shutdown_called is True
    assert fake_http_server.server_close_called is True
    assert fake_threads[0].join_timeout == 1


def test_start_for_test_returns_runtime_object_when_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    fake_http_server = FakeHttpServer()
    fake_threads: list[FakeThread] = []

    monkeypatch.setattr(
        ServerBootstrap,
        "create_http_server_with_candidates",
        classmethod(lambda cls, **kwargs: fake_http_server),
    )
    monkeypatch.setattr(
        "api.Server.ServerBootstrap.threading.Thread",
        lambda *, target, daemon: (
            fake_threads.append(FakeThread(target=target, daemon=daemon))
            or fake_threads[-1]
        ),
    )

    # Act
    runtime = ServerBootstrap.start_for_test(as_runtime=True)
    runtime.shutdown()

    # Assert
    assert isinstance(runtime, ServerBootstrap.ServerRuntime)
    assert runtime.base_url == "http://127.0.0.1:43210"
    assert fake_http_server.poll_interval == 0.5
    assert fake_http_server.shutdown_called is True
    assert fake_http_server.server_close_called is True
    assert fake_threads[0].join_timeout == 1


def test_server_bootstrap_no_longer_registers_legacy_runtime_routes() -> None:
    # Arrange
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=object(),
        task_app_service=SimpleNamespace(
            build_task_snapshot=lambda task_type: {"task_type": task_type}
        ),
        workbench_app_service=object(),
        model_probe_app_service=object(),
        project_bootstrap_app_service=SimpleNamespace(
            runtime_service=None,
            stream_to_handler=lambda handler: None,
        ),
    )
    old_runtime_routes = [
        ("GET", "/api/v2/events/stream"),
        ("POST", "/api/v2/project/load"),
        ("POST", "/api/v2/tasks/snapshot"),
        ("POST", "/api/v2/models/snapshot"),
        ("POST", "/api/workbench/snapshot"),
        ("POST", "/api/proofreading/snapshot"),
        ("POST", SettingsApiPaths.SNAPSHOT_PATH),
        ("POST", SettingsApiPaths.UPDATE_PATH),
        ("POST", ModelApiPaths.SNAPSHOT_PATH),
        ("POST", ModelApiPaths.UPDATE_PATH),
        ("POST", ModelApiPaths.ACTIVATE_PATH),
        ("POST", ModelApiPaths.ADD_PATH),
        ("POST", ModelApiPaths.DELETE_PATH),
        ("POST", ModelApiPaths.RESET_PRESET_PATH),
        ("POST", ModelApiPaths.REORDER_PATH),
        ("POST", QualityApiPaths.SAVE_ENTRIES_PATH),
        ("POST", QualityApiPaths.UPDATE_META_PATH),
        ("POST", QualityApiPaths.PROMPT_SAVE_PATH),
        ("POST", "/api/project/proofreading/save-item"),
        ("POST", "/api/project/proofreading/save-all"),
        ("POST", "/api/project/proofreading/replace-all"),
        ("POST", "/api/project/snapshot"),
        ("POST", "/api/project/unload"),
        ("POST", "/api/project/source-files"),
        ("POST", "/api/project/preview"),
        ("POST", "/api/quality/rules/snapshot"),
        ("POST", "/api/quality/rules/snapshot"),
        ("POST", "/api/quality/rules/query-proofreading"),
        ("POST", "/api/quality/prompts/snapshot"),
    ]

    try:
        # Act / Assert
        with httpx.Client(base_url=base_url) as client:
            for method, path in old_runtime_routes:
                response = client.request(method, path)
                assert response.status_code == 404
    finally:
        shutdown()
