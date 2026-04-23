from collections import OrderedDict
from typing import Any

from base.LogManager import LogManager
from module.Data.Core.ProjectSession import ProjectSession
from module.Utils.ZstdTool import ZstdTool


class AssetService:
    """资产（assets 表）访问与解压缓存。"""

    # 限制缓存容量，避免大量大文件常驻内存。
    ASSET_DECOMPRESS_CACHE_MAX: int = 32

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

    def clear_decompress_cache(self) -> None:
        with self.session.state_lock:
            self.session.asset_decompress_cache.clear()

    def get_all_asset_paths(self) -> list[str]:
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return []
            return db.get_all_asset_paths()

    def get_all_asset_records(self) -> list[dict[str, Any]]:
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return []
            return db.get_all_asset_records()

    def get_asset(self, rel_path: str) -> bytes | None:
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return None
            return db.get_asset(rel_path)

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        with self.session.state_lock:
            cached = self.session.asset_decompress_cache.get(rel_path)
            if isinstance(cached, bytes):
                data = self.session.asset_decompress_cache.pop(rel_path)
                self.session.asset_decompress_cache[rel_path] = data
                return data

        compressed = self.get_asset(rel_path)
        if compressed is None:
            return None

        try:
            decompressed = ZstdTool.decompress(compressed)
        except Exception as e:
            LogManager.get().error(f"解压资产失败: {rel_path}", e)
            return None

        with self.session.state_lock:
            cache: OrderedDict[str, bytes] = self.session.asset_decompress_cache
            cache[rel_path] = decompressed
            while len(cache) > self.ASSET_DECOMPRESS_CACHE_MAX:
                cache.popitem(last=False)

        return decompressed
