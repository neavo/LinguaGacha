from model.Item import Item
from module.File.TRANS.NONE import NONE
from module.File.TRANS.RENPY import RENPY


def test_renpy_inherits_none_trans_reader() -> None:
    assert issubclass(RENPY, NONE)


def test_renpy_text_type_matches_item_renpy_enum() -> None:
    assert RENPY.TEXT_TYPE == Item.TextType.RENPY
