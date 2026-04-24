from module.Data.Core.Item import Item
from module.File.TRANS.RENPY import RENPY


def test_renpy_processor_marks_trans_rows_as_renpy_text() -> None:
    assert RENPY(project={}).TEXT_TYPE == Item.TextType.RENPY
