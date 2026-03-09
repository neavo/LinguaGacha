from dataclasses import dataclass
from pathlib import Path
from typing import Any
from typing import cast

import pytest

from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.PromptResourceResolver import PromptResourceResolver


@dataclass
class FakeQualitySnapshot:
    glossary_enable: bool = False
    translation_prompt_enable: bool = False
    translation_prompt: str = ""
    analysis_prompt_enable: bool = False
    analysis_prompt: str = ""
    glossary_entries: tuple[dict[str, Any], ...] = ()

    def get_glossary_entries(self) -> tuple[dict[str, Any], ...]:
        return self.glossary_entries


@pytest.fixture(autouse=True)
def reset_prompt_builder_cache(request: pytest.FixtureRequest) -> None:
    PromptBuilder.reset()
    Localizer.set_app_language(BaseLanguage.Enum.ZH)
    request.addfinalizer(PromptBuilder.reset)
    request.addfinalizer(lambda: Localizer.set_app_language(BaseLanguage.Enum.ZH))


class TestPromptBuilder:
    def test_build_main_renders_target_language_when_source_language_is_all(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(lambda cls, language: "BASE {target_language}"),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )

        config = Config(
            source_language=BaseLanguage.ALL,
            target_language=BaseLanguage.Enum.EN,
            auto_glossary_enable=False,
            force_thinking_enable=False,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=False,
            analysis_prompt_enable=False,
        )

        result = PromptBuilder(
            config=config, quality_snapshot=cast(Any, snapshot)
        ).build_main()

        expected = (
            "PREFIX\n"
            + f"BASE {BaseLanguage.get_name_en(BaseLanguage.Enum.EN)}\n\n"
            + "SUFFIX"
        )
        assert result == expected
        assert "{source_language}" not in result
        assert "{target_language}" not in result

    def test_build_main_raises_when_target_language_is_all(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(lambda cls, language: "BASE {target_language}"),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )

        config = Config(
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.ALL,
            auto_glossary_enable=False,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=False,
            analysis_prompt_enable=False,
        )

        with pytest.raises(ValueError, match="target_language"):
            PromptBuilder(
                config=config, quality_snapshot=cast(Any, snapshot)
            ).build_main()

    def test_build_main_follows_ui_language_instead_of_target_language(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(
                lambda cls, language: f"BASE_LANG={language} TARGET={{target_language}}"
            ),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )

        result = PromptBuilder(
            config=Config(
                source_language=BaseLanguage.Enum.JA,
                target_language=BaseLanguage.Enum.ZH,
                auto_glossary_enable=False,
                force_thinking_enable=False,
            ),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        ).build_main()

        assert "BASE_LANG=EN TARGET=Chinese" in result

    def test_build_main_uses_custom_prompt_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder, "get_base", classmethod(lambda cls, language: "BASE")
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_suffix_glossary",
            classmethod(lambda cls, language: "GLOSSARY_SUFFIX"),
        )

        config = Config(
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.Enum.ZH,
            auto_glossary_enable=False,
            force_thinking_enable=False,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=True,
            translation_prompt="RULE: {target_language}",
        )

        result = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, snapshot),
        ).build_main()

        assert (
            result
            == f"PREFIX\nRULE: {BaseLanguage.get_name_zh(BaseLanguage.Enum.ZH)}\n\nSUFFIX"
        )

    def test_build_main_appends_thinking_block_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder, "get_base", classmethod(lambda cls, language: "BASE")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_suffix_thinking",
            classmethod(lambda cls, language: "THINKING"),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "OUTPUT")
        )

        config = Config(
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.Enum.ZH,
            auto_glossary_enable=False,
            force_thinking_enable=True,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=False,
            analysis_prompt_enable=False,
        )

        result = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, snapshot),
        ).build_main()

        assert result == "PREFIX\nBASE\n\nTHINKING\n\nOUTPUT"

    def test_build_glossary_respects_case_sensitive_flag(self) -> None:
        config = Config(target_language=BaseLanguage.Enum.ZH)
        snapshot = FakeQualitySnapshot(
            glossary_entries=(
                {"src": "ABC", "dst": "甲", "case_sensitive": True},
                {"src": "foo", "dst": "乙", "case_sensitive": False},
            )
        )

        result = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, snapshot),
        ).build_glossary(["abc foo"])

        assert "foo -> 乙" in result
        assert "ABC -> 甲" not in result

    def test_build_control_characters_samples_requires_instruction(self) -> None:
        config = Config(target_language=BaseLanguage.Enum.ZH)
        builder = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        assert builder.build_control_characters_samples("普通内容", ["<a>"]) == ""

        result = builder.build_control_characters_samples(
            "控制符必须原样保留", ["<a>", "<b>", "<a>", ""]
        )

        assert result.startswith("控制字符示例：\n")
        assert "<a>" in result
        assert "<b>" in result

    def test_build_inputs_returns_jsonline_block(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        config = Config(target_language=BaseLanguage.Enum.EN)
        builder = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        result = builder.build_inputs(["line-1", "line-2"])

        assert result.startswith("Input:\n```jsonline\n")
        assert '"0"' in result
        assert '"line-1"' in result

    def test_build_analysis_inputs_returns_plain_text_block(self) -> None:
        config = Config(target_language=BaseLanguage.Enum.ZH)
        builder = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        result = builder.build_analysis_inputs(["line-1", "line-2"])

        assert result == "输入：\nline-1\nline-2"

    def test_build_preceding_formats_by_language(self) -> None:
        zh_builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )
        en_builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.EN),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        precedings = [
            Item(src="line1\nline2"),
            Item(src="line3"),
        ]

        Localizer.set_app_language(BaseLanguage.Enum.ZH)
        zh_text = zh_builder.build_preceding(precedings)
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        en_text = en_builder.build_preceding(precedings)

        assert zh_text.startswith("参考上文：")
        assert "line1\\nline2" in zh_text
        assert en_text.startswith("Preceding Context:")

    def test_generate_prompt_includes_glossary_and_control_samples(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder,
            "build_main",
            lambda self: "控制符必须原样保留",
        )
        config = Config(target_language=BaseLanguage.Enum.ZH)
        snapshot = FakeQualitySnapshot(
            glossary_enable=True,
            glossary_entries=({"src": "HP", "dst": "生命值", "case_sensitive": False},),
        )
        builder = PromptBuilder(config=config, quality_snapshot=cast(Any, snapshot))

        messages, console_log = builder.generate_prompt(
            srcs=["HP is low"],
            samples=["<name>", "<name>", "<tag>"],
            precedings=[Item(src="history")],
        )

        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"

        system_content = messages[0]["content"]
        user_content = messages[1]["content"]

        assert system_content == "控制符必须原样保留"
        assert "参考上文：" not in system_content
        assert "术语表" not in system_content
        assert "控制字符示例：" not in system_content
        assert "输入：" not in system_content

        assert "参考上文：" in user_content
        assert "术语表" in user_content
        assert "控制字符示例：" in user_content
        assert "输入：" in user_content
        assert any("HP -> 生命值" in line for line in console_log)

    def test_generate_prompt_control_samples_only_gated_by_system_instruction(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(PromptBuilder, "build_main", lambda self: "普通内容")
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(Any, FakeQualitySnapshot(glossary_enable=False)),
        )

        messages, console_log = builder.generate_prompt(
            srcs=["这里提到控制符"],
            samples=["<a>"],
            precedings=[Item(src="控制符")],
        )

        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"

        user_content = messages[1]["content"]
        assert "控制字符示例" not in user_content
        assert not any("控制字符示例" in line for line in console_log)

    def test_generate_prompt_sakura_includes_glossary_when_enabled(self) -> None:
        config = Config(target_language=BaseLanguage.Enum.ZH)
        snapshot = FakeQualitySnapshot(
            glossary_enable=True,
            glossary_entries=({"src": "HP", "dst": "生命值", "case_sensitive": False},),
        )
        builder = PromptBuilder(config=config, quality_snapshot=cast(Any, snapshot))

        messages, console_log = builder.generate_prompt_sakura(["HPが足りない"])

        assert messages[0]["role"] == "system"
        assert "根据以下术语表" in messages[1]["content"]
        assert "HP->生命值" in console_log[0]

    def test_get_preset_prompt_files_read_and_cache_reset(
        self, fs, monkeypatch
    ) -> None:
        del fs
        root = Path("/workspace")
        zh_dir = root / "resource" / "translation_prompt" / "template" / "zh"
        en_dir = root / "resource" / "translation_prompt" / "template" / "en"
        zh_dir.mkdir(parents=True, exist_ok=True)
        en_dir.mkdir(parents=True, exist_ok=True)

        (zh_dir / "base.txt").write_text(" BASE ", encoding="utf-8-sig")
        (zh_dir / "prefix.txt").write_text("PREFIX", encoding="utf-8-sig")
        (zh_dir / "suffix.txt").write_text("SUFFIX", encoding="utf-8-sig")
        (zh_dir / "thinking.txt").write_text("THINKING_SUFFIX", encoding="utf-8-sig")
        (zh_dir / "suffix_glossary.txt").write_text(
            "GLOSSARY_SUFFIX", encoding="utf-8-sig"
        )

        (en_dir / "base.txt").write_text("BASE_EN", encoding="utf-8-sig")
        (en_dir / "prefix.txt").write_text("PREFIX_EN", encoding="utf-8-sig")
        (en_dir / "suffix.txt").write_text("SUFFIX_EN", encoding="utf-8-sig")
        (en_dir / "thinking.txt").write_text("THINKING_SUFFIX_EN", encoding="utf-8-sig")
        (en_dir / "suffix_glossary.txt").write_text(
            "GLOSSARY_SUFFIX_EN", encoding="utf-8-sig"
        )

        monkeypatch.chdir(str(root))

        assert PromptBuilder.get_base(BaseLanguage.Enum.ZH) == "BASE"
        assert PromptBuilder.get_prefix(BaseLanguage.Enum.ZH) == "PREFIX"
        assert PromptBuilder.get_suffix(BaseLanguage.Enum.ZH) == "SUFFIX"
        assert (
            PromptBuilder.get_suffix_thinking(BaseLanguage.Enum.ZH) == "THINKING_SUFFIX"
        )
        assert (
            PromptBuilder.get_suffix_glossary(BaseLanguage.Enum.ZH) == "GLOSSARY_SUFFIX"
        )

        # lru_cache: 未 reset 前应保持旧内容
        (zh_dir / "base.txt").write_text("BASE2", encoding="utf-8-sig")
        (zh_dir / "thinking.txt").write_text("THINKING_SUFFIX_2", encoding="utf-8-sig")
        assert PromptBuilder.get_base(BaseLanguage.Enum.ZH) == "BASE"
        assert (
            PromptBuilder.get_suffix_thinking(BaseLanguage.Enum.ZH) == "THINKING_SUFFIX"
        )

        PromptBuilder.reset()
        assert PromptBuilder.get_base(BaseLanguage.Enum.ZH) == "BASE2"
        assert (
            PromptBuilder.get_suffix_thinking(BaseLanguage.Enum.ZH)
            == "THINKING_SUFFIX_2"
        )

    def test_build_glossary_analysis_main_reads_prompt_glossary_dir(
        self, fs, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        root = Path("/workspace")
        prompt_dir = root / "resource" / "translation_prompt" / "template" / "zh"
        analysis_dir = root / "resource" / "analysis_prompt" / "template" / "zh"
        prompt_dir.mkdir(parents=True, exist_ok=True)
        analysis_dir.mkdir(parents=True, exist_ok=True)

        (prompt_dir / "prefix.txt").write_text(
            "TRANSLATION_PREFIX", encoding="utf-8-sig"
        )
        (prompt_dir / "base.txt").write_text("TRANSLATION_BASE", encoding="utf-8-sig")
        (prompt_dir / "suffix.txt").write_text(
            "TRANSLATION_SUFFIX", encoding="utf-8-sig"
        )

        (analysis_dir / "prefix.txt").write_text(
            "ANALYSIS_PREFIX", encoding="utf-8-sig"
        )
        (analysis_dir / "base.txt").write_text("ANALYSIS_BASE", encoding="utf-8-sig")
        (analysis_dir / "thinking.txt").write_text(
            "ANALYSIS_THINKING", encoding="utf-8-sig"
        )
        (analysis_dir / "suffix.txt").write_text(
            "ANALYSIS_SUFFIX {target_language}",
            encoding="utf-8-sig",
        )

        monkeypatch.chdir(str(root))

        builder = PromptBuilder(
            config=Config(
                target_language=BaseLanguage.Enum.ZH,
                force_thinking_enable=False,
            ),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        result = builder.build_glossary_analysis_main()

        assert result == "ANALYSIS_PREFIX\nANALYSIS_BASE\n\nANALYSIS_SUFFIX 中文"
        assert "TRANSLATION_PREFIX" not in result

    def test_build_glossary_analysis_main_appends_thinking_block_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_prefix",
            classmethod(lambda cls, language: "ANALYSIS_PREFIX"),
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_base",
            classmethod(lambda cls, language: "ANALYSIS_BASE"),
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_thinking",
            classmethod(lambda cls, language: "ANALYSIS_THINKING"),
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_suffix",
            classmethod(lambda cls, language: "ANALYSIS_OUTPUT"),
        )

        result = PromptBuilder(
            config=Config(
                target_language=BaseLanguage.Enum.ZH,
                force_thinking_enable=True,
            ),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        ).build_glossary_analysis_main()

        assert (
            result
            == "ANALYSIS_PREFIX\nANALYSIS_BASE\n\nANALYSIS_THINKING\n\nANALYSIS_OUTPUT"
        )

    def test_generate_glossary_prompt_only_contains_plain_text_inputs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder,
            "build_glossary_analysis_main",
            lambda self: "ANALYSIS_MAIN",
        )
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(
                Any,
                FakeQualitySnapshot(
                    glossary_enable=False,
                    glossary_entries=(
                        {
                            "src": "魔导具",
                            "dst": "魔导器",
                            "case_sensitive": False,
                            "info": "特殊物品",
                        },
                    ),
                ),
            ),
        )

        messages, console_log = builder.generate_glossary_prompt(
            srcs=["魔导具正在发光"],
        )

        assert messages[0] == {"role": "system", "content": "ANALYSIS_MAIN"}
        assert "输入：" in messages[1]["content"]
        assert "魔导具正在发光" in messages[1]["content"]
        assert "参考上文：" not in messages[1]["content"]
        assert "术语表" not in messages[1]["content"]
        assert "```jsonline" not in messages[1]["content"]
        assert console_log == []

    def test_build_glossary_analysis_main_uses_analysis_prompt_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_prefix",
            classmethod(lambda cls, language: "ANALYSIS_PREFIX"),
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_base",
            classmethod(lambda cls, language: "ANALYSIS_BASE"),
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_thinking",
            classmethod(lambda cls, language: "ANALYSIS_THINKING"),
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_analysis_suffix",
            classmethod(lambda cls, language: "ANALYSIS_SUFFIX"),
        )

        result = PromptBuilder(
            config=Config(
                target_language=BaseLanguage.Enum.ZH,
                force_thinking_enable=False,
            ),
            quality_snapshot=cast(
                Any,
                FakeQualitySnapshot(
                    analysis_prompt_enable=True,
                    analysis_prompt="CUSTOM_ANALYSIS",
                ),
            ),
        ).build_glossary_analysis_main()

        assert result == "ANALYSIS_PREFIX\nCUSTOM_ANALYSIS\n\nANALYSIS_SUFFIX"

    def test_get_analysis_prompt_files_read_and_cache_reset(
        self, fs, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        del fs
        root = Path("/workspace")
        analysis_dir = root / "resource" / "analysis_prompt" / "template" / "zh"
        analysis_dir.mkdir(parents=True, exist_ok=True)

        (analysis_dir / "base.txt").write_text("ANALYSIS_BASE", encoding="utf-8-sig")
        (analysis_dir / "prefix.txt").write_text(
            "ANALYSIS_PREFIX", encoding="utf-8-sig"
        )
        (analysis_dir / "thinking.txt").write_text(
            "ANALYSIS_THINKING", encoding="utf-8-sig"
        )
        (analysis_dir / "suffix.txt").write_text(
            "ANALYSIS_SUFFIX", encoding="utf-8-sig"
        )

        monkeypatch.chdir(str(root))

        assert PromptBuilder.get_analysis_base(BaseLanguage.Enum.ZH) == "ANALYSIS_BASE"
        assert (
            PromptBuilder.get_analysis_prefix(BaseLanguage.Enum.ZH) == "ANALYSIS_PREFIX"
        )
        assert (
            PromptBuilder.get_analysis_thinking(BaseLanguage.Enum.ZH)
            == "ANALYSIS_THINKING"
        )
        assert (
            PromptBuilder.get_analysis_suffix(BaseLanguage.Enum.ZH) == "ANALYSIS_SUFFIX"
        )

        (analysis_dir / "thinking.txt").write_text(
            "ANALYSIS_THINKING_2", encoding="utf-8-sig"
        )
        assert (
            PromptBuilder.get_analysis_thinking(BaseLanguage.Enum.ZH)
            == "ANALYSIS_THINKING"
        )

        PromptBuilder.reset()
        assert (
            PromptBuilder.get_analysis_thinking(BaseLanguage.Enum.ZH)
            == "ANALYSIS_THINKING_2"
        )

    def test_custom_prompt_data_and_enable_use_data_manager_when_no_snapshot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_translation_prompt(self) -> str:
                return "TRANSLATION_PROMPT"

            def get_analysis_prompt(self) -> str:
                return "ANALYSIS_PROMPT"

            def get_translation_prompt_enable(self) -> bool:
                return True

            def get_analysis_prompt_enable(self) -> bool:
                return False

        monkeypatch.setattr(
            "module.PromptBuilder.DataManager.get", lambda: FakeDataManager()
        )

        builder = PromptBuilder(config=Config(), quality_snapshot=None)

        assert (
            builder.get_custom_prompt_data(PromptResourceResolver.TaskType.TRANSLATION)
            == "TRANSLATION_PROMPT"
        )
        assert (
            builder.get_custom_prompt_data(PromptResourceResolver.TaskType.ANALYSIS)
            == "ANALYSIS_PROMPT"
        )
        assert (
            builder.get_custom_prompt_enable(
                PromptResourceResolver.TaskType.TRANSLATION
            )
            is True
        )
        assert (
            builder.get_custom_prompt_enable(PromptResourceResolver.TaskType.ANALYSIS)
            is False
        )

    def test_build_main_uses_english_names_and_glossary_suffix(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(lambda cls, language: "BASE {target_language}"),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_suffix_glossary",
            classmethod(lambda cls, language: "GLOSSARY_SUFFIX"),
        )

        config = Config(
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.Enum.EN,
            auto_glossary_enable=True,
            force_thinking_enable=False,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=False,
            analysis_prompt_enable=False,
        )

        result = PromptBuilder(
            config=config, quality_snapshot=cast(Any, snapshot)
        ).build_main()

        expected = (
            "PREFIX\n"
            + f"BASE {BaseLanguage.get_name_en(BaseLanguage.Enum.EN)}\n\n"
            + "GLOSSARY_SUFFIX"
        )
        assert result == expected

    def test_build_preceding_returns_empty_when_no_items(self) -> None:
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )
        assert builder.build_preceding([]) == ""

    def test_build_glossary_formats_info_and_supports_english_header(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        config = Config(target_language=BaseLanguage.Enum.EN)
        snapshot = FakeQualitySnapshot(
            glossary_entries=(
                {
                    "src": "HP",
                    "dst": "Hit Points",
                    "case_sensitive": True,
                    "info": "stat",
                },
            )
        )
        builder = PromptBuilder(config=config, quality_snapshot=cast(Any, snapshot))

        assert builder.build_glossary(["hp"]) == ""

        result = builder.build_glossary(["HP is low"])
        assert result.startswith("Glossary")
        assert "HP -> Hit Points #stat" in result

    def test_generate_prompt_skips_glossary_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(PromptBuilder, "build_main", lambda self: "main")
        config = Config(target_language=BaseLanguage.Enum.ZH)
        snapshot = FakeQualitySnapshot(glossary_enable=False)
        builder = PromptBuilder(config=config, quality_snapshot=cast(Any, snapshot))

        messages, console_log = builder.generate_prompt(
            srcs=["HP is low"],
            samples=["<name>"],
            precedings=[],
        )

        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[0]["content"] == "main"

        user_content = messages[1]["content"]
        assert "术语表" not in user_content
        assert "控制字符示例" not in user_content
        assert "输入：" in user_content
        assert console_log == []

    def test_generate_prompt_uses_data_manager_glossary_when_no_snapshot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeDataManager:
            def get_glossary_enable(self) -> bool:
                return True

            def get_glossary(self) -> list[dict[str, Any]]:
                return [
                    {"src": "HP", "dst": "生命值", "case_sensitive": False, "info": ""}
                ]

        monkeypatch.setattr(
            "module.PromptBuilder.DataManager.get", lambda: FakeDataManager()
        )
        monkeypatch.setattr(PromptBuilder, "build_main", lambda self: "main")

        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH), quality_snapshot=None
        )
        messages, console_log = builder.generate_prompt(
            srcs=["HP is low"],
            samples=[],
            precedings=[],
        )

        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[0]["content"] == "main"

        user_content = messages[1]["content"]
        assert "术语表" in user_content
        assert any("HP -> 生命值" in line for line in console_log)

    def test_get_custom_prompt_data_from_snapshot_for_en(self) -> None:
        builder = PromptBuilder(
            config=Config(),
            quality_snapshot=cast(
                Any, FakeQualitySnapshot(translation_prompt="TRANSLATION_RULE")
            ),
        )

        assert (
            builder.get_custom_prompt_data(PromptResourceResolver.TaskType.TRANSLATION)
            == "TRANSLATION_RULE"
        )

    def test_build_main_uses_custom_prompt_for_english_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder, "get_base", classmethod(lambda cls, language: "BASE")
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )

        config = Config(
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.Enum.EN,
            auto_glossary_enable=False,
            force_thinking_enable=False,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=True,
            translation_prompt="RULE: {target_language}",
        )

        result = PromptBuilder(
            config=config, quality_snapshot=cast(Any, snapshot)
        ).build_main()

        assert (
            result
            == f"PREFIX\nRULE: {BaseLanguage.get_name_en(BaseLanguage.Enum.EN)}\n\nSUFFIX"
        )

    def test_build_main_uses_source_placeholder_for_zh_when_source_is_all(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(
                lambda cls, language: "BASE {source_language}->{target_language}"
            ),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )

        config = Config(
            source_language=BaseLanguage.ALL,
            target_language=BaseLanguage.Enum.ZH,
            auto_glossary_enable=False,
        )
        snapshot = FakeQualitySnapshot(
            translation_prompt_enable=False,
            analysis_prompt_enable=False,
        )

        result = PromptBuilder(
            config=config,
            quality_snapshot=cast(Any, snapshot),
        ).build_main()

        assert "BASE 原文->中文" in result

    def test_build_main_raises_when_target_language_is_invalid(self) -> None:
        builder = PromptBuilder(
            config=Config(target_language=cast(Any, "INVALID")),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        with pytest.raises(ValueError, match="invalid target_language"):
            builder.build_main()

    def test_build_main_falls_back_to_source_placeholder_when_source_name_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(
                lambda cls, language: "BASE {source_language}->{target_language}"
            ),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )
        monkeypatch.setattr(
            BaseLanguage,
            "get_name_zh",
            classmethod(
                lambda cls, language: "" if language == BaseLanguage.Enum.JA else "中文"
            ),
        )

        builder = PromptBuilder(
            config=Config(
                source_language=BaseLanguage.Enum.JA,
                target_language=BaseLanguage.Enum.ZH,
                auto_glossary_enable=False,
            ),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        assert "BASE 原文->中文" in builder.build_main()

    def test_build_main_raises_when_target_language_name_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        monkeypatch.setattr(
            PromptBuilder, "get_prefix", classmethod(lambda cls, language: "PREFIX")
        )
        monkeypatch.setattr(
            PromptBuilder,
            "get_base",
            classmethod(
                lambda cls, language: "BASE {source_language}->{target_language}"
            ),
        )
        monkeypatch.setattr(
            PromptBuilder, "get_suffix", classmethod(lambda cls, language: "SUFFIX")
        )
        monkeypatch.setattr(
            BaseLanguage,
            "get_name_en",
            classmethod(
                lambda cls, language: (
                    "Japanese" if language == BaseLanguage.Enum.JA else ""
                )
            ),
        )

        builder = PromptBuilder(
            config=Config(
                source_language=BaseLanguage.Enum.JA,
                target_language=BaseLanguage.Enum.EN,
                auto_glossary_enable=False,
            ),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        with pytest.raises(ValueError, match="invalid target_language"):
            builder.build_main()

    def test_build_glossary_sakura_supports_case_sensitive_and_info_format(
        self,
    ) -> None:
        config = Config(target_language=BaseLanguage.Enum.ZH)
        snapshot = FakeQualitySnapshot(
            glossary_entries=(
                {"src": "HP", "dst": "生命值", "case_sensitive": True, "info": "stat"},
            )
        )
        builder = PromptBuilder(config=config, quality_snapshot=cast(Any, snapshot))

        assert builder.build_glossary_sakura(["hp", "HP"]) == "HP->生命值 #stat"

    def test_build_glossary_sakura_returns_empty_when_no_match(self) -> None:
        config = Config(target_language=BaseLanguage.Enum.ZH)
        snapshot = FakeQualitySnapshot(
            glossary_entries=({"src": "HP", "dst": "生命值", "case_sensitive": False},)
        )
        builder = PromptBuilder(config=config, quality_snapshot=cast(Any, snapshot))

        assert builder.build_glossary_sakura(["no match here"]) == ""

    def test_build_glossary_returns_empty_when_case_insensitive_term_not_matched(
        self,
    ) -> None:
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(
                Any,
                FakeQualitySnapshot(
                    glossary_entries=(
                        {
                            "src": "HP",
                            "dst": "生命值",
                            "case_sensitive": False,
                        },
                    )
                ),
            ),
        )

        assert builder.build_glossary(["no match"]) == ""

    def test_build_glossary_sakura_returns_empty_when_case_sensitive_term_not_matched(
        self,
    ) -> None:
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(
                Any,
                FakeQualitySnapshot(
                    glossary_entries=(
                        {"src": "HP", "dst": "生命值", "case_sensitive": True},
                    )
                ),
            ),
        )

        assert builder.build_glossary_sakura(["hp"]) == ""

    def test_generate_prompt_skips_empty_glossary_and_empty_inputs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(PromptBuilder, "build_main", lambda self: "main")
        monkeypatch.setattr(PromptBuilder, "build_glossary", lambda self, srcs: "")
        monkeypatch.setattr(PromptBuilder, "build_inputs", lambda self, srcs: "")

        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(Any, FakeQualitySnapshot(glossary_enable=True)),
        )

        messages, console_log = builder.generate_prompt(
            srcs=["HP is low"],
            samples=[],
            precedings=[],
        )

        assert messages == [
            {"role": "system", "content": "main"},
            {"role": "user", "content": ""},
        ]
        assert console_log == []

    def test_generate_prompt_sakura_uses_default_content_when_glossary_enabled_but_empty(
        self,
    ) -> None:
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(
                Any,
                FakeQualitySnapshot(
                    glossary_enable=True,
                    glossary_entries=(
                        {"src": "HP", "dst": "生命值", "case_sensitive": True},
                    ),
                ),
            ),
        )

        messages, console_log = builder.generate_prompt_sakura(["hp が足りない"])

        assert "根据以下术语表" not in messages[1]["content"]
        assert messages[1]["content"].startswith("将下面的日文文本翻译成中文：")
        assert console_log == []

    def test_generate_prompt_sakura_skips_glossary_when_disabled(self) -> None:
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.ZH),
            quality_snapshot=cast(Any, FakeQualitySnapshot(glossary_enable=False)),
        )

        messages, console_log = builder.generate_prompt_sakura(["HPが足りない"])

        assert "根据以下术语表" not in messages[1]["content"]
        assert messages[1]["content"].startswith("将下面的日文文本翻译成中文：")
        assert console_log == []

    def test_build_control_characters_samples_uses_english_prefix(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        builder = PromptBuilder(
            config=Config(target_language=BaseLanguage.Enum.EN),
            quality_snapshot=cast(Any, FakeQualitySnapshot()),
        )

        result = builder.build_control_characters_samples(
            "control codes must be kept exactly as-is",
            ["<a>", "<a>", "<b>"],
        )

        assert result.startswith("Control Characters Samples:\n")
        assert "<a>" in result
        assert "<b>" in result
