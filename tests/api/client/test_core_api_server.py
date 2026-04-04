import socket

import httpx
import pytest

from api.Application.SettingsAppService import SettingsAppService
from api.Server.ServerBootstrap import ServerBootstrap


def reserve_tcp_socket() -> socket.socket:
    """预占本地端口，方便验证 Core API 的顺序回退逻辑。"""

    reserved_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    reserved_socket.bind(("127.0.0.1", 0))
    reserved_socket.listen()
    return reserved_socket


def test_health_endpoint_returns_ok() -> None:
    # 准备
    base_url, shutdown = ServerBootstrap.start_for_test()
    try:
        # 执行
        response = httpx.get(f"{base_url}/api/health")

        # 断言
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert response.json()["data"]["status"] == "ok"
        assert response.json()["data"]["service"] == "linguagacha-core"
    finally:
        shutdown()


def test_settings_snapshot_endpoint_returns_ok(fake_settings_config) -> None:
    # 准备
    base_url, shutdown = ServerBootstrap.start_for_test(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    try:
        # 执行
        response = httpx.post(f"{base_url}/api/settings/app")

        # 断言
        assert response.status_code == 200
        assert response.json()["data"]["settings"]["app_language"] == "ZH"
    finally:
        shutdown()


def test_core_api_server_binds_next_candidate_port_when_previous_is_occupied() -> None:
    # 准备
    occupied_socket = reserve_tcp_socket()
    fallback_socket = reserve_tcp_socket()
    occupied_port = int(occupied_socket.getsockname()[1])
    fallback_port = int(fallback_socket.getsockname()[1])
    fallback_socket.close()

    # 执行
    base_url, shutdown = ServerBootstrap.start_for_test(
        candidate_ports=(occupied_port, fallback_port)
    )

    try:
        # 断言
        assert base_url == f"http://127.0.0.1:{fallback_port}"
    finally:
        shutdown()
        occupied_socket.close()


def test_core_api_server_raises_error_when_all_candidate_ports_are_occupied() -> None:
    # 准备
    occupied_sockets = [reserve_tcp_socket() for _ in range(5)]
    occupied_ports = tuple(int(sock.getsockname()[1]) for sock in occupied_sockets)

    try:
        # 执行
        with pytest.raises(RuntimeError, match="候选端口全部被占用"):
            ServerBootstrap.start_for_test(candidate_ports=occupied_ports)
    finally:
        for occupied_socket in occupied_sockets:
            occupied_socket.close()
