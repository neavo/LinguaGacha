from typing import Any

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.ProjectSession import ProjectSession
from module.Data.ZstdCodec import ZstdCodec
from module.File.FileManager import FileManager
from module.Utils.GapTool import GapTool


class TranslationItemService:
    """按翻译模式获取条目列表（继续/新翻译/重置）。"""

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

    def get_items_for_translation(
        self,
        config: Config,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        with self.session.state_lock:
            db = self.session.db

        if db is None:
            return []

        if mode in (Base.TranslationMode.NEW, Base.TranslationMode.CONTINUE):
            items: list[dict[str, Any]] = db.get_all_items()

            # 分批构造 Item，避免后台线程长时间占用 GIL 导致 UI 掉帧
            result: list[Item] = []
            for item_dict in GapTool.iter(items):
                result.append(Item.from_dict(item_dict))

            return result

        if mode == Base.TranslationMode.RESET:
            file_manager = FileManager(config)
            parsed_items: list[Item] = []

            asset_paths = db.get_all_asset_paths()
            for rel_path in GapTool.iter(asset_paths):
                compressed = db.get_asset(rel_path)
                if not compressed:
                    continue
                try:
                    content = ZstdCodec.decompress(compressed)
                except Exception as e:
                    LogManager.get().warning(
                        f"Failed to decompress asset: {rel_path}", e
                    )
                    continue
                parsed_items.extend(file_manager.parse_asset(rel_path, content))

            return parsed_items

        items: list[dict[str, Any]] = db.get_all_items()
        result: list[Item] = []
        for item_dict in GapTool.iter(items):
            result.append(Item.from_dict(item_dict))
        return result
