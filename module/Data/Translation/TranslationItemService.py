from typing import Any

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
from module.Data.Core.ProjectSession import ProjectSession


class TranslationItemService:
    # 按翻译模式获取条目列表（继续/新翻译/重置）。

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

            # 解压和构造 Item 放在锁外，避免长时间占用会话状态锁。
            result: list[Item] = []
            for item_dict in items:
                result.append(Item.from_dict(item_dict))

            return result

        if mode == Base.TranslationMode.RESET:
            # 真实全量重置由 TS 同步 mutation 重新解析 asset；旧任务入口只基于当前事实重开翻译。
            result = []
            for item_dict in db.get_all_items():
                item = Item.from_dict(item_dict)
                item.set_dst("")
                item.set_status(Base.ItemStatus.NONE)
                item.set_retry_count(0)
                result.append(item)
            return result

        items: list[dict[str, Any]] = db.get_all_items()
        result: list[Item] = []
        for item_dict in items:
            result.append(Item.from_dict(item_dict))
        return result
