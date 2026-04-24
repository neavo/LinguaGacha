from module.Data.Core.Item import Item
from module.File.TRANS.KAG import KAG


def test_kag_processor_marks_trans_rows_as_kag_text() -> None:
    assert KAG(project={}).TEXT_TYPE == Item.TextType.KAG
