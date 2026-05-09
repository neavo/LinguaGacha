from typing import cast
from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

from base.Base import Base
from module.Config import Config
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Translation.TranslationItemService import TranslationItemService


def build_service(db: object | None) -> TranslationItemService:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
    )
    return TranslationItemService(cast(ProjectSession, session))


def test_get_items_for_translation_returns_db_items_for_new_and_continue() -> None:
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


def test_get_items_for_translation_reset_reopens_existing_items_without_file_parse() -> (
    None
):
    db = SimpleNamespace(
        get_all_items=MagicMock(
            return_value=[
                {
                    "id": 1,
                    "src": "A",
                    "dst": "甲",
                    "status": "PROCESSED",
                    "retry_count": 3,
                },
                {"id": 2, "src": "B", "dst": "乙", "status": "ERROR", "retry_count": 1},
            ]
        )
    )
    service = build_service(db)

    items = service.get_items_for_translation(Config(), Base.TranslationMode.RESET)

    assert [item.get_src() for item in items] == ["A", "B"]
    assert [item.get_dst() for item in items] == ["", ""]
    assert [item.get_status() for item in items] == [
        Base.ItemStatus.NONE,
        Base.ItemStatus.NONE,
    ]
    assert [item.get_retry_count() for item in items] == [0, 0]


def test_get_items_for_translation_returns_empty_when_db_missing() -> None:
    service = build_service(None)

    assert service.get_items_for_translation(Config(), Base.TranslationMode.NEW) == []


def test_get_items_for_translation_unknown_mode_falls_back_to_all_items() -> None:
    db = SimpleNamespace(
        get_all_items=MagicMock(return_value=[{"id": 1, "src": "A", "dst": "B"}])
    )
    service = build_service(db)

    items = service.get_items_for_translation(Config(), "UNKNOWN")  # type: ignore[arg-type]

    assert [item.get_id() for item in items] == [1]
