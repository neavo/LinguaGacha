from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.TranslationItemService import TranslationItemService


def build_service(db: object | None) -> TranslationItemService:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
    )
    return TranslationItemService(session)


def test_get_items_for_translation_returns_cached_items_for_new_and_continue() -> None:
    db = SimpleNamespace(
        get_all_items=MagicMock(return_value=[{"id": 1, "src": "A", "dst": "甲"}])
    )
    service = build_service(db)
    config = Config()

    new_items = service.get_items_for_translation(config, Base.TranslationMode.NEW)
    cont_items = service.get_items_for_translation(
        config, Base.TranslationMode.CONTINUE
    )

    assert [item.get_id() for item in new_items] == [1]
    assert [item.get_id() for item in cont_items] == [1]
    assert db.get_all_items.call_count == 2


def test_get_items_for_translation_reset_reparses_assets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = SimpleNamespace(
        get_all_asset_paths=MagicMock(return_value=["a.txt", "b.txt"]),
        get_asset=MagicMock(side_effect=[b"c1", b"c2"]),
    )
    service = build_service(db)

    class FakeFileManager:
        def __init__(self, config: Config) -> None:
            del config

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            return [Item(src=f"{rel_path}:{content.decode()}")]

    monkeypatch.setattr(
        "module.Data.TranslationItemService.FileManager", FakeFileManager
    )
    monkeypatch.setattr(
        "module.Data.TranslationItemService.ZstdCodec.decompress",
        staticmethod(lambda data: b"decoded-" + data),
    )

    items = service.get_items_for_translation(Config(), Base.TranslationMode.RESET)

    assert [item.get_src() for item in items] == [
        "a.txt:decoded-c1",
        "b.txt:decoded-c2",
    ]


def test_get_items_for_translation_reset_skips_decompress_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = SimpleNamespace(
        get_all_asset_paths=MagicMock(return_value=["a.txt", "b.txt"]),
        get_asset=MagicMock(side_effect=[b"ok", b"bad"]),
    )
    service = build_service(db)

    class FakeFileManager:
        def __init__(self, config: Config) -> None:
            del config

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            return [Item(src=f"{rel_path}:{content.decode()}")]

    monkeypatch.setattr(
        "module.Data.TranslationItemService.FileManager", FakeFileManager
    )

    def fake_decompress(data: bytes) -> bytes:
        if data == b"bad":
            raise RuntimeError("broken")
        return b"decoded-" + data

    monkeypatch.setattr(
        "module.Data.TranslationItemService.ZstdCodec.decompress",
        staticmethod(fake_decompress),
    )
    logger = MagicMock()
    monkeypatch.setattr(
        "module.Data.TranslationItemService.LogManager.get", lambda: logger
    )

    items = service.get_items_for_translation(Config(), Base.TranslationMode.RESET)

    assert [item.get_src() for item in items] == ["a.txt:decoded-ok"]
    assert logger.warning.call_count == 1


def test_get_items_for_translation_returns_empty_when_db_missing() -> None:
    service = build_service(None)

    assert service.get_items_for_translation(Config(), Base.TranslationMode.NEW) == []
