from base.Base import Base
from module.Data.Core.Item import Item


def test_from_dict_ignores_unknown_fields_and_infers_wolf_text_type() -> None:
    item = Item.from_dict(
        {
            "src": r"\cdb[0:1:2]",
            "file_type": Item.FileType.XLSX,
            "unexpected": "ignored",
        }
    )

    assert "unexpected" not in item.to_dict()
    assert item.get_text_type() == Item.TextType.WOLF


def test_effective_dst_falls_back_to_src_and_set_dst_stringifies_value() -> None:
    item = Item(src="原文")

    assert item.get_effective_dst() == "原文"

    item.set_dst(123)

    assert item.get_dst() == "123"
    assert item.get_effective_dst() == "123"


def test_name_helpers_read_first_source_name_and_update_first_target_name() -> None:
    item = Item(
        name_src=["爱丽丝", "鲍勃"],
        name_dst=["Alice", "Bob"],
        status=Base.ProjectStatus.PROCESSED,
    )

    item.set_first_name_dst("Alice")

    assert item.get_first_name_src() == "爱丽丝"
    assert item.get_name_dst() == ["Alice", "鲍勃"]
