from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from module.Data.BatchService import BatchService
from module.Data.LGDatabase import LGDatabase


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
    return BatchService(session), session


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
