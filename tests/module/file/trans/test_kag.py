from module.Data.Core.Item import Item
from module.File.TRANS.KAG import KAG


def test_kag_exposes_kag_text_type() -> None:
    assert KAG(project={}).TEXT_TYPE == Item.TextType.KAG
