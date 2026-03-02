from model.Item import Item
from module.File.TRANS.KAG import KAG
from module.File.TRANS.NONE import NONE


def test_kag_inherits_none_trans_reader() -> None:
    kag = KAG(project={})
    assert isinstance(kag, NONE)


def test_kag_text_type_matches_item_kag_enum() -> None:
    assert KAG.TEXT_TYPE == Item.TextType.KAG
