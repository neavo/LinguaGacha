from typing import Any

from model.Item import Item
from module.Data.ProjectSession import ProjectSession
from module.Utils.GapTool import GapTool


class ItemService:
    """条目（items 表）访问与缓存。"""

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

    def clear_item_cache(self) -> None:
        with self.session.state_lock:
            self.session.item_cache = None
            self.session.item_cache_index = {}

    def load_item_cache_if_needed(self) -> None:
        with self.session.state_lock:
            if self.session.item_cache is not None:
                return
            db = self.session.db

        if db is None:
            items: list[dict[str, Any]] = []
            index: dict[int, int] = {}
        else:
            items = db.get_all_items()
            index = {}
            for idx, item in GapTool.iter(enumerate(items)):
                item_id = item.get("id")
                if isinstance(item_id, int):
                    index[item_id] = idx

        with self.session.state_lock:
            # 可能有其他线程已完成加载
            if self.session.item_cache is not None:
                return
            self.session.item_cache = items
            self.session.item_cache_index = index

    def get_all_items(self) -> list[Item]:
        self.load_item_cache_if_needed()
        with self.session.state_lock:
            cache: list[dict[str, Any]] = list(self.session.item_cache or [])

        # 解锁后构造 Item，避免长时间占用状态锁
        result: list[Item] = []
        for item_dict in GapTool.iter(cache):
            result.append(Item.from_dict(item_dict))
        return result

    def save_item(self, item: Item) -> int:
        item_dict = item.to_dict()

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                raise RuntimeError("工程未加载")

            item_id = db.set_item(item_dict)
            item.set_id(item_id)

            if self.session.item_cache is not None:
                idx = self.session.item_cache_index.get(item_id)
                if idx is None:
                    self.session.item_cache.append(item.to_dict())
                    self.session.item_cache_index[item_id] = (
                        len(self.session.item_cache) - 1
                    )
                else:
                    self.session.item_cache[idx] = item.to_dict()

        return item_id

    def replace_all_items(self, items: list[Item]) -> list[int]:
        items_dict: list[dict[str, Any]] = []
        for item in GapTool.iter(items):
            items_dict.append(item.to_dict())

        with self.session.state_lock:
            db = self.session.db

        if db is None:
            raise RuntimeError("工程未加载")

        ids = db.set_items(items_dict)

        # 同步回写 ID
        for item, item_id in GapTool.iter(zip(items, ids)):
            if isinstance(item_id, int):
                item.set_id(item_id)

        # 刷新缓存（保持与 DB 一致）
        new_cache: list[dict[str, Any]] = []
        for item in GapTool.iter(items):
            new_cache.append(item.to_dict())

        new_index: dict[int, int] = {}
        for idx, item_dict in GapTool.iter(enumerate(new_cache)):
            item_id = item_dict.get("id")
            if isinstance(item_id, int):
                new_index[item_id] = idx

        with self.session.state_lock:
            self.session.item_cache = new_cache
            self.session.item_cache_index = new_index

        return ids

    def update_item_cache_by_dicts(self, items: list[dict[str, Any]]) -> None:
        """在缓存已加载时做增量同步（BatchService 用）。"""
        with self.session.state_lock:
            if not items or self.session.item_cache is None:
                return

            for item in items:
                item_id = item.get("id")
                if not isinstance(item_id, int):
                    continue
                idx = self.session.item_cache_index.get(item_id)
                if idx is None:
                    continue
                self.session.item_cache[idx] = item
