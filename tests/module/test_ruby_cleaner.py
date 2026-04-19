from module.Data.Core.Item import Item
from module.RubyCleaner import RubyCleaner


class TestRubyCleaner:
    def test_clean_always_applies_conservative_rules(self) -> None:
        assert RubyCleaner.clean("\\r[漢字,かんじ]", Item.TextType.WOLF) == "漢字"

    def test_clean_applies_aggressive_rules_for_non_script_types(self) -> None:
        assert RubyCleaner.clean("(漢字/かんじ)", Item.TextType.MD) == "漢字"

    def test_clean_skips_aggressive_rules_for_wolf(self) -> None:
        assert RubyCleaner.clean("(漢字/かんじ)", Item.TextType.WOLF) == "(漢字/かんじ)"
