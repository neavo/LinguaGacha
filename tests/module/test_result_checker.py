import re

import pytest

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from module.Response.ResponseChecker import ResponseChecker

PRESERVED_SEGMENT_PATTERN = re.compile(r"<[^>]+>")


class FakeDataManager:
    def __init__(self) -> None:
        self.glossary_enable = True
        self.pre_replacement_enable = False
        self.pre_replacement: list[dict[str, str]] = []
        self.post_replacement_enable = False
        self.post_replacement: list[dict[str, str]] = []

    def get_glossary(self) -> list[dict[str, str]]:
        return [{"src": "猫", "dst": "cat"}]

    def get_glossary_enable(self) -> bool:
        return self.glossary_enable

    def get_pre_replacement_enable(self) -> bool:
        return self.pre_replacement_enable

    def get_pre_replacement(self) -> list[dict[str, str]]:
        return self.pre_replacement

    def get_post_replacement_enable(self) -> bool:
        return self.post_replacement_enable

    def get_post_replacement(self) -> list[dict[str, str]]:
        return self.post_replacement


def install_fake_text_processor(
    monkeypatch: pytest.MonkeyPatch,
    pattern: re.Pattern[str] | None,
    *,
    check_result: bool = True,
) -> None:
    class FakeTextProcessor:
        def __init__(self, config: Config, item: Item) -> None:
            del config, item

        def check(self, src: str, dst: str, text_type: Item.TextType) -> bool:
            del src, dst, text_type
            return check_result

        def get_re_sample(
            self, custom: bool, text_type: Item.TextType
        ) -> re.Pattern[str] | None:
            del custom, text_type
            return pattern

        def get_text_preserve_custom_enabled(self) -> bool:
            return False

    monkeypatch.setattr("module.ResultChecker.TextProcessor", FakeTextProcessor)


@pytest.fixture
def install_fakes(monkeypatch: pytest.MonkeyPatch) -> FakeDataManager:
    fake_dm = FakeDataManager()
    monkeypatch.setattr("module.ResultChecker.DataManager.get", lambda: fake_dm)
    install_fake_text_processor(monkeypatch, None)
    return fake_dm


def create_checker(
    source_language: BaseLanguage.Enum = BaseLanguage.Enum.JA,
    target_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH,
) -> ResultChecker:
    return ResultChecker(
        Config(
            source_language=source_language,
            target_language=target_language,
        )
    )


class TestResultChecker:
    def test_check_item_collects_expected_warnings(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        item = Item(
            src="猫",
            dst="かな",
            status=Base.ProjectStatus.PROCESSED,
            retry_count=ResponseChecker.RETRY_COUNT_THRESHOLD,
        )

        warnings = checker.check_item(item)

        assert warnings == [
            WarningType.KANA,
            WarningType.GLOSSARY,
            WarningType.RETRY_THRESHOLD,
        ]

    def test_check_item_returns_empty_for_filtered_status(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        item = Item(src="猫", dst="cat", status=Base.ProjectStatus.NONE)

        assert checker.check_item(item) == []

    def test_check_items_returns_only_items_with_warnings(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        warning_item = Item(
            src="猫",
            dst="かな",
            status=Base.ProjectStatus.PROCESSED,
            retry_count=ResponseChecker.RETRY_COUNT_THRESHOLD,
        )
        normal_item = Item(
            src="dog",
            dst="狗",
            status=Base.ProjectStatus.PROCESSED,
            retry_count=0,
        )

        warning_map = checker.check_items([warning_item, normal_item])

        assert set(warning_map.keys()) == {id(warning_item)}

    def test_get_replaced_text_uses_passed_rules(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        item = Item(src="A/B", dst="甲-Y", status=Base.ProjectStatus.PROCESSED)

        src, dst = checker.get_replaced_text(
            item,
            pre_rules=[{"src": "A", "dst": "X"}],
            post_rules=[{"src": "乙", "dst": "Y"}],
        )

        assert src == "X/B"
        assert dst == "甲-乙"

    def test_get_replaced_text_uses_data_manager_rules_when_no_passed_rules(
        self, install_fakes: FakeDataManager
    ) -> None:
        install_fakes.pre_replacement_enable = True
        install_fakes.pre_replacement = [{"src": "A", "dst": "X"}]
        install_fakes.post_replacement_enable = True
        install_fakes.post_replacement = [{"src": "乙", "dst": "Y"}]
        checker = create_checker()
        item = Item(src="A/B", dst="甲-Y", status=Base.ProjectStatus.PROCESSED)

        src, dst = checker.get_replaced_text(item)

        assert src == "X/B"
        assert dst == "甲-乙"

    def test_has_hangeul_error_only_for_korean_source(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        ko_checker = create_checker(BaseLanguage.Enum.KO)
        ja_checker = create_checker(BaseLanguage.Enum.JA)
        item = Item(src="src", dst="한글", status=Base.ProjectStatus.PROCESSED)

        assert ko_checker.has_hangeul_error(item) is True
        assert ja_checker.has_hangeul_error(item) is False

    def test_has_kana_error_ignores_preserved_segment(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, PRESERVED_SEGMENT_PATTERN)
        checker = create_checker(BaseLanguage.Enum.JA)
        item = Item(src="src", dst="中文<かな>", status=Base.ProjectStatus.PROCESSED)

        assert checker.has_kana_error(item) is False

    def test_has_hangeul_error_ignores_preserved_segment(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, PRESERVED_SEGMENT_PATTERN)
        checker = create_checker(BaseLanguage.Enum.KO)
        item = Item(src="src", dst="中文<한글>", status=Base.ProjectStatus.PROCESSED)

        assert checker.has_hangeul_error(item) is False

    def test_check_item_keeps_kana_warning_for_residue_outside_preserved_segment(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, PRESERVED_SEGMENT_PATTERN)
        checker = create_checker(BaseLanguage.Enum.JA)
        item = Item(
            src="hello",
            dst="中文<かな>かな",
            status=Base.ProjectStatus.PROCESSED,
        )

        warnings = checker.check_item(item)

        assert warnings == [WarningType.KANA]

    def test_check_item_keeps_hangeul_warning_for_residue_outside_preserved_segment(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, PRESERVED_SEGMENT_PATTERN)
        checker = create_checker(BaseLanguage.Enum.KO)
        item = Item(
            src="hello",
            dst="中文<한글>한",
            status=Base.ProjectStatus.PROCESSED,
        )

        warnings = checker.check_item(item)

        assert warnings == [WarningType.HANGEUL]

    def test_check_item_similarity_ignores_preserved_only_source_part(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, PRESERVED_SEGMENT_PATTERN)
        checker = create_checker(BaseLanguage.Enum.EN)
        item = Item(
            src="<tag>",
            dst="<tag>翻译",
            status=Base.ProjectStatus.PROCESSED,
        )

        warnings = checker.check_item(item)

        assert warnings == []

    def test_check_item_similarity_still_detects_after_preserved_segment_removed(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, PRESERVED_SEGMENT_PATTERN)
        checker = create_checker(BaseLanguage.Enum.EN)
        item = Item(
            src="hello<tag>",
            dst="hello<tag>!",
            status=Base.ProjectStatus.PROCESSED,
        )

        warnings = checker.check_item(item)

        assert warnings == [WarningType.SIMILARITY]

    def test_get_failed_glossary_terms_returns_missing_terms(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        item = Item(
            src="猫がいる", dst="有一只动物", status=Base.ProjectStatus.PROCESSED
        )

        assert checker.get_failed_glossary_terms(item) == [("猫", "cat")]

    def test_check_item_skips_when_dst_empty(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        item = Item(src="猫", dst="", status=Base.ProjectStatus.PROCESSED)

        assert checker.check_item(item) == []

    def test_prepare_glossary_data_returns_empty_when_glossary_disabled(
        self, install_fakes: FakeDataManager
    ) -> None:
        install_fakes.glossary_enable = False
        checker = create_checker()

        assert checker.prepare_glossary_data() == []

    def test_get_failed_glossary_terms_returns_empty_without_glossary(
        self, install_fakes: FakeDataManager
    ) -> None:
        install_fakes.glossary_enable = False
        checker = create_checker()
        item = Item(src="猫", dst="cat", status=Base.ProjectStatus.PROCESSED)

        assert checker.get_failed_glossary_terms(item) == []

    def test_has_glossary_error_returns_false_without_prepared_glossary(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker()
        checker.prepared_glossary_data = []

        assert checker.has_glossary_error("猫がいる", "有一只猫") is False

    def test_get_failed_glossary_terms_only_returns_unmatched_terms(
        self, install_fakes: FakeDataManager
    ) -> None:
        install_fakes.pre_replacement_enable = False
        checker = create_checker()
        checker.prepared_glossary_data = [
            {"src": "猫", "dst": "cat"},
            {"src": "犬", "dst": "dog"},
        ]
        item = Item(
            src="猫と犬がいる",
            dst="cat 在这里",
            status=Base.ProjectStatus.PROCESSED,
        )

        assert checker.get_failed_glossary_terms(item) == [("犬", "dog")]

    def test_has_kana_error_returns_false_for_non_japanese_source(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = create_checker(BaseLanguage.Enum.EN)
        item = Item(src="src", dst="かな", status=Base.ProjectStatus.PROCESSED)

        assert checker.has_kana_error(item) is False

    def test_has_untranslated_error_checks_none_status(
        self, install_fakes: FakeDataManager
    ) -> None:
        del install_fakes
        checker = ResultChecker(Config())

        assert (
            checker.has_untranslated_error(Item(status=Base.ProjectStatus.NONE)) is True
        )
        assert (
            checker.has_untranslated_error(Item(status=Base.ProjectStatus.PROCESSED))
            is False
        )

    def test_check_item_can_collect_hangeul_text_preserve_and_similarity_warnings(
        self,
        monkeypatch: pytest.MonkeyPatch,
        install_fakes: FakeDataManager,
    ) -> None:
        del install_fakes
        install_fake_text_processor(monkeypatch, None, check_result=False)
        checker = create_checker(BaseLanguage.Enum.KO)
        item = Item(
            src="hello",
            dst="hello한",
            status=Base.ProjectStatus.PROCESSED,
            retry_count=0,
        )

        warnings = checker.check_item(item)

        assert warnings == [
            WarningType.HANGEUL,
            WarningType.TEXT_PRESERVE,
            WarningType.SIMILARITY,
        ]
