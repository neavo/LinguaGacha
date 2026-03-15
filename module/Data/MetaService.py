import copy
from typing import Any

from module.Data.ProjectSession import ProjectSession


class MetaService:
    """工程 meta 访问与缓存。"""

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

    def refresh_cache_from_db(self) -> None:
        """工程加载后调用：一次性加载 meta 强缓存。"""
        with self.session.state_lock:
            db = self.session.db
            self.session.meta_cache = db.get_all_meta() if db is not None else {}

    def get_meta(self, key: str, default: Any = None) -> Any:
        with self.session.state_lock:
            if key in self.session.meta_cache:
                value = self.session.meta_cache.get(key)
                return (
                    copy.deepcopy(value) if isinstance(value, (dict, list)) else value
                )

            db = self.session.db
            if db is None:
                return default

            value = db.get_meta(key, default)
            self.session.meta_cache[key] = value
            return copy.deepcopy(value) if isinstance(value, (dict, list)) else value

    def set_meta(self, key: str, value: Any) -> None:
        with self.session.state_lock:
            db = self.session.db
            if db is not None:
                db.set_meta(key, value)
            self.session.meta_cache[key] = value
