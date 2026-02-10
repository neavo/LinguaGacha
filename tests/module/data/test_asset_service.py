from collections import OrderedDict
from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from module.Data.AssetService import AssetService


def build_service(db: object | None) -> tuple[AssetService, SimpleNamespace]:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
        asset_decompress_cache=OrderedDict(),
    )
    return AssetService(session), session


def test_get_asset_and_paths_return_defaults_when_db_missing() -> None:
    service, _ = build_service(None)

    assert service.get_all_asset_paths() == []
    assert service.get_asset("a.txt") is None


def test_get_asset_decompressed_uses_cache_and_lru(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = SimpleNamespace(get_asset=MagicMock(side_effect=[b"a", b"b", b"c"]))
    service, session = build_service(db)

    monkeypatch.setattr("module.Data.AssetService.ASSET_DECOMPRESS_CACHE_MAX", 2)
    monkeypatch.setattr(
        "module.Data.AssetService.ZstdCodec.decompress",
        staticmethod(lambda data: b"dec-" + data),
    )

    assert service.get_asset_decompressed("a") == b"dec-a"
    assert service.get_asset_decompressed("a") == b"dec-a"
    assert db.get_asset.call_count == 1

    assert service.get_asset_decompressed("b") == b"dec-b"
    assert service.get_asset_decompressed("c") == b"dec-c"
    assert list(session.asset_decompress_cache.keys()) == ["b", "c"]


def test_get_asset_decompressed_logs_and_returns_none_on_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = SimpleNamespace(get_asset=MagicMock(return_value=b"broken"))
    service, _ = build_service(db)

    logger = MagicMock()
    monkeypatch.setattr("module.Data.AssetService.LogManager.get", lambda: logger)

    def fail_decompress(data: bytes) -> bytes:
        del data
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "module.Data.AssetService.ZstdCodec.decompress",
        staticmethod(fail_decompress),
    )

    assert service.get_asset_decompressed("broken.bin") is None
    assert logger.error.call_count == 1


def test_clear_decompress_cache() -> None:
    db = SimpleNamespace(get_asset=MagicMock())
    service, session = build_service(db)
    session.asset_decompress_cache["x"] = b"1"

    service.clear_decompress_cache()

    assert session.asset_decompress_cache == OrderedDict()
