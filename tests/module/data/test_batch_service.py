from typing import cast
from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from module.Data.BatchService import BatchService
from module.Data.LGDatabase import LGDatabase
from module.Data.ProjectSession import ProjectSession


def build_service(db: object | None) -> tuple[BatchService, SimpleNamespace]:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
        meta_cache={},
        rule_cache={},
        rule_text_cache={LGDatabase.RuleType.GLOSSARY: "cached"},
        item_cache=[{"id": 1, "src": "old"}],
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

    db.update_batch.assert_called_once()
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

    db.update_batch.assert_called_once_with(items=None, rules=None, meta=None)
    assert session.meta_cache == {}
    assert session.rule_cache == {}
    assert session.rule_text_cache[LGDatabase.RuleType.GLOSSARY] == "cached"
    assert session.item_cache[0]["src"] == "old"


def test_update_batch_does_not_touch_item_cache_when_not_loaded() -> None:
    db = MagicMock()
    service, session = build_service(db)
    session.item_cache = None

    service.update_batch(items=[{"id": 1, "src": "new"}])

    db.update_batch.assert_called_once()
    assert session.item_cache is None


def test_update_batch_skips_item_when_id_is_not_int() -> None:
    db = MagicMock()
    service, session = build_service(db)

    service.update_batch(items=[{"id": "1", "src": "new"}])

    db.update_batch.assert_called_once()
    assert session.item_cache[0]["src"] == "old"
