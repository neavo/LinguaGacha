import time

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.ProjectSession import ProjectSession
from module.Data.ZstdCodec import ZstdCodec
from module.File.FileManager import FileManager


class TranslationItemService:
    """按翻译模式获取条目列表（继续/新翻译/重置）。"""

    YIELD_EVERY = 64

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

        if mode in (Base.TranslationMode.CONTINUE, Base.TranslationMode.NEW):
            with self.session.state_lock:
                db = self.session.db
                if db is None:
                    return []
                return [Item.from_dict(d) for d in db.get_all_items()]

        if mode == Base.TranslationMode.RESET:
            file_manager = FileManager(config)
            items: list[Item] = []

            with self.session.state_lock:
                db = self.session.db
                if db is None:
                    return []
                asset_paths = db.get_all_asset_paths()

            parsed_assets = 0
            for rel_path in asset_paths:
                with self.session.state_lock:
                    db = self.session.db
                    if db is None:
                        return []
                    compressed = db.get_asset(rel_path)

                if not compressed:
                    continue

                try:
                    content = ZstdCodec.decompress(compressed)
                except Exception:
                    continue

                items.extend(file_manager.parse_asset(rel_path, content))
                parsed_assets += 1
                if self.YIELD_EVERY > 0 and parsed_assets % self.YIELD_EVERY == 0:
                    time.sleep(0)

            return items

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return []
            return [Item.from_dict(d) for d in db.get_all_items()]
