from base.BaseLanguage import BaseLanguage
from module.Fixer.PunctuationFixer import PunctuationFixer


class TestPunctuationFixer:
    def test_fix_start_end_align_with_source_quotes(self) -> None:
        src = "「你好」"
        dst = '"你好"'

        assert (
            PunctuationFixer.fix_start_end(src, dst, BaseLanguage.Enum.EN) == "「你好」"
        )

    def test_non_cjk_to_cjk_apply_rule_a_only(self) -> None:
        src = "A:B"
        dst = "A：B"

        assert (
            PunctuationFixer.fix(
                src,
                dst,
                BaseLanguage.Enum.EN,
                BaseLanguage.Enum.ZH,
            )
            == "A：B"
        )

    def test_non_cjk_to_non_cjk_apply_rule_b(self) -> None:
        src = "A:B"
        dst = "A：B"

        assert (
            PunctuationFixer.fix(
                src,
                dst,
                BaseLanguage.Enum.EN,
                BaseLanguage.Enum.EN,
            )
            == "A:B"
        )

    def test_cjk_target_force_convert_corner_quotes(self) -> None:
        src = "\u300chello\u300d"
        dst = "\u201chello\u201d"

        assert (
            PunctuationFixer.fix(
                src,
                dst,
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
            )
            == "\u300chello\u300d"
        )
