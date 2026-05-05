from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Translation.TranslationExportItemService import (
    TranslationExportItemService,
)


def test_clone_items_returns_independent_export_copies() -> None:
    source_item = Item(src="原文", dst="译文", status=Base.ItemStatus.PROCESSED)

    cloned_items = TranslationExportItemService.clone_items([source_item])

    assert cloned_items == [source_item]
    assert cloned_items[0] is not source_item
    cloned_items[0].set_dst("导出译文")
    assert source_item.get_dst() == "译文"


def test_fill_duplicated_translations_uses_same_file_processed_text() -> None:
    processed = Item(
        file_path="a.txt",
        src="same",
        dst="译文",
        name_dst="姓名",
        status=Base.ItemStatus.PROCESSED,
    )
    duplicated = Item(
        file_path="a.txt",
        src="same",
        status=Base.ItemStatus.DUPLICATED,
    )
    other_file = Item(
        file_path="b.txt",
        src="same",
        status=Base.ItemStatus.DUPLICATED,
    )
    missing_processed = Item(
        file_path="a.txt",
        src="missing",
        status=Base.ItemStatus.DUPLICATED,
    )

    TranslationExportItemService.fill_duplicated_translations(
        [processed, duplicated, other_file, missing_processed]
    )

    assert duplicated.get_dst() == "译文"
    assert duplicated.get_name_dst() == "姓名"
    assert duplicated.get_status() == Base.ItemStatus.PROCESSED
    assert other_file.get_dst() == ""
    assert other_file.get_status() == Base.ItemStatus.DUPLICATED
    assert missing_processed.get_dst() == ""
    assert missing_processed.get_status() == Base.ItemStatus.DUPLICATED
