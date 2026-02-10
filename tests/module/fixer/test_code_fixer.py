import re
import sys
import types

from module.Fixer.CodeFixer import CodeFixer


def install_fake_text_processor(
    monkeypatch: object,
    pattern: re.Pattern[str] | None,
) -> None:
    fake_module = types.ModuleType("module.TextProcessor")

    class FakeTextProcessor:
        def __init__(
            self,
            config: object,
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

    fake_module.TextProcessor = FakeTextProcessor
    monkeypatch.setitem(sys.modules, "module.TextProcessor", fake_module)


class TestCodeFixer:
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

    def test_fix_remove_extra_codes_from_destination(self, monkeypatch: object) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"<[^>]+>"))

        src = "A<1>B<2>C"
        dst = "A<1>B<x><2>C"

        assert CodeFixer.fix(src, dst, "RPGMAKER", object()) == "A<1>B<2>C"

    def test_fix_return_original_when_rule_is_none(self, monkeypatch: object) -> None:
        install_fake_text_processor(monkeypatch, None)

        src = "A<1>B"
        dst = "A<1><x>B"

        assert CodeFixer.fix(src, dst, "RPGMAKER", object()) == dst

    def test_fix_return_original_when_not_ordered_subset(
        self, monkeypatch: object
    ) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"<[^>]+>"))

        src = "A<1>B<2>C"
        dst = "A<1><x>B<3>C"

        assert CodeFixer.fix(src, dst, "RPGMAKER", object()) == dst
