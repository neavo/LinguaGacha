import re
import sys
import types

import pytest

from model.Item import Item
from module.Config import Config
from module.Fixer.CodeFixer import CodeFixer


def install_fake_text_processor(
    monkeypatch: pytest.MonkeyPatch,
    pattern: re.Pattern[str] | None,
) -> None:
    fake_module = types.ModuleType("module.TextProcessor")

    class FakeTextProcessor:
        def __init__(
            self,
            config: Config,
            item: object,
            quality_snapshot: object = None,
        ) -> None:
            self.config = config
            self.item = item
            self.quality_snapshot = quality_snapshot

        def get_re_sample(
            self, custom: bool, text_type: object
        ) -> re.Pattern[str] | None:
            del custom, text_type
            return pattern

    setattr(fake_module, "TextProcessor", FakeTextProcessor)
    monkeypatch.setitem(sys.modules, "module.TextProcessor", fake_module)


class TestCodeFixer:
    def test_init_does_not_crash(self) -> None:
        CodeFixer()

    def test_is_ordered_subset_returns_mismatch_indexes(self) -> None:
        flag, mismatch_indexes = CodeFixer.is_ordered_subset(
            ["<1>", "<3>"],
            ["<1>", "<2>", "<3>", "<4>"],
        )

        assert flag is True
        assert mismatch_indexes == [1, 3]

    def test_is_ordered_subset_returns_false_when_not_subset(self) -> None:
        flag, mismatch_indexes = CodeFixer.is_ordered_subset(
            ["<1>", "<5>"],
            ["<1>", "<2>", "<3>"],
        )

        assert flag is False
        assert mismatch_indexes == []

    def test_fix_remove_extra_codes_from_destination(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"<[^>]+>"))

        src = "A<1>B<2>C"
        dst = "A<1>B<x><2>C"

        assert CodeFixer.fix(src, dst, Item.TextType.RPGMAKER, Config()) == "A<1>B<2>C"

    def test_fix_return_original_when_destination_has_fewer_codes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"<[^>]+>"))

        src = "A<1>B<2>C"
        dst = "A<1>BC"

        assert CodeFixer.fix(src, dst, Item.TextType.RPGMAKER, Config()) == dst

    def test_fix_preserves_whitespace_matches_in_regex(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"\s+|<[^>]+>"))

        src = "A<1> B<2> C"
        dst = "A<1>  B<x><2> C"

        assert (
            CodeFixer.fix(src, dst, Item.TextType.RPGMAKER, Config()) == "A<1>  B<2> C"
        )

    def test_fix_return_original_when_rule_is_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_fake_text_processor(monkeypatch, None)

        src = "A<1>B"
        dst = "A<1><x>B"

        assert CodeFixer.fix(src, dst, Item.TextType.RPGMAKER, Config()) == dst

    def test_fix_return_original_when_not_ordered_subset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"<[^>]+>"))

        src = "A<1>B<2>C"
        dst = "A<1><x>B<3>C"

        assert CodeFixer.fix(src, dst, Item.TextType.RPGMAKER, Config()) == dst
