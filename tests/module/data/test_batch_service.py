from typing import cast
from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

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
    db = MagicMock()
    service, session = build_service(db)

    service.update_batch(
        items=[{"id": 1, "src": "new"}, {"id": 2, "src": "skip"}],
        rules={LGDatabase.RuleType.GLOSSARY: [{"src": "HP", "dst": "生命值"}]},
        meta={"source_language": "JA"},
    )

    db.prepare_item_update_params.assert_called_once()
    db.prepare_rule_delete_params.assert_called_once()
    db.prepare_rule_insert_params.assert_called_once()
    db.prepare_meta_upsert_params.assert_called_once()
    db.update_batch_prepared.assert_called_once()
    assert session.meta_cache["source_language"] == "JA"
    assert session.rule_cache[LGDatabase.RuleType.GLOSSARY] == [
        {"src": "HP", "dst": "生命值"}
    ]
    assert LGDatabase.RuleType.GLOSSARY not in session.rule_text_cache
    assert session.item_cache[0]["src"] == "new"


def test_update_batch_noop_cache_sync_when_all_payloads_none() -> None:
    db = MagicMock()
    service, session = build_service(db)

    service.update_batch()

    db.update_batch_prepared.assert_called_once()
    assert session.meta_cache == {}
    assert session.rule_cache == {}
    assert session.rule_text_cache[LGDatabase.RuleType.GLOSSARY] == "cached"
    assert session.item_cache[0]["src"] == "old"


def test_update_batch_does_not_touch_item_cache_when_not_loaded() -> None:
    db = MagicMock()
    service, session = build_service(db)
    session.item_cache = None

    service.update_batch(items=[{"id": 1, "src": "new"}])

    db.update_batch_prepared.assert_called_once()
    assert session.item_cache is None


def test_update_batch_skips_item_when_id_is_not_int() -> None:
    db = MagicMock()
    service, session = build_service(db)

    service.update_batch(items=[{"id": "1", "src": "new"}])

    db.update_batch_prepared.assert_called_once()
    assert session.item_cache[0]["src"] == "old"


def test_update_batch_syncs_caches_while_state_lock_is_held() -> None:
    db = MagicMock()
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
