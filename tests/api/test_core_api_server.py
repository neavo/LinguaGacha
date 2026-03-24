import httpx

from api.Server.ServerBootstrap import ServerBootstrap


def test_health_endpoint_returns_ok() -> None:
    base_url, shutdown = ServerBootstrap.start_for_test()
    try:
        response = httpx.get(f"{base_url}/api/health")
        assert response.status_code == 200
        assert response.json()["ok"] is True
    finally:
        shutdown()
