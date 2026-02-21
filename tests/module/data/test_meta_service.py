from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

from module.Data.MetaService import MetaService


def build_service(db: object | None) -> tuple[MetaService, SimpleNamespace]:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
        meta_cache={},
    )
    return MetaService(session), session


def test_refresh_cache_from_db_handles_none_and_loads_data() -> None:
    service, session = build_service(None)
    session.meta_cache = {"old": 1}

    service.refresh_cache_from_db()
    assert session.meta_cache == {}

    db = SimpleNamespace(get_all_meta=MagicMock(return_value={"k": "v"}))
    service_with_db, session_with_db = build_service(db)
    service_with_db.refresh_cache_from_db()
    assert session_with_db.meta_cache == {"k": "v"}


def test_get_meta_reads_cache_and_returns_deep_copy_for_mutable() -> None:
    db = SimpleNamespace(get_meta=MagicMock(return_value={"n": [1]}))
    service, session = build_service(db)
    session.meta_cache["cached"] = {"items": ["a"]}

    value = service.get_meta("cached")
    assert value == {"items": ["a"]}
    value["items"].append("b")
    assert session.meta_cache["cached"] == {"items": ["a"]}

    loaded = service.get_meta("missing", {"fallback": True})
    assert loaded == {"n": [1]}
    db.get_meta.assert_called_once_with("missing", {"fallback": True})
    assert session.meta_cache["missing"] == {"n": [1]}


def test_set_meta_updates_db_and_cache() -> None:
    db = SimpleNamespace(set_meta=MagicMock())
    service, session = build_service(db)

    service.set_meta("lang", "zh")

    db.set_meta.assert_called_once_with("lang", "zh")
    assert session.meta_cache["lang"] == "zh"


def test_get_meta_returns_default_when_db_missing_and_cache_miss() -> None:
    service, _ = build_service(None)

    assert service.get_meta("missing", "fallback") == "fallback"


def test_set_meta_updates_cache_when_db_missing() -> None:
    service, session = build_service(None)

    service.set_meta("theme", "light")

    assert session.meta_cache["theme"] == "light"
