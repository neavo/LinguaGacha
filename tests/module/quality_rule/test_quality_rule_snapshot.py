from types import SimpleNamespace

from module.Data.DataManager import DataManager
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


def test_capture_collects_rules_and_filters_empty_src(monkeypatch) -> None:
    fake_dm = SimpleNamespace(
        get_glossary_enable=lambda: True,
        get_text_preserve_mode=lambda: DataManager.TextPreserveMode.SMART,
        get_glossary=lambda: [{"src": "HP", "dst": "生命值"}, {"src": "  "}],
        get_text_preserve=lambda: [{"src": "<i>", "dst": "<i>"}],
        get_pre_replacement_enable=lambda: True,
        get_pre_replacement=lambda: [{"src": "A", "dst": "B"}],
        get_post_replacement_enable=lambda: True,
        get_post_replacement=lambda: [{"src": "B", "dst": "A"}],
        get_translation_prompt_enable=lambda: True,
        get_translation_prompt=lambda: "translation-prompt",
        get_analysis_prompt_enable=lambda: False,
        get_analysis_prompt=lambda: "",
    )
    monkeypatch.setattr(
        "module.QualityRule.QualityRuleSnapshot.DataManager.get", lambda: fake_dm
    )

    snapshot = QualityRuleSnapshot.capture()

    assert snapshot.glossary_enable is True
    assert snapshot.glossary_entries == [{"src": "HP", "dst": "生命值"}]
    assert tuple(snapshot.text_preserve_entries) == ({"src": "<i>", "dst": "<i>"},)
    assert snapshot.translation_prompt == "translation-prompt"


def test_get_glossary_entries_returns_tuple_snapshot() -> None:
    snapshot = QualityRuleSnapshot(
        glossary_enable=True,
        text_preserve_mode=DataManager.TextPreserveMode.SMART,
        text_preserve_entries=(),
        pre_replacement_enable=False,
        pre_replacement_entries=(),
        post_replacement_enable=False,
        post_replacement_entries=(),
        translation_prompt_enable=False,
        translation_prompt="",
        analysis_prompt_enable=False,
        analysis_prompt="",
        glossary_entries=[{"src": "HP", "dst": "生命值"}],
    )

    entries = snapshot.get_glossary_entries()

    assert entries == ({"src": "HP", "dst": "生命值"},)
    snapshot.glossary_entries.append({"src": "MP", "dst": "魔力"})
    assert entries == ({"src": "HP", "dst": "生命值"},)
