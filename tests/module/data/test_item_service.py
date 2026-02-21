from typing import cast
from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from model.Item import Item
from module.Data.ItemService import ItemService
from module.Data.ProjectSession import ProjectSession


def build_service(db: object | None) -> tuple[ItemService, SimpleNamespace]:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
        item_cache=None,
        item_cache_index={},
    )
    return ItemService(cast(ProjectSession, session)), session


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


def test_clear_item_cache_resets_cache_and_index() -> None:
    db = SimpleNamespace(get_all_items=MagicMock(return_value=[]))
    service, session = build_service(db)
    session.item_cache = [{"id": 1, "src": "A"}]
    session.item_cache_index = {1: 0}

    service.clear_item_cache()

    assert session.item_cache is None
    assert session.item_cache_index == {}


def test_load_item_cache_if_needed_sets_empty_cache_when_db_none() -> None:
    service, session = build_service(None)

    service.load_item_cache_if_needed()

    assert session.item_cache == []
    assert session.item_cache_index == {}


def test_load_item_cache_if_needed_skips_non_int_ids_in_index() -> None:
    db = SimpleNamespace(
        get_all_items=MagicMock(
            return_value=[
                {"id": "1", "src": "A"},
                {"id": 2, "src": "B"},
                {"src": "no-id"},
            ]
        )
    )
    service, session = build_service(db)

    service.load_item_cache_if_needed()

    assert session.item_cache_index == {2: 1}


def test_load_item_cache_if_needed_does_not_override_when_cache_loaded_by_other_thread() -> (
    None
):
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=None,
        item_cache=None,
        item_cache_index={},
    )

    def side_effect() -> list[dict]:
        session.item_cache = [{"id": 99, "src": "preloaded"}]
        session.item_cache_index = {99: 0}
        return [{"id": 1, "src": "A"}]

    db = SimpleNamespace(get_all_items=MagicMock(side_effect=side_effect))
    session.db = db
    service = ItemService(cast(ProjectSession, session))

    service.load_item_cache_if_needed()

    assert session.item_cache == [{"id": 99, "src": "preloaded"}]
    assert session.item_cache_index == {99: 0}
    db.get_all_items.assert_called_once()


def test_get_all_items_returns_item_instances() -> None:
    db = SimpleNamespace(get_all_items=MagicMock(return_value=[{"id": 1, "src": "A"}]))
    service, _ = build_service(db)

    result = service.get_all_items()

    assert len(result) == 1
    assert isinstance(result[0], Item)
    assert result[0].get_id() == 1


def test_get_all_item_dicts_returns_copy_of_cached_list() -> None:
    db = SimpleNamespace(get_all_items=MagicMock(return_value=[{"id": 1, "src": "A"}]))
    service, session = build_service(db)

    result = service.get_all_item_dicts()
    assert result == [{"id": 1, "src": "A"}]

    result.append({"id": 2, "src": "B"})
    # 返回值是 list 拷贝：不应影响缓存本体。
    assert session.item_cache == [{"id": 1, "src": "A"}]


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


def test_save_item_does_not_touch_cache_when_cache_not_loaded() -> None:
    db = SimpleNamespace(set_item=MagicMock(return_value=5))
    service, session = build_service(db)
    assert session.item_cache is None

    item = Item(src="A")
    item_id = service.save_item(item)

    assert item_id == 5
    assert item.get_id() == 5
    assert session.item_cache is None
    assert session.item_cache_index == {}


def test_replace_all_items_rebuilds_cache_and_updates_ids() -> None:
    db = SimpleNamespace(set_items=MagicMock(return_value=[7, 8]))
    service, session = build_service(db)
    items = [Item(id=7, src="A"), Item(src="B")]

    ids = service.replace_all_items(items)

    assert ids == [7, 8]
    assert items[1].get_id() == 8
    assert session.item_cache_index == {7: 0, 8: 1}


def test_replace_all_items_skips_non_int_ids_when_syncing_back() -> None:
    db = SimpleNamespace(set_items=MagicMock(return_value=[7, "bad-id"]))
    service, session = build_service(db)
    items = [Item(src="A"), Item(src="B")]

    ids = service.replace_all_items(items)

    assert ids == [7, "bad-id"]
    assert items[0].get_id() == 7
    assert items[1].get_id() is None
    assert session.item_cache_index == {7: 0}


def test_replace_all_items_raises_when_project_not_loaded() -> None:
    service, _ = build_service(None)

    with pytest.raises(RuntimeError, match="工程未加载"):
        service.replace_all_items([Item(src="A")])


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


def test_update_item_cache_by_dicts_noop_when_cache_not_loaded() -> None:
    db = SimpleNamespace()
    service, session = build_service(db)
    assert session.item_cache is None

    service.update_item_cache_by_dicts([{"id": 1, "src": "A"}])

    assert session.item_cache is None
