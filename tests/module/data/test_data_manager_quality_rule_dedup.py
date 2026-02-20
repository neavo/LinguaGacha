from unittest.mock import MagicMock

from module.Data.DataManager import DataManager
from module.Data.LGDatabase import LGDatabase


def build_data_manager() -> DataManager:
    # 避免触发 DataManager.__init__ 的事件订阅与完整依赖，这里只构造写入口需要的最小字段。
    dm = DataManager.__new__(DataManager)
    dm.rule_service = MagicMock()
    dm.emit_quality_rule_update = MagicMock()
    return dm


def test_set_glossary_dedupes_casefold_and_drops_empty_src() -> None:
    dm = build_data_manager()

    dm.set_glossary(
        [
            {"src": "HP", "dst": "a", "info": "", "case_sensitive": False},
            {"src": " hp ", "dst": "b", "info": "", "case_sensitive": False},
            {"src": "   ", "dst": "x"},
        ]
    )

    rule_type, saved, save = dm.rule_service.set_rules_cached.call_args[0]
    assert rule_type == LGDatabase.RuleType.GLOSSARY
    assert save is True
    assert len(saved) == 1
    assert saved[0]["src"].casefold() == "hp"
    assert saved[0]["dst"] == "b"
    assert all(str(v.get("src", "")).strip() for v in saved)


def test_set_pre_replacement_dedupes_casefold_even_when_regex_differs() -> None:
    dm = build_data_manager()

    dm.set_pre_replacement(
        [
            {
                "src": "ABC",
                "dst": "1",
                "regex": False,
                "case_sensitive": False,
            },
            {
                "src": "abc",
                "dst": "2",
                "regex": True,
                "case_sensitive": False,
            },
        ]
    )

    rule_type, saved, save = dm.rule_service.set_rules_cached.call_args[0]
    assert rule_type == LGDatabase.RuleType.PRE_REPLACEMENT
    assert save is True
    assert len(saved) == 1
    assert saved[0]["dst"] == "2"
    assert saved[0]["regex"] is True


def test_set_text_preserve_dedupes_by_casefold() -> None:
    dm = build_data_manager()

    dm.set_text_preserve(
        [
            {"src": "foo", "info": "a"},
            {"src": "FOO", "info": "b"},
        ]
    )

    rule_type, saved, save = dm.rule_service.set_rules_cached.call_args[0]
    assert rule_type == LGDatabase.RuleType.TEXT_PRESERVE
    assert save is True
    assert len(saved) == 1
    assert saved[0]["src"].casefold() == "foo"
