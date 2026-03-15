from __future__ import annotations

from model.Item import Item
from module.File.TRANS.KAG import KAG
from module.File.TRANS.NONE import NONE
from module.File.TRANS.RENPY import RENPY


def test_kag_and_renpy_processors_text_type() -> None:
    assert issubclass(KAG, NONE)
    assert issubclass(RENPY, NONE)
    assert KAG.TEXT_TYPE == Item.TextType.KAG
    assert RENPY.TEXT_TYPE == Item.TextType.RENPY
