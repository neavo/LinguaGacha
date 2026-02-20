import re
from collections.abc import Generator
from typing import cast

import pytest

from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.TextProcessor import TextProcessor


def create_snapshot(
    *,
    text_preserve_mode: DataManager.TextPreserveMode = DataManager.TextPreserveMode.CUSTOM,
    text_preserve_entries: tuple[dict, ...] = (),
    pre_replacement_enable: bool = False,
    pre_replacement_entries: tuple[dict, ...] = (),
    post_replacement_enable: bool = False,
    post_replacement_entries: tuple[dict, ...] = (),
) -> QualityRuleSnapshot:
    return QualityRuleSnapshot(
        glossary_enable=False,
        text_preserve_mode=text_preserve_mode,
        text_preserve_entries=text_preserve_entries,
        pre_replacement_enable=pre_replacement_enable,
        pre_replacement_entries=pre_replacement_entries,
        post_replacement_enable=post_replacement_enable,
        post_replacement_entries=post_replacement_entries,
        custom_prompt_zh_enable=False,
        custom_prompt_zh="",
        custom_prompt_en_enable=False,
        custom_prompt_en="",
        glossary_entries=[],
    )


@pytest.fixture(autouse=True)
def reset_text_processor_rule_cache() -> Generator[None, None, None]:
    TextProcessor.reset()
    yield
    TextProcessor.reset()


class TestTextProcessor:
    def test_extract_line_edge_whitespace_stores_and_strips(self) -> None:
        processor = TextProcessor(Config(), None)

        stripped = processor.extract_line_edge_whitespace(0, "  hello\t ")

        assert stripped == "hello"
        assert processor.leading_whitespace_by_line[0] == "  "
        assert processor.trailing_whitespace_by_line[0] == "\t "

    def test_replace_pre_translation_supports_case_insensitive_literal(self) -> None:
        snapshot = create_snapshot(
            pre_replacement_enable=True,
            pre_replacement_entries=(
                {
                    "src": "ABC",
                    "dst": "x",
                    "regex": False,
                    "case_sensitive": False,
                },
            ),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.replace_pre_translation("abc AbC") == "x x"

    def test_prefix_suffix_process_extracts_codes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        processor = TextProcessor(Config(), None, create_snapshot())
        monkeypatch.setattr(
            processor,
            "get_re_prefix",
            lambda custom, text_type: re.compile(r"^<[^>]+>"),
        )
        monkeypatch.setattr(
            processor,
            "get_re_suffix",
            lambda custom, text_type: re.compile(r"</[^>]+>$"),
        )

        result = processor.prefix_suffix_process(0, "<b>hello</b>", Item.TextType.NONE)

        assert result == "hello"
        assert processor.prefix_codes[0] == ["<b>"]
        assert processor.suffix_codes[0] == ["</b>"]

    def test_post_process_restores_codes_and_whitespace(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="  line  ", text_type=Item.TextType.NONE)
        processor = TextProcessor(Config(), item, create_snapshot())
        processor.srcs = ["line"]
        processor.vaild_index = {0}
        processor.prefix_codes = {0: ["<b>"]}
        processor.suffix_codes = {0: ["</b>"]}
        processor.leading_whitespace_by_line = {0: "  "}
        processor.trailing_whitespace_by_line = {0: "  "}

        monkeypatch.setattr(processor, "auto_fix", lambda src, dst: dst)
        monkeypatch.setattr(processor, "replace_post_translation", lambda dst: dst)

        name, result = processor.post_process(["ok"])

        assert name is None
        assert result == "  <b>ok</b>  "

    def test_check_ignores_whitespace_inside_matched_codes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        processor = TextProcessor(
            Config(source_language=BaseLanguage.Enum.JA), None, create_snapshot()
        )
        monkeypatch.setattr(
            processor,
            "get_re_check",
            lambda custom, text_type: re.compile(r"\[[^\]]+\]"),
        )

        assert processor.check("[a b] text", "[ab] text", Item.TextType.NONE) is True

    def test_build_custom_preserve_data_filters_invalid_entries(self) -> None:
        snapshot = create_snapshot(
            text_preserve_entries=(
                {"src": "  [A]  "},
                {"src": ""},
                {"src": "   "},
                {"src": 123},
                {"dst": "missing"},
                {"src": "[B]"},
            )
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.build_custom_preserve_data() == ("[A]", "[B]")

    def test_get_re_check_returns_none_when_mode_off(self) -> None:
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.OFF,
            text_preserve_entries=({"src": "[A]"},),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.get_re_check(True, Item.TextType.NONE) is None

    def test_get_re_sample_uses_custom_mode_entries(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.CUSTOM,
            text_preserve_entries=({"src": "  [A]"}, {"src": ""}),
        )
        processor = TextProcessor(Config(), None, snapshot)
        captured: dict[str, object] = {}

        def fake_get_rule(
            *,
            custom: bool,
            custom_data: tuple[str, ...] | None,
            rule_type: TextProcessor.RuleType,
            text_type: Item.TextType,
            language: BaseLanguage.Enum,
        ) -> re.Pattern[str]:
            captured["custom"] = custom
            captured["custom_data"] = custom_data
            captured["rule_type"] = rule_type
            captured["text_type"] = text_type
            captured["language"] = language
            return re.compile(r"\[[^\]]+\]")

        monkeypatch.setattr(TextProcessor, "get_rule", fake_get_rule)

        pattern = processor.get_re_sample(False, Item.TextType.NONE)

        assert isinstance(pattern, re.Pattern)
        assert captured["custom"] is True
        assert captured["custom_data"] == ("[A]",)
        assert captured["rule_type"] == TextProcessor.RuleType.SAMPLE
        assert captured["text_type"] == Item.TextType.NONE
        assert captured["language"] == BaseLanguage.Enum.ZH

    def test_get_re_prefix_uses_preset_mode(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.SMART,
            text_preserve_entries=({"src": "[A]"},),
        )
        processor = TextProcessor(Config(), None, snapshot)
        captured: dict[str, object] = {}

        def fake_get_rule(
            *,
            custom: bool,
            custom_data: tuple[str, ...] | None,
            rule_type: TextProcessor.RuleType,
            text_type: Item.TextType,
            language: BaseLanguage.Enum,
        ) -> re.Pattern[str]:
            captured["custom"] = custom
            captured["custom_data"] = custom_data
            captured["rule_type"] = rule_type
            captured["text_type"] = text_type
            captured["language"] = language
            return re.compile(r".+")

        monkeypatch.setattr(TextProcessor, "get_rule", fake_get_rule)

        pattern = processor.get_re_prefix(True, Item.TextType.NONE)

        assert isinstance(pattern, re.Pattern)
        assert captured["custom"] is False
        assert captured["custom_data"] is None
        assert captured["rule_type"] == TextProcessor.RuleType.PREFIX
        assert captured["text_type"] == Item.TextType.NONE
        assert captured["language"] == BaseLanguage.Enum.ZH

    def test_replace_post_translation_supports_regex_case_sensitive(self) -> None:
        snapshot = create_snapshot(
            post_replacement_enable=True,
            post_replacement_entries=(
                {
                    "src": "A+",
                    "dst": "x",
                    "regex": True,
                    "case_sensitive": True,
                },
            ),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.replace_post_translation("aa AA A") == "aa x x"

    def test_pre_process_skips_blank_lines_and_adds_markdown_sample(self) -> None:
        item = Item(src="   \nhello", text_type=Item.TextType.MD)
        snapshot = create_snapshot(text_preserve_mode=DataManager.TextPreserveMode.OFF)
        processor = TextProcessor(Config(), item, snapshot)

        processor.pre_process()

        assert processor.srcs == ["hello"]
        assert processor.vaild_index == {1}
        assert processor.samples == ["Markdown Code"]

    def test_extract_name_removes_wrapped_prefix(self) -> None:
        item = Item(name_src="Alice")
        processor = TextProcessor(Config(), item, create_snapshot())

        name, srcs, dsts = processor.extract_name(
            ["【Alice】 hello"], ["【Alicia】 hi"], item
        )

        assert name == "Alicia"
        assert srcs == ["hello"]
        assert dsts == ["hi"]

    def test_replace_pre_translation_supports_regex_case_insensitive(self) -> None:
        snapshot = create_snapshot(
            pre_replacement_enable=True,
            pre_replacement_entries=(
                {
                    "src": "ab+",
                    "dst": "x",
                    "regex": True,
                    "case_sensitive": False,
                },
            ),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.replace_pre_translation("ABbb aB") == "x x"

    def test_replace_pre_translation_casts_non_string_fields(self) -> None:
        snapshot = create_snapshot(
            pre_replacement_enable=True,
            pre_replacement_entries=(
                {
                    "src": None,
                    "dst": "ignored",
                    "regex": False,
                    "case_sensitive": True,
                },
                {
                    "src": 123,
                    "dst": 456,
                    "regex": False,
                    "case_sensitive": True,
                },
            ),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.replace_pre_translation("123") == "456"

    def test_prefix_suffix_process_disabled_keeps_original(self) -> None:
        processor = TextProcessor(
            Config(auto_process_prefix_suffix_preserved_text=False),
            None,
            create_snapshot(),
        )

        result = processor.prefix_suffix_process(0, "<b>hello</b>", Item.TextType.NONE)

        assert result == "<b>hello</b>"
        assert processor.prefix_codes == {}
        assert processor.suffix_codes == {}

    def test_post_process_keeps_blank_and_invalid_lines(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="line\n \nskip", text_type=Item.TextType.NONE)
        processor = TextProcessor(Config(), item, create_snapshot())
        processor.srcs = ["line"]
        processor.vaild_index = {0}

        monkeypatch.setattr(processor, "auto_fix", lambda src, dst: dst)
        monkeypatch.setattr(processor, "replace_post_translation", lambda dst: dst)

        _, result = processor.post_process(["ok"])

        assert result == "ok\n \nskip"

    def test_check_returns_true_when_preserve_rule_is_off(self) -> None:
        snapshot = create_snapshot(text_preserve_mode=DataManager.TextPreserveMode.OFF)
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.check("[A]", "[B]", Item.TextType.NONE) is True

    def test_auto_fix_returns_original_when_item_missing(self) -> None:
        processor = TextProcessor(
            Config(
                source_language=BaseLanguage.Enum.JA,
                target_language=BaseLanguage.Enum.ZH,
            ),
            None,
            create_snapshot(),
        )

        assert processor.auto_fix("src", "dst") == "dst"

    def test_auto_fix_ja_runs_fixers_in_expected_order(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="src", text_type=Item.TextType.NONE)
        processor = TextProcessor(
            Config(
                source_language=BaseLanguage.Enum.JA,
                target_language=BaseLanguage.Enum.ZH,
            ),
            item,
            create_snapshot(),
        )
        calls: list[str] = []

        def fake_kana(dst: str) -> str:
            calls.append("kana")
            return f"{dst}-k"

        def fake_code(
            src: str,
            dst: str,
            text_type: Item.TextType,
            config: Config,
            quality_snapshot: QualityRuleSnapshot | None,
        ) -> str:
            calls.append("code")
            assert src == "src"
            assert dst == "dst-k"
            assert text_type == Item.TextType.NONE
            assert config is processor.config
            assert quality_snapshot is processor.quality_snapshot
            return f"{dst}-c"

        def fake_escape(src: str, dst: str) -> str:
            calls.append("escape")
            assert src == "src"
            return f"{dst}-e"

        def fake_number(src: str, dst: str) -> str:
            calls.append("number")
            assert src == "src"
            return f"{dst}-n"

        def fake_punctuation(
            src: str,
            dst: str,
            source_language: BaseLanguage.Enum,
            target_language: BaseLanguage.Enum,
        ) -> str:
            calls.append("punctuation")
            assert src == "src"
            assert source_language == BaseLanguage.Enum.JA
            assert target_language == BaseLanguage.Enum.ZH
            return f"{dst}-p"

        monkeypatch.setattr("module.TextProcessor.KanaFixer.fix", fake_kana)
        monkeypatch.setattr(
            "module.TextProcessor.HangeulFixer.fix",
            lambda dst: pytest.fail(f"unexpected hangeul fixer call: {dst}"),
        )
        monkeypatch.setattr("module.TextProcessor.CodeFixer.fix", fake_code)
        monkeypatch.setattr("module.TextProcessor.EscapeFixer.fix", fake_escape)
        monkeypatch.setattr("module.TextProcessor.NumberFixer.fix", fake_number)
        monkeypatch.setattr(
            "module.TextProcessor.PunctuationFixer.fix", fake_punctuation
        )

        result = processor.auto_fix("src", "dst")

        assert result == "dst-k-c-e-n-p"
        assert calls == ["kana", "code", "escape", "number", "punctuation"]

    def test_auto_fix_ko_uses_hangeul_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="src", text_type=Item.TextType.NONE)
        processor = TextProcessor(
            Config(
                source_language=BaseLanguage.Enum.KO,
                target_language=BaseLanguage.Enum.ZH,
            ),
            item,
            create_snapshot(),
        )

        monkeypatch.setattr(
            "module.TextProcessor.KanaFixer.fix",
            lambda dst: pytest.fail(f"unexpected kana fixer call: {dst}"),
        )
        monkeypatch.setattr(
            "module.TextProcessor.HangeulFixer.fix", lambda dst: f"{dst}-h"
        )
        monkeypatch.setattr(
            "module.TextProcessor.CodeFixer.fix",
            lambda src, dst, text_type, config, quality_snapshot: dst,
        )
        monkeypatch.setattr(
            "module.TextProcessor.EscapeFixer.fix", lambda src, dst: dst
        )
        monkeypatch.setattr(
            "module.TextProcessor.NumberFixer.fix", lambda src, dst: dst
        )
        monkeypatch.setattr(
            "module.TextProcessor.PunctuationFixer.fix",
            lambda src, dst, source_language, target_language: dst,
        )

        assert processor.auto_fix("src", "dst") == "dst-h"

    def test_get_rule_uses_preset_entries(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured_path: list[str] = []

        def fake_load_file(path: str) -> list[dict[str, str]]:
            captured_path.append(path)
            return [{"src": "\\[[^\\]]+\\]"}, {"src": ""}, {"dst": "ignored"}]

        monkeypatch.setattr("module.TextProcessor.JSONTool.load_file", fake_load_file)

        pattern = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert captured_path == ["./resource/text_preserve_preset/zh/none.json"]
        assert isinstance(pattern, re.Pattern)
        assert pattern.search("[ABC]") is not None

    def test_get_rule_returns_none_when_custom_entries_empty(self) -> None:
        pattern = TextProcessor.get_rule(
            custom=True,
            custom_data=("", "   "),
            rule_type=TextProcessor.RuleType.CHECK,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert pattern is None

    def test_extract_collects_and_removes_all_matches(self) -> None:
        processor = TextProcessor(Config(), None)
        rule = re.compile(r"<[^>]+>")

        line, codes = processor.extract(rule, "<a>hello</a>")

        assert line == "hello"
        assert codes == ["<a>", "</a>"]

    def test_clean_ruby_returns_original_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="text", text_type=Item.TextType.NONE)
        processor = TextProcessor(Config(clean_ruby=False), item)
        monkeypatch.setattr(
            "module.TextProcessor.RubyCleaner.clean",
            lambda src, text_type: pytest.fail(
                f"unexpected ruby cleaner call: {src}, {text_type}"
            ),
        )

        assert processor.clean_ruby("hello") == "hello"

    def test_clean_ruby_calls_cleaner_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="text", text_type=Item.TextType.MD)
        processor = TextProcessor(Config(clean_ruby=True), item)

        def fake_clean(src: str, text_type: Item.TextType) -> str:
            assert src == "hello"
            assert text_type == Item.TextType.MD
            return "cleaned"

        monkeypatch.setattr("module.TextProcessor.RubyCleaner.clean", fake_clean)

        assert processor.clean_ruby("hello") == "cleaned"

    def test_inject_name_prefixes_first_line(self) -> None:
        item = Item(name_src="Alice")
        processor = TextProcessor(Config(), item)

        assert processor.inject_name(["hello", "world"], item) == [
            "【Alice】hello",
            "world",
        ]

    def test_inject_name_without_item_keeps_original(self) -> None:
        processor = TextProcessor(Config(), None)

        assert processor.inject_name(["hello"], None) == ["hello"]

    def test_extract_name_without_match_keeps_source_and_destination(self) -> None:
        item = Item(name_src="Alice")
        processor = TextProcessor(Config(), item)

        name, srcs, dsts = processor.extract_name(["【Alice】hello"], ["hello"], item)

        assert name is None
        assert srcs == ["【Alice】hello"]
        assert dsts == ["hello"]

    def test_post_process_returns_empty_when_item_missing(self) -> None:
        processor = TextProcessor(Config(), None)

        assert processor.post_process(["x"]) == (None, "")

    def test_post_process_trims_model_added_edge_spaces(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="line", text_type=Item.TextType.NONE)
        processor = TextProcessor(Config(), item, create_snapshot())
        processor.srcs = ["line"]
        processor.vaild_index = {0}

        monkeypatch.setattr(processor, "auto_fix", lambda src, dst: dst)
        monkeypatch.setattr(processor, "replace_post_translation", lambda dst: dst)

        _, result = processor.post_process(["  ok\t "])

        assert result == "ok"

    def test_check_returns_false_when_preserve_codes_differ(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        processor = TextProcessor(Config(), None, create_snapshot())
        monkeypatch.setattr(
            processor,
            "get_re_check",
            lambda custom, text_type: re.compile(r"\[[^\]]+\]"),
        )

        assert processor.check("[A] body", "[B] body", Item.TextType.NONE) is False

    def test_get_rule_returns_none_when_preset_file_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def raise_missing(path: str) -> list[dict[str, str]]:
            del path
            raise FileNotFoundError("missing")

        monkeypatch.setattr("module.TextProcessor.JSONTool.load_file", raise_missing)

        pattern = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert pattern is None

    def test_get_rule_cache_is_resettable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        call_count = 0

        def fake_load_file(path: str) -> list[dict[str, str]]:
            del path
            nonlocal call_count
            call_count += 1
            return [{"src": "ab"}]

        monkeypatch.setattr("module.TextProcessor.JSONTool.load_file", fake_load_file)

        first = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )
        second = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert first is second
        assert call_count == 1

        TextProcessor.reset()

        third = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert isinstance(third, re.Pattern)
        assert call_count == 2

    def test_get_rule_builds_check_pattern_for_custom_entries(self) -> None:
        pattern = TextProcessor.get_rule(
            custom=True,
            custom_data=("ab",),
            rule_type=TextProcessor.RuleType.CHECK,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert isinstance(pattern, re.Pattern)
        assert pattern.search("zababx") is not None
        assert pattern.search("zax") is None

    def test_get_rule_builds_suffix_pattern_for_custom_entries(self) -> None:
        pattern = TextProcessor.get_rule(
            custom=True,
            custom_data=("ab",),
            rule_type=TextProcessor.RuleType.SUFFIX,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert isinstance(pattern, re.Pattern)
        assert pattern.search("zab") is not None
        assert pattern.search("abz") is None

    def test_get_re_sample_uses_data_manager_custom_entries(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_text_preserve_mode(self) -> DataManager.TextPreserveMode:
                return DataManager.TextPreserveMode.CUSTOM

            def get_text_preserve(self) -> list[dict[str, object]]:
                return [{"src": "  [A]"}, {"src": ""}, {"src": "[B]"}]

        processor = TextProcessor(Config(), None)
        captured: dict[str, object] = {}

        def fake_get_rule(
            *,
            custom: bool,
            custom_data: tuple[str, ...] | None,
            rule_type: TextProcessor.RuleType,
            text_type: Item.TextType,
            language: BaseLanguage.Enum,
        ) -> re.Pattern[str]:
            captured["custom"] = custom
            captured["custom_data"] = custom_data
            captured["rule_type"] = rule_type
            captured["text_type"] = text_type
            captured["language"] = language
            return re.compile(r"\[[^\]]+\]")

        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )
        monkeypatch.setattr(TextProcessor, "get_rule", fake_get_rule)

        pattern = processor.get_re_sample(False, Item.TextType.NONE)

        assert isinstance(pattern, re.Pattern)
        assert captured["custom"] is True
        assert captured["custom_data"] == ("[A]", "[B]")
        assert captured["rule_type"] == TextProcessor.RuleType.SAMPLE
        assert captured["text_type"] == Item.TextType.NONE
        assert captured["language"] == BaseLanguage.Enum.ZH

    def test_get_re_prefix_uses_data_manager_smart_mode(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_text_preserve_mode(self) -> DataManager.TextPreserveMode:
                return DataManager.TextPreserveMode.SMART

        processor = TextProcessor(Config(), None)
        captured: dict[str, object] = {}

        def fake_get_rule(
            *,
            custom: bool,
            custom_data: tuple[str, ...] | None,
            rule_type: TextProcessor.RuleType,
            text_type: Item.TextType,
            language: BaseLanguage.Enum,
        ) -> re.Pattern[str]:
            captured["custom"] = custom
            captured["custom_data"] = custom_data
            captured["rule_type"] = rule_type
            captured["text_type"] = text_type
            captured["language"] = language
            return re.compile(r".+")

        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )
        monkeypatch.setattr(TextProcessor, "get_rule", fake_get_rule)

        pattern = processor.get_re_prefix(True, Item.TextType.NONE)

        assert isinstance(pattern, re.Pattern)
        assert captured["custom"] is False
        assert captured["custom_data"] is None
        assert captured["rule_type"] == TextProcessor.RuleType.PREFIX
        assert captured["text_type"] == Item.TextType.NONE
        assert captured["language"] == BaseLanguage.Enum.ZH

    def test_get_re_suffix_returns_none_when_data_manager_mode_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_text_preserve_mode(self) -> DataManager.TextPreserveMode:
                return DataManager.TextPreserveMode.OFF

        processor = TextProcessor(Config(), None)
        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )

        assert processor.get_re_suffix(False, Item.TextType.NONE) is None

    def test_pre_and_post_process_handles_mixed_multiline_scenario(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(
            src="  <b>one</b>  \n\n  two  ",
            name_src="Alice",
            text_type=Item.TextType.NONE,
        )
        snapshot = create_snapshot(text_preserve_mode=DataManager.TextPreserveMode.OFF)
        processor = TextProcessor(Config(), item, snapshot)

        monkeypatch.setattr(
            processor,
            "get_re_prefix",
            lambda custom, text_type: re.compile(r"^<[^>]+>"),
        )
        monkeypatch.setattr(
            processor,
            "get_re_suffix",
            lambda custom, text_type: re.compile(r"</[^>]+>$"),
        )
        monkeypatch.setattr(processor, "auto_fix", lambda src, dst: dst)
        monkeypatch.setattr(processor, "replace_post_translation", lambda dst: dst)

        processor.pre_process()

        assert processor.srcs == ["【Alice】one", "two"]
        assert processor.vaild_index == {0, 2}
        assert processor.prefix_codes == {0: ["<b>"], 2: []}
        assert processor.suffix_codes == {0: ["</b>"], 2: []}
        assert processor.leading_whitespace_by_line == {0: "  ", 2: "  "}
        assert processor.trailing_whitespace_by_line == {0: "  ", 2: "  "}

        name, result = processor.post_process(["【Alicia】uno", "dos"])

        assert name == "Alicia"
        assert result == "  <b>uno</b>  \n\n  dos  "

    def test_pre_and_post_process_applies_replacements_in_pipeline(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="  foo  \nbar", text_type=Item.TextType.NONE)
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.OFF,
            pre_replacement_enable=True,
            pre_replacement_entries=(
                {
                    "src": "foo",
                    "dst": "f1",
                    "regex": False,
                    "case_sensitive": False,
                },
            ),
            post_replacement_enable=True,
            post_replacement_entries=(
                {
                    "src": "u",
                    "dst": "U",
                    "regex": False,
                    "case_sensitive": True,
                },
            ),
        )
        processor = TextProcessor(Config(), item, snapshot)
        monkeypatch.setattr(processor, "auto_fix", lambda src, dst: f"{dst}u")

        processor.pre_process()

        assert processor.srcs == ["f1", "bar"]
        assert processor.vaild_index == {0, 1}

        _, result = processor.post_process(["a", "b"])

        assert result == "  aU  \nbU"

    def test_get_rule_returns_none_when_custom_data_is_none(self) -> None:
        pattern = TextProcessor.get_rule(
            custom=True,
            custom_data=None,
            rule_type=TextProcessor.RuleType.CHECK,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert pattern is None

    def test_get_rule_returns_none_when_preset_payload_is_not_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "module.TextProcessor.JSONTool.load_file", lambda path: {"src": "x"}
        )

        pattern = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert pattern is None

    def test_get_rule_ignores_non_dict_entries_in_preset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "module.TextProcessor.JSONTool.load_file",
            lambda path: ["x", {"src": "ab"}],
        )

        pattern = TextProcessor.get_rule(
            custom=False,
            custom_data=None,
            rule_type=TextProcessor.RuleType.SAMPLE,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert isinstance(pattern, re.Pattern)
        assert pattern.search("ab") is not None

    def test_get_rule_builds_prefix_pattern_for_custom_entries(self) -> None:
        pattern = TextProcessor.get_rule(
            custom=True,
            custom_data=("ab",),
            rule_type=TextProcessor.RuleType.PREFIX,
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert isinstance(pattern, re.Pattern)
        assert pattern.search("abz") is not None
        assert pattern.search("zab") is None

    def test_get_rule_returns_none_for_unknown_rule_type(self) -> None:
        pattern = TextProcessor.get_rule(
            custom=True,
            custom_data=("ab",),
            rule_type=cast(TextProcessor.RuleType, "UNKNOWN"),
            text_type=Item.TextType.NONE,
            language=BaseLanguage.Enum.ZH,
        )

        assert pattern is None

    def test_build_custom_preserve_data_skips_non_dict_entries(self) -> None:
        snapshot = create_snapshot(text_preserve_entries=({"src": "[A]"},))
        snapshot.text_preserve_entries = cast(
            tuple[dict[str, object], ...],
            ("invalid", {"src": "[A]"}, {"src": "[B]"}),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.build_custom_preserve_data() == ("[A]", "[B]")

    def test_get_re_check_uses_smart_mode_snapshot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.SMART
        )
        processor = TextProcessor(Config(), None, snapshot)
        captured: dict[str, object] = {}

        def fake_get_rule(
            *,
            custom: bool,
            custom_data: tuple[str, ...] | None,
            rule_type: TextProcessor.RuleType,
            text_type: Item.TextType,
            language: BaseLanguage.Enum,
        ) -> re.Pattern[str]:
            captured["custom"] = custom
            captured["custom_data"] = custom_data
            captured["rule_type"] = rule_type
            captured["text_type"] = text_type
            captured["language"] = language
            return re.compile(r"\[[^\]]+\]")

        monkeypatch.setattr(TextProcessor, "get_rule", fake_get_rule)

        pattern = processor.get_re_check(False, Item.TextType.NONE)

        assert isinstance(pattern, re.Pattern)
        assert captured["custom"] is False
        assert captured["custom_data"] is None
        assert captured["rule_type"] == TextProcessor.RuleType.CHECK
        assert captured["text_type"] == Item.TextType.NONE
        assert captured["language"] == BaseLanguage.Enum.ZH

    def test_get_re_suffix_uses_custom_mode_snapshot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.CUSTOM,
            text_preserve_entries=({"src": "[A]"},),
        )
        processor = TextProcessor(Config(), None, snapshot)
        captured: dict[str, object] = {}

        def fake_get_rule(
            *,
            custom: bool,
            custom_data: tuple[str, ...] | None,
            rule_type: TextProcessor.RuleType,
            text_type: Item.TextType,
            language: BaseLanguage.Enum,
        ) -> re.Pattern[str]:
            captured["custom"] = custom
            captured["custom_data"] = custom_data
            captured["rule_type"] = rule_type
            captured["text_type"] = text_type
            captured["language"] = language
            return re.compile(r".+")

        monkeypatch.setattr(TextProcessor, "get_rule", fake_get_rule)

        pattern = processor.get_re_suffix(False, Item.TextType.NONE)

        assert isinstance(pattern, re.Pattern)
        assert captured["custom"] is True
        assert captured["custom_data"] == ("[A]",)
        assert captured["rule_type"] == TextProcessor.RuleType.SUFFIX
        assert captured["text_type"] == Item.TextType.NONE
        assert captured["language"] == BaseLanguage.Enum.ZH

    def test_clean_ruby_enabled_and_missing_item_returns_original(self) -> None:
        processor = TextProcessor(Config(clean_ruby=True), None)

        assert processor.clean_ruby("hello") == "hello"

    def test_auto_fix_skips_language_specific_fixers_for_other_language(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="src", text_type=Item.TextType.NONE)
        processor = TextProcessor(
            Config(
                source_language=BaseLanguage.Enum.ZH,
                target_language=BaseLanguage.Enum.EN,
            ),
            item,
            create_snapshot(),
        )

        monkeypatch.setattr(
            "module.TextProcessor.KanaFixer.fix",
            lambda dst: pytest.fail(f"unexpected kana fixer call: {dst}"),
        )
        monkeypatch.setattr(
            "module.TextProcessor.HangeulFixer.fix",
            lambda dst: pytest.fail(f"unexpected hangeul fixer call: {dst}"),
        )
        monkeypatch.setattr(
            "module.TextProcessor.CodeFixer.fix",
            lambda src, dst, text_type, config, quality_snapshot: f"{dst}-c",
        )
        monkeypatch.setattr(
            "module.TextProcessor.EscapeFixer.fix", lambda src, dst: f"{dst}-e"
        )
        monkeypatch.setattr(
            "module.TextProcessor.NumberFixer.fix", lambda src, dst: f"{dst}-n"
        )
        monkeypatch.setattr(
            "module.TextProcessor.PunctuationFixer.fix",
            lambda src, dst, source_language, target_language: f"{dst}-p",
        )

        assert processor.auto_fix("src", "dst") == "dst-c-e-n-p"

    def test_extract_name_returns_early_when_item_is_none(self) -> None:
        processor = TextProcessor(Config(), None)

        name, srcs, dsts = processor.extract_name(["a"], ["b"], None)

        assert name is None
        assert srcs == ["a"]
        assert dsts == ["b"]

    def test_extract_name_keeps_text_when_group_value_is_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeMatch:
            def group(self, index: int) -> None:
                del index
                return None

        class FakePattern:
            def search(self, text: str) -> FakeMatch:
                del text
                return FakeMatch()

            def sub(self, pattern: str, text: str) -> str:
                del pattern
                return text

        item = Item(name_src="Alice")
        processor = TextProcessor(Config(), item)
        monkeypatch.setattr(TextProcessor, "RE_NAME", FakePattern())

        name, srcs, dsts = processor.extract_name(["【Alice】hello"], ["dst"], item)

        assert name is None
        assert srcs == ["【Alice】hello"]
        assert dsts == ["dst"]

    def test_replace_pre_translation_data_manager_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_pre_replacement_enable(self) -> bool:
                return False

            def get_pre_replacement(self) -> list[dict[str, object]]:
                return []

        processor = TextProcessor(Config(), None)
        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )

        assert processor.replace_pre_translation("abc") == "abc"

    def test_replace_pre_translation_data_manager_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_pre_replacement_enable(self) -> bool:
                return True

            def get_pre_replacement(self) -> list[dict[str, object]]:
                return [
                    {
                        "src": "foo",
                        "dst": "bar",
                        "regex": False,
                        "case_sensitive": True,
                    }
                ]

        processor = TextProcessor(Config(), None)
        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )

        assert processor.replace_pre_translation("foo") == "bar"

    def test_replace_pre_translation_handles_empty_pattern_and_none_replacement(
        self,
    ) -> None:
        snapshot = create_snapshot(
            pre_replacement_enable=True,
            pre_replacement_entries=(
                {
                    "src": "",
                    "dst": "ignored",
                    "regex": False,
                    "case_sensitive": True,
                },
                {
                    "src": "ABC",
                    "dst": None,
                    "regex": False,
                    "case_sensitive": True,
                },
            ),
        )
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.replace_pre_translation("ABC") == ""

    def test_replace_post_translation_data_manager_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_post_replacement_enable(self) -> bool:
                return False

            def get_post_replacement(self) -> list[dict[str, object]]:
                return []

        processor = TextProcessor(Config(), None)
        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )

        assert processor.replace_post_translation("abc") == "abc"

    def test_replace_post_translation_snapshot_disabled_returns_original(self) -> None:
        snapshot = create_snapshot(post_replacement_enable=False)
        processor = TextProcessor(Config(), None, snapshot)

        assert processor.replace_post_translation("abc") == "abc"

    def test_replace_post_translation_data_manager_casts_and_filters(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_post_replacement_enable(self) -> bool:
                return True

            def get_post_replacement(self) -> list[dict[str, object]]:
                return [
                    {
                        "src": None,
                        "dst": "ignored",
                        "regex": False,
                        "case_sensitive": True,
                    },
                    {
                        "src": "",
                        "dst": "ignored",
                        "regex": False,
                        "case_sensitive": True,
                    },
                    {"src": 123, "dst": 456, "regex": False, "case_sensitive": True},
                    {"src": "ABC", "dst": None, "regex": False, "case_sensitive": True},
                ]

        processor = TextProcessor(Config(), None)
        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )

        assert processor.replace_post_translation("123 ABC") == "456 "

    def test_replace_post_translation_data_manager_literal_ignore_case_escapes_regex(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_post_replacement_enable(self) -> bool:
                return True

            def get_post_replacement(self) -> list[dict[str, object]]:
                return [
                    {
                        "src": "a.b",
                        "dst": "x",
                        "regex": False,
                        "case_sensitive": False,
                    },
                ]

        processor = TextProcessor(Config(), None)
        monkeypatch.setattr(
            "module.TextProcessor.DataManager.get", lambda: FakeDataManager()
        )

        assert processor.replace_post_translation("A.B aXb") == "x aXb"

    def test_pre_process_returns_when_item_is_none(self) -> None:
        processor = TextProcessor(Config(), None)

        processor.pre_process()

        assert processor.srcs == []
        assert processor.samples == []
        assert processor.vaild_index == set()

    def test_pre_process_skips_line_when_prefix_suffix_consumes_all_text(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="<b></b>\n[a]", text_type=Item.TextType.NONE)
        snapshot = create_snapshot(text_preserve_mode=DataManager.TextPreserveMode.OFF)
        processor = TextProcessor(Config(), item, snapshot)

        monkeypatch.setattr(
            processor,
            "get_re_prefix",
            lambda custom, text_type: re.compile(r"^<[^>]+>"),
        )
        monkeypatch.setattr(
            processor,
            "get_re_suffix",
            lambda custom, text_type: re.compile(r"</[^>]+>$"),
        )
        monkeypatch.setattr(
            processor,
            "get_re_sample",
            lambda custom, text_type: re.compile(r"\[[^\]]+\]"),
        )

        processor.pre_process()

        assert processor.srcs == ["[a]"]
        assert processor.vaild_index == {1}
        assert processor.samples == ["[a]"]
