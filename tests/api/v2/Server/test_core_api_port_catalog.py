import pytest

from api.v2.Server.CoreApiPortCatalog import CoreApiPortCatalog


def test_load_candidates_优先使用环境变量中的端口(monkeypatch) -> None:
    monkeypatch.setenv(
        CoreApiPortCatalog.CORE_API_BASE_URL_ENV_NAME,
        "http://127.0.0.1:38191",
    )

    assert CoreApiPortCatalog.load_candidates() == (38191,)


def test_load_candidates_环境变量格式错误时抛出异常(monkeypatch) -> None:
    monkeypatch.setenv(
        CoreApiPortCatalog.CORE_API_BASE_URL_ENV_NAME,
        "127.0.0.1",
    )

    with pytest.raises(ValueError, match="完整地址"):
        CoreApiPortCatalog.load_candidates()


def test_load_candidates_未覆盖时回退默认端口(monkeypatch) -> None:
    monkeypatch.delenv(
        CoreApiPortCatalog.CORE_API_BASE_URL_ENV_NAME,
        raising=False,
    )

    assert CoreApiPortCatalog.load_candidates() == (CoreApiPortCatalog.DEFAULT_PORT,)
