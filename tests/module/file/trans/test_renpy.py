from module.Data.Core.Item import Item
from module.File.TRANS.RENPY import RENPY


def test_renpy_exposes_renpy_text_type() -> None:
    assert RENPY(project={}).TEXT_TYPE == Item.TextType.RENPY
