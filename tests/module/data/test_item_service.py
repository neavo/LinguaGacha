from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from model.Item import Item
from module.Data.ItemService import ItemService


def build_service(db: object | None) -> tuple[ItemService, SimpleNamespace]:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
        item_cache=None,
        item_cache_index={},
    )
    return ItemService(session), session


def test_load_item_cache_if_needed_only_loads_once() -> None:
    db = SimpleNamespace(
        get_all_items=MagicMock(
            return_value=[
                {"id": 1, "src": "A", "dst": "甲"},
                {"id": 2, "src": "B", "dst": "乙"},
            ]
        )
    )
    service, session = build_service(db)

    service.load_item_cache_if_needed()
    service.load_item_cache_if_needed()

    assert db.get_all_items.call_count == 1
    assert session.item_cache_index == {1: 0, 2: 1}


def test_get_all_items_returns_item_instances() -> None:
    db = SimpleNamespace(get_all_items=MagicMock(return_value=[{"id": 1, "src": "A"}]))
    service, _ = build_service(db)

    result = service.get_all_items()

    assert len(result) == 1
    assert isinstance(result[0], Item)
    assert result[0].get_id() == 1


def test_save_item_updates_cache_for_insert_and_update() -> None:
    db = SimpleNamespace(set_item=MagicMock(side_effect=[3, 1]))
    service, session = build_service(db)
    session.item_cache = [{"id": 1, "src": "A", "dst": "甲"}]
    session.item_cache_index = {1: 0}

    inserted = Item(src="N", dst="新")
    inserted_id = service.save_item(inserted)
    assert inserted_id == 3
    assert session.item_cache_index[3] == 1

    updated = Item(id=1, src="A2", dst="甲2")
    updated_id = service.save_item(updated)
    assert updated_id == 1
    assert session.item_cache[0]["src"] == "A2"


def test_save_item_raises_when_project_not_loaded() -> None:
    service, _ = build_service(None)

    with pytest.raises(RuntimeError, match="工程未加载"):
        service.save_item(Item(src="A"))


def test_replace_all_items_rebuilds_cache_and_updates_ids() -> None:
    db = SimpleNamespace(set_items=MagicMock(return_value=[7, 8]))
    service, session = build_service(db)
    items = [Item(id=7, src="A"), Item(src="B")]

    ids = service.replace_all_items(items)

    assert ids == [7, 8]
    assert items[1].get_id() == 8
    assert session.item_cache_index == {7: 0, 8: 1}


def test_update_item_cache_by_dicts_updates_loaded_entries_only() -> None:
    db = SimpleNamespace()
    service, session = build_service(db)
    session.item_cache = [
        {"id": 1, "src": "A", "dst": "甲"},
        {"id": 2, "src": "B", "dst": "乙"},
    ]
    session.item_cache_index = {1: 0, 2: 1}

    service.update_item_cache_by_dicts(
        [
            {"id": 2, "src": "B2", "dst": "乙2"},
            {"id": 99, "src": "X"},
            {"src": "no-id"},
        ]
    )

    assert session.item_cache[0]["src"] == "A"
    assert session.item_cache[1]["src"] == "B2"
