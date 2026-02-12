import re

import pytest

from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Response.ResponseChecker import ResponseChecker


def install_fake_text_processor(
    monkeypatch: pytest.MonkeyPatch,
    pattern: re.Pattern[str] | None,
) -> None:
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
            self,
            custom: bool,
            text_type: Item.TextType,
        ) -> re.Pattern[str] | None:
            del custom, text_type
            return pattern

    monkeypatch.setattr(
        "module.Response.ResponseChecker.TextProcessor", FakeTextProcessor
    )


def create_config(
    source_language: BaseLanguage.Enum,
    target_language: BaseLanguage.Enum,
    *,
    check_kana_residue: bool = True,
    check_hangeul_residue: bool = True,
    check_similarity: bool = True,
) -> Config:
    return Config(
        source_language=source_language,
        target_language=target_language,
        check_kana_residue=check_kana_residue,
        check_hangeul_residue=check_hangeul_residue,
        check_similarity=check_similarity,
    )


def create_checker(config: Config, *, retry_count: int = 0) -> ResponseChecker:
    return ResponseChecker(config=config, items=[Item(retry_count=retry_count)])


class TestResponseCheckerCheck:
    @pytest.fixture(autouse=True)
    def setup_fake_processor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        install_fake_text_processor(monkeypatch, None)

    def test_check_returns_degradation_when_stream_is_degraded(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.JA, BaseLanguage.Enum.ZH)
        )

        checks = checker.check(
            ["原文1", "原文2"],
            ["译文1", "译文2"],
            Item.TextType.NONE,
            stream_degraded=True,
        )

        assert checks == [
            ResponseChecker.Error.FAIL_DEGRADATION,
            ResponseChecker.Error.FAIL_DEGRADATION,
        ]

    def test_check_returns_fail_data_when_destinations_are_blank(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.JA, BaseLanguage.Enum.ZH)
        )

        checks = checker.check(["原文1", "原文2"], ["", ""], Item.TextType.NONE)

        assert checks == [
            ResponseChecker.Error.FAIL_DATA,
            ResponseChecker.Error.FAIL_DATA,
        ]

    def test_check_skips_validation_when_retry_threshold_reached(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.JA, BaseLanguage.Enum.ZH),
            retry_count=ResponseChecker.RETRY_COUNT_THRESHOLD,
        )

        checks = checker.check(["原文"], ["任意内容"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_returns_fail_line_count_when_lengths_mismatch(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.JA, BaseLanguage.Enum.ZH)
        )

        checks = checker.check(["a", "b"], ["1"], Item.TextType.NONE)

        assert checks == [
            ResponseChecker.Error.FAIL_LINE_COUNT,
            ResponseChecker.Error.FAIL_LINE_COUNT,
        ]

    def test_check_returns_line_error_from_check_lines(self) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
                check_similarity=False,
            )
        )

        checks = checker.check(["こんにちは"], ["テスト"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_KANA]

    def test_check_returns_none_when_lines_are_valid(self) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
                check_similarity=False,
            )
        )

        checks = checker.check(["こんにちは"], ["你好"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]


class TestResponseCheckerCheckLines:
    @pytest.fixture(autouse=True)
    def setup_fake_processor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        install_fake_text_processor(monkeypatch, None)

    def test_check_lines_returns_empty_line_error(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.ZH, BaseLanguage.Enum.EN)
        )

        checks = checker.check_lines(["有内容"], [""], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_EMPTY_LINE]

    def test_check_lines_returns_none_when_rule_filter_matches(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.JA, BaseLanguage.Enum.ZH)
        )

        checks = checker.check_lines(["12345"], ["任意译文"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_lines_returns_none_when_language_filter_matches(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.JA, BaseLanguage.Enum.ZH)
        )

        checks = checker.check_lines(["Hello World"], ["任何译文"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_lines_detects_kana_residue(self) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
                check_kana_residue=True,
                check_similarity=False,
            )
        )

        checks = checker.check_lines(["こんにちは"], ["テスト"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_KANA]

    def test_check_lines_detects_hangeul_residue(self) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.KO,
                BaseLanguage.Enum.ZH,
                check_hangeul_residue=True,
                check_similarity=False,
            )
        )

        checks = checker.check_lines(["안녕하세요"], ["테스트"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_HANGEUL]

    def test_check_lines_detects_similarity_for_general_language_pair(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.EN, BaseLanguage.Enum.ZH)
        )

        checks = checker.check_lines(["same text"], ["same text"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_SIMILARITY]

    def test_check_lines_returns_none_when_similarity_condition_not_met(self) -> None:
        checker = create_checker(
            create_config(BaseLanguage.Enum.EN, BaseLanguage.Enum.ZH)
        )

        checks = checker.check_lines(["alpha"], ["beta"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_lines_ja_to_zh_similarity_requires_kana_in_destination(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
                check_kana_residue=False,
            )
        )
        monkeypatch.setattr(
            "module.Response.ResponseChecker.TextHelper.check_similarity_by_jaccard",
            classmethod(lambda cls, x, y: 0.95),
        )

        checks = checker.check_lines(["こんにちは"], ["你好世界"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_lines_ja_to_zh_similarity_with_kana_returns_similarity_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
                check_kana_residue=False,
            )
        )
        monkeypatch.setattr(
            "module.Response.ResponseChecker.TextHelper.check_similarity_by_jaccard",
            classmethod(lambda cls, x, y: 0.95),
        )

        checks = checker.check_lines(["こんにちは"], ["あいうえお"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_SIMILARITY]

    def test_check_lines_ko_to_zh_similarity_with_hangeul_returns_similarity_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.KO,
                BaseLanguage.Enum.ZH,
                check_hangeul_residue=False,
            )
        )
        monkeypatch.setattr(
            "module.Response.ResponseChecker.TextHelper.check_similarity_by_jaccard",
            classmethod(lambda cls, x, y: 0.95),
        )

        checks = checker.check_lines(["안녕하세요"], ["테스트"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_SIMILARITY]

    def test_check_lines_ko_to_zh_similarity_without_hangeul_returns_none(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        checker = create_checker(
            create_config(
                BaseLanguage.Enum.KO,
                BaseLanguage.Enum.ZH,
                check_hangeul_residue=False,
            )
        )
        monkeypatch.setattr(
            "module.Response.ResponseChecker.TextHelper.check_similarity_by_jaccard",
            classmethod(lambda cls, x, y: 0.95),
        )

        checks = checker.check_lines(["안녕하세요"], ["你好世界"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_lines_removes_preserved_tokens_before_residue_check(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        install_fake_text_processor(monkeypatch, re.compile(r"<[^>]+>"))

        checker = create_checker(
            create_config(
                BaseLanguage.Enum.JA,
                BaseLanguage.Enum.ZH,
                check_similarity=False,
            )
        )

        checks = checker.check_lines(
            ["こんにちは<かな>"], ["中文<かな>"], Item.TextType.NONE
        )

        assert checks == [ResponseChecker.Error.NONE]


class TestResponseCheckerSourceLanguageALL:
    """验证 source_language=BaseLanguage.ALL 时，ResponseChecker 不会因语言过滤短路。"""

    @pytest.fixture(autouse=True)
    def setup_fake_processor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        install_fake_text_processor(monkeypatch, None)

    def test_check_lines_does_not_short_circuit_with_source_language_all(
        self,
    ) -> None:
        """当 source_language=ALL 时，LanguageFilter 返回 False，不会跳过检查。
        此时对于"相似原文译文"会触发相似度检查（而非直接返回 NONE）。"""
        checker = create_checker(
            Config(
                source_language=BaseLanguage.ALL,
                target_language=BaseLanguage.Enum.ZH,
                check_kana_residue=False,
                check_hangeul_residue=False,
                check_similarity=True,
            )
        )

        checks = checker.check_lines(
            ["Hello World"], ["Hello World"], Item.TextType.NONE
        )

        assert checks == [ResponseChecker.Error.LINE_ERROR_SIMILARITY]

    def test_check_lines_with_source_language_all_allows_valid_translation(
        self,
    ) -> None:
        """当 source_language=ALL 时，正常的翻译仍能通过检查（不因语言过滤被错误标记）。
        原文是日文，译文是中文，能正常通过检查。"""
        checker = create_checker(
            Config(
                source_language=BaseLanguage.ALL,
                target_language=BaseLanguage.Enum.ZH,
                check_kana_residue=False,
                check_hangeul_residue=False,
                check_similarity=True,
            )
        )

        checks = checker.check_lines(["こんにちは"], ["你好"], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.NONE]

    def test_check_lines_with_source_language_all_and_empty_translation(
        self,
    ) -> None:
        """当 source_language=ALL 时，译文为空仍应判定为 EMPTY_LINE（不因语言过滤被跳过）。"""
        checker = create_checker(
            Config(
                source_language=BaseLanguage.ALL,
                target_language=BaseLanguage.Enum.ZH,
                check_kana_residue=False,
                check_hangeul_residue=False,
                check_similarity=False,
            )
        )

        checks = checker.check_lines(["Hello World"], [""], Item.TextType.NONE)

        assert checks == [ResponseChecker.Error.LINE_ERROR_EMPTY_LINE]
