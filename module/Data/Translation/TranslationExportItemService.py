from base.Base import Base
from module.Data.Core.Item import Item


class TranslationExportItemService:
    """导出前的条目副本与临时补齐逻辑。"""

    @classmethod
    def clone_items(cls, items: list[Item]) -> list[Item]:
        """导出只使用临时副本，避免补译文影响项目事实。"""

        return [Item.from_dict(item.to_dict()) for item in items]

    @classmethod
    def fill_duplicated_translations(cls, items: list[Item]) -> None:
        """导出前按同文件原文从已完成条目补齐重复项译文。"""

        translation_by_file_src: dict[
            tuple[str, str], tuple[str, str | list[str] | None]
        ] = {}
        for item in items:
            if item.get_status() != Base.ItemStatus.PROCESSED:
                continue

            key = (item.get_file_path(), item.get_src())
            translation_by_file_src.setdefault(
                key,
                (item.get_dst(), item.get_name_dst()),
            )

        for item in items:
            if item.get_status() != Base.ItemStatus.DUPLICATED:
                continue

            translation = translation_by_file_src.get(
                (item.get_file_path(), item.get_src())
            )
            if translation is None:
                continue

            dst, name_dst = translation
            item.set_dst(dst)
            item.set_name_dst(name_dst)
            item.set_status(Base.ItemStatus.PROCESSED)
