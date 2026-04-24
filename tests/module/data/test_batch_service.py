from typing import Any, cast
from types import SimpleNamespace
import threading

import pytest

from module.Data.Core.BatchService import BatchService
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Core.ProjectSession import ProjectSession


class TrackingRLock:
    """测试里显式追踪当前线程是否持锁，防止缓存在锁外被写脏。"""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.owner_thread_id: int | None = None
        self.depth = 0

    def __enter__(self) -> "TrackingRLock":
        self.lock.acquire()
        if self.depth == 0:
            self.owner_thread_id = threading.get_ident()
        self.depth += 1
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        del exc_type, exc, tb
        self.depth -= 1
        if self.depth == 0:
            self.owner_thread_id = None
        self.lock.release()

    def is_owned_by_current_thread(self) -> bool:
        return self.owner_thread_id == threading.get_ident() and self.depth > 0


class GuardedDict(dict):
    """只有持有工程锁时才允许改写缓存，模拟真实并发约束。"""

    def __init__(self, lock: TrackingRLock, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.lock = lock

    def __setitem__(self, key, value) -> None:
        if not self.lock.is_owned_by_current_thread():
            raise AssertionError("缓存同步必须发生在工程锁内")
        super().__setitem__(key, value)

    def pop(self, key, default=None):
        if not self.lock.is_owned_by_current_thread():
            raise AssertionError("缓存同步必须发生在工程锁内")
        return super().pop(key, default)


class GuardedList(list):
    """条目缓存只允许在持锁状态下改写，避免工程切换时串写。"""

    def __init__(self, lock: TrackingRLock, values: list[dict[str, object]]) -> None:
        super().__init__(values)
        self.lock = lock

    def __setitem__(self, index, value) -> None:
        if not self.lock.is_owned_by_current_thread():
            raise AssertionError("缓存同步必须发生在工程锁内")
        super().__setitem__(index, value)


class RecordingPreparedBatchDb:
    def __init__(self) -> None:
        self.prepared_payload: dict[str, Any] | None = None

    def prepare_item_update_params(
        self,
        items: list[dict[str, Any]] | None,
    ) -> dict[str, list[dict[str, Any]] | None]:
        return {"items": items}

    def prepare_rule_delete_params(
        self,
        rules: dict[LGDatabase.RuleType, Any] | None,
    ) -> dict[str, object]:
        return {"rules": rules, "kind": "delete"}

    def prepare_rule_insert_params(
        self,
        rules: dict[LGDatabase.RuleType, Any] | None,
    ) -> dict[str, object]:
        return {"rules": rules, "kind": "insert"}

    def prepare_meta_upsert_params(
        self,
        meta: dict[str, Any] | None,
    ) -> dict[str, dict[str, Any] | None]:
        return {"meta": meta}

    def update_batch_prepared(self, **payload: Any) -> None:
        self.prepared_payload = payload


class RecordingFallbackBatchDb:
    def __init__(self) -> None:
        self.payload: dict[str, Any] | None = None

    def update_batch(
        self,
        *,
        items: list[dict[str, Any]] | None = None,
        rules: dict[LGDatabase.RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self.payload = {
            "items": items,
            "rules": rules,
            "meta": meta,
        }


def build_service(db: object | None) -> tuple[BatchService, SimpleNamespace]:
    state_lock = TrackingRLock()
    session = SimpleNamespace(
        state_lock=state_lock,
        db=db,
        meta_cache=GuardedDict(state_lock),
        rule_cache=GuardedDict(state_lock),
        rule_text_cache=GuardedDict(
            state_lock, {LGDatabase.RuleType.GLOSSARY: "cached"}
        ),
        item_cache=GuardedList(state_lock, [{"id": 1, "src": "old"}]),
        item_cache_index={1: 0},
    )
    return BatchService(cast(ProjectSession, session)), session


def test_update_batch_raises_when_db_missing() -> None:
    service, _ = build_service(None)

    with pytest.raises(RuntimeError, match="工程未加载"):
        service.update_batch(meta={"k": "v"})


def test_update_batch_syncs_db_and_caches() -> None:
    db = RecordingPreparedBatchDb()
    service, session = build_service(db)
    glossary = [{"src": "HP", "dst": "生命值"}]

    service.update_batch(
        items=[{"id": 1, "src": "new"}, {"id": 2, "src": "skip"}],
        rules={LGDatabase.RuleType.GLOSSARY: glossary},
        meta={"source_language": "JA"},
    )

    assert db.prepared_payload == {
        "item_params": {
            "items": [{"id": 1, "src": "new"}, {"id": 2, "src": "skip"}],
        },
        "rule_delete_params": {
            "rules": {LGDatabase.RuleType.GLOSSARY: glossary},
            "kind": "delete",
        },
        "rule_insert_params": {
            "rules": {LGDatabase.RuleType.GLOSSARY: glossary},
            "kind": "insert",
        },
        "meta_params": {"meta": {"source_language": "JA"}},
    }
    assert session.meta_cache["source_language"] == "JA"
    assert session.rule_cache[LGDatabase.RuleType.GLOSSARY] == glossary
    assert LGDatabase.RuleType.GLOSSARY not in session.rule_text_cache
    assert session.item_cache[0]["src"] == "new"


def test_update_batch_uses_fallback_db_writer_when_prepared_api_is_missing() -> None:
    db = RecordingFallbackBatchDb()
    service, session = build_service(db)
    rules = {LGDatabase.RuleType.GLOSSARY: [{"src": "MP", "dst": "魔力"}]}

    service.update_batch(
        items=[{"id": 1, "src": "fallback"}],
        rules=rules,
        meta={"target_language": "zh-CN"},
    )

    assert db.payload == {
        "items": [{"id": 1, "src": "fallback"}],
        "rules": rules,
        "meta": {"target_language": "zh-CN"},
    }
    assert session.meta_cache["target_language"] == "zh-CN"
    assert (
        session.rule_cache[LGDatabase.RuleType.GLOSSARY]
        == rules[LGDatabase.RuleType.GLOSSARY]
    )
    assert session.item_cache[0]["src"] == "fallback"


def test_update_batch_noop_cache_sync_when_all_payloads_none() -> None:
    db = RecordingPreparedBatchDb()
    service, session = build_service(db)

    service.update_batch()

    assert db.prepared_payload == {
        "item_params": {"items": None},
        "rule_delete_params": {"rules": None, "kind": "delete"},
        "rule_insert_params": {"rules": None, "kind": "insert"},
        "meta_params": {"meta": None},
    }
    assert session.meta_cache == {}
    assert session.rule_cache == {}
    assert session.rule_text_cache[LGDatabase.RuleType.GLOSSARY] == "cached"
    assert session.item_cache[0]["src"] == "old"


def test_update_batch_does_not_touch_item_cache_when_not_loaded() -> None:
    db = RecordingPreparedBatchDb()
    service, session = build_service(db)
    session.item_cache = None

    service.update_batch(items=[{"id": 1, "src": "new"}])

    assert db.prepared_payload is not None
    assert session.item_cache is None


def test_update_batch_skips_item_when_id_is_not_int() -> None:
    db = RecordingPreparedBatchDb()
    service, session = build_service(db)

    service.update_batch(items=[{"id": "1", "src": "new"}])

    assert db.prepared_payload is not None
    assert session.item_cache[0]["src"] == "old"


def test_update_batch_syncs_caches_while_state_lock_is_held() -> None:
    db = RecordingPreparedBatchDb()
    service, session = build_service(db)

    service.update_batch(
        items=[{"id": 1, "src": "locked"}],
        rules={LGDatabase.RuleType.GLOSSARY: [{"src": "HP", "dst": "生命"}]},
        meta={"analysis_candidate_count": 3},
    )

    assert session.meta_cache["analysis_candidate_count"] == 3
    assert session.rule_cache[LGDatabase.RuleType.GLOSSARY] == [
        {"src": "HP", "dst": "生命"}
    ]
    assert session.item_cache[0]["src"] == "locked"
