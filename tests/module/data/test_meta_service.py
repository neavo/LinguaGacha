from types import SimpleNamespace
import threading
from typing import Any

from module.Data.Core.MetaService import MetaService


class RecordingMetaDb:
    def __init__(self, initial: dict[str, Any] | None = None) -> None:
        self.values = dict(initial or {})

    def get_all_meta(self) -> dict[str, Any]:
        return dict(self.values)

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.values.get(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        self.values[key] = value


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

    db = RecordingMetaDb({"k": "v"})
    service_with_db, session_with_db = build_service(db)
    service_with_db.refresh_cache_from_db()
    assert session_with_db.meta_cache == {"k": "v"}


def test_get_meta_reads_cache_and_returns_deep_copy_for_mutable() -> None:
    db = RecordingMetaDb({"missing": {"n": [1]}})
    service, session = build_service(db)
    session.meta_cache["cached"] = {"items": ["a"]}

    value = service.get_meta("cached")
    assert value == {"items": ["a"]}
    value["items"].append("b")
    assert session.meta_cache["cached"] == {"items": ["a"]}

    loaded = service.get_meta("missing", {"fallback": True})
    assert loaded == {"n": [1]}
    assert session.meta_cache["missing"] == {"n": [1]}


def test_set_meta_updates_db_and_cache() -> None:
    db = RecordingMetaDb()
    service, session = build_service(db)

    service.set_meta("lang", "zh")

    assert db.values["lang"] == "zh"
    assert session.meta_cache["lang"] == "zh"


def test_get_meta_returns_default_when_db_missing_and_cache_miss() -> None:
    service, _ = build_service(None)

    assert service.get_meta("missing", "fallback") == "fallback"


def test_set_meta_updates_cache_when_db_missing() -> None:
    service, session = build_service(None)

    service.set_meta("sample_key", "light")

    assert session.meta_cache["sample_key"] == "light"
