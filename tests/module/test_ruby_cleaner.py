from module.Config import Config
from module.Data.Core.Item import Item
from module.RubyCleaner import RubyCleaner


class TestRubyCleaner:
    def test_clean_always_applies_conservative_rules(self) -> None:
        assert RubyCleaner.clean("\\r[漢字,かんじ]", Item.TextType.WOLF) == "漢字"

    def test_clean_applies_aggressive_rules_for_non_script_types(self) -> None:
        assert RubyCleaner.clean("(漢字/かんじ)", Item.TextType.MD) == "漢字"

    def test_clean_skips_aggressive_rules_for_wolf(self) -> None:
        assert RubyCleaner.clean("(漢字/かんじ)", Item.TextType.WOLF) == "(漢字/かんじ)"

    def test_clean_item_src_uses_epub_candidate_when_enabled(self) -> None:
        item = Item.from_dict(
            {
                "src": "宝條\n直希",
                "file_type": Item.FileType.EPUB,
                "extra_field": {
                    "epub": {
                        "ruby_clean_candidate": {
                            "cleaned_src": "宝條直希",
                            "block_path": "/html[1]/body[1]/p[1]",
                            "cleaned_digest": "digest",
                        }
                    }
                },
            }
        )

        assert RubyCleaner.clean_item_src(item, Config(clean_ruby=True)) == "宝條直希"

    def test_clean_item_src_keeps_original_when_disabled(self) -> None:
        item = Item.from_dict(
            {
                "src": "宝條\n直希",
                "file_type": Item.FileType.EPUB,
                "extra_field": {
                    "epub": {
                        "ruby_clean_candidate": {
                            "cleaned_src": "宝條直希",
                            "block_path": "/html[1]/body[1]/p[1]",
                            "cleaned_digest": "digest",
                        }
                    }
                },
            }
        )

        assert (
            RubyCleaner.clean_item_src(item, Config(clean_ruby=False)) == "宝條\n直希"
        )
