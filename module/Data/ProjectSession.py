from __future__ import annotations

from collections import OrderedDict
import threading
from typing import Any

from module.Data.LGDatabase import LGDatabase


class ProjectSession:
    """当前工程会话（跨 Service 共享的最小状态集合）。"""

    def __init__(self) -> None:
        self.state_lock = threading.RLock()

        # 工程上下文
        self.db: LGDatabase | None = None
        self.lg_path: str | None = None

        # meta 强缓存（工程加载后一次性读取）
        self.meta_cache: dict[str, Any] = {}

        # rules 懒加载缓存
        self.rule_cache: dict[LGDatabase.RuleType, Any] = {}
        self.rule_text_cache: dict[LGDatabase.RuleType, str] = {}

        # items 按需缓存（缓存 dict，避免共享 Item 可变对象）
        self.item_cache: list[dict[str, Any]] | None = None
        self.item_cache_index: dict[int, int] = {}

        # assets 解压缓存（小容量 LRU）
        self.asset_decompress_cache: OrderedDict[str, bytes] = OrderedDict()

    def clear_all_caches(self) -> None:
        with self.state_lock:
            self.meta_cache = {}
            self.rule_cache.clear()
            self.rule_text_cache.clear()
            self.item_cache = None
            self.item_cache_index = {}
            self.asset_decompress_cache.clear()
