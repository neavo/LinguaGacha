from types import SimpleNamespace
from typing import Any
from typing import cast

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
        get_custom_prompt_zh_enable=lambda: True,
        get_custom_prompt_zh=lambda: "zh-prompt",
        get_custom_prompt_en_enable=lambda: False,
        get_custom_prompt_en=lambda: "",
    )
    monkeypatch.setattr(
        "module.QualityRule.QualityRuleSnapshot.DataManager.get", lambda: fake_dm
    )

    snapshot = QualityRuleSnapshot.capture()

    assert snapshot.glossary_enable is True
    assert snapshot.glossary_entries == [{"src": "HP", "dst": "生命值"}]
    assert snapshot.glossary_src_set == {"HP"}
    assert tuple(snapshot.text_preserve_entries) == ({"src": "<i>", "dst": "<i>"},)
    assert snapshot.custom_prompt_zh == "zh-prompt"


def test_merge_glossary_entries_filters_invalid_and_deduplicates() -> None:
    snapshot = QualityRuleSnapshot(
        glossary_enable=True,
        text_preserve_mode=DataManager.TextPreserveMode.SMART,
        text_preserve_entries=(),
        pre_replacement_enable=False,
        pre_replacement_entries=(),
        post_replacement_enable=False,
        post_replacement_entries=(),
        custom_prompt_zh_enable=False,
        custom_prompt_zh="",
        custom_prompt_en_enable=False,
        custom_prompt_en="",
        glossary_entries=[{"src": "HP", "dst": "生命值", "info": ""}],
        glossary_src_set={"HP"},
    )

    incoming = cast(
        list[dict[str, Any]],
        [
            {"src": "HP", "dst": "duplicate"},
            {"src": "MP", "dst": "魔力", "info": "mana", "case_sensitive": 1},
            {"src": "", "dst": "skip"},
            "bad",
        ],
    )

    added = snapshot.merge_glossary_entries(incoming)

    assert added == [
        {
            "src": "MP",
            "dst": "魔力",
            "info": "mana",
            "case_sensitive": True,
        }
    ]
    assert len(snapshot.glossary_entries) == 2


def test_merge_glossary_entries_returns_empty_when_disabled() -> None:
    snapshot = QualityRuleSnapshot(
        glossary_enable=False,
        text_preserve_mode=DataManager.TextPreserveMode.SMART,
        text_preserve_entries=(),
        pre_replacement_enable=False,
        pre_replacement_entries=(),
        post_replacement_enable=False,
        post_replacement_entries=(),
        custom_prompt_zh_enable=False,
        custom_prompt_zh="",
        custom_prompt_en_enable=False,
        custom_prompt_en="",
        glossary_entries=[],
    )

    assert snapshot.merge_glossary_entries([{"src": "HP", "dst": "生命值"}]) == []


def test_get_glossary_entries_returns_tuple_snapshot() -> None:
    snapshot = QualityRuleSnapshot(
        glossary_enable=True,
        text_preserve_mode=DataManager.TextPreserveMode.SMART,
        text_preserve_entries=(),
        pre_replacement_enable=False,
        pre_replacement_entries=(),
        post_replacement_enable=False,
        post_replacement_entries=(),
        custom_prompt_zh_enable=False,
        custom_prompt_zh="",
        custom_prompt_en_enable=False,
        custom_prompt_en="",
        glossary_entries=[{"src": "HP", "dst": "生命值"}],
        glossary_src_set={"HP"},
    )

    entries = snapshot.get_glossary_entries()

    assert entries == ({"src": "HP", "dst": "生命值"},)
    snapshot.glossary_entries.append({"src": "MP", "dst": "魔力"})
    assert entries == ({"src": "HP", "dst": "生命值"},)


def test_merge_glossary_entries_returns_empty_when_incoming_is_empty() -> None:
    snapshot = QualityRuleSnapshot(
        glossary_enable=True,
        text_preserve_mode=DataManager.TextPreserveMode.SMART,
        text_preserve_entries=(),
        pre_replacement_enable=False,
        pre_replacement_entries=(),
        post_replacement_enable=False,
        post_replacement_entries=(),
        custom_prompt_zh_enable=False,
        custom_prompt_zh="",
        custom_prompt_en_enable=False,
        custom_prompt_en="",
        glossary_entries=[{"src": "HP", "dst": "生命值"}],
        glossary_src_set={"HP"},
    )

    added = snapshot.merge_glossary_entries([])

    assert added == []
    assert snapshot.glossary_entries == [{"src": "HP", "dst": "生命值"}]
