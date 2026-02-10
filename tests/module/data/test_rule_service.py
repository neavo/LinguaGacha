import json
from pathlib import Path
from types import SimpleNamespace
import threading
from unittest.mock import MagicMock

import pytest

from module.Config import Config
from module.Data.LGDatabase import LGDatabase
from module.Data.RuleService import RuleService


def build_service(db: object | None) -> tuple[RuleService, SimpleNamespace]:
    session = SimpleNamespace(
        state_lock=threading.RLock(),
        db=db,
        rule_cache={},
        rule_text_cache={},
    )
    return RuleService(session), session


def test_get_and_set_rules_cache_behavior() -> None:
    db = SimpleNamespace(
        get_rules=MagicMock(return_value=[{"src": "HP", "dst": "生命值"}]),
        set_rules=MagicMock(),
    )
    service, session = build_service(db)

    first = service.get_rules_cached(LGDatabase.RuleType.GLOSSARY)
    second = service.get_rules_cached(LGDatabase.RuleType.GLOSSARY)
    assert first == second == [{"src": "HP", "dst": "生命值"}]
    assert db.get_rules.call_count == 1

    session.rule_text_cache[LGDatabase.RuleType.GLOSSARY] = "cached"
    service.set_rules_cached(LGDatabase.RuleType.GLOSSARY, [{"src": "A", "dst": "甲"}])
    db.set_rules.assert_called_once()
    assert LGDatabase.RuleType.GLOSSARY not in session.rule_text_cache


def test_get_and_set_rule_text_cache_behavior() -> None:
    db = SimpleNamespace(
        get_rule_text=MagicMock(return_value="prompt"),
        set_rule_text=MagicMock(),
    )
    service, session = build_service(db)

    assert (
        service.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH) == "prompt"
    )
    assert (
        service.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH) == "prompt"
    )
    assert db.get_rule_text.call_count == 1

    session.rule_cache[LGDatabase.RuleType.CUSTOM_PROMPT_ZH] = [{"src": "A"}]
    service.set_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, "new")
    db.set_rule_text.assert_called_once_with(
        LGDatabase.RuleType.CUSTOM_PROMPT_ZH, "new"
    )
    assert LGDatabase.RuleType.CUSTOM_PROMPT_ZH not in session.rule_cache


def test_initialize_project_rules_loads_all_available_presets(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    root_path = Path("/workspace/rule_service")
    root_path.mkdir(parents=True, exist_ok=True)
    glossary = root_path / "glossary.json"
    text_preserve = root_path / "preserve.json"
    pre_replace = root_path / "pre.json"
    post_replace = root_path / "post.json"
    custom_zh = root_path / "zh.txt"
    custom_en = root_path / "en.txt"

    glossary.write_text(json.dumps([{"src": "A", "dst": "甲"}]), encoding="utf-8")
    text_preserve.write_text(
        json.dumps([{"src": "<i>", "dst": "<i>"}]), encoding="utf-8"
    )
    pre_replace.write_text(json.dumps([{"src": "A", "dst": "B"}]), encoding="utf-8")
    post_replace.write_text(json.dumps([{"src": "B", "dst": "A"}]), encoding="utf-8")
    custom_zh.write_text("中文提示词", encoding="utf-8")
    custom_en.write_text("English prompt", encoding="utf-8")

    config = Config(
        glossary_default_preset=str(glossary),
        text_preserve_default_preset=str(text_preserve),
        pre_translation_replacement_default_preset=str(pre_replace),
        post_translation_replacement_default_preset=str(post_replace),
        custom_prompt_zh_default_preset=str(custom_zh),
        custom_prompt_en_default_preset=str(custom_en),
    )
    monkeypatch.setattr("module.Data.RuleService.Config.load", lambda self: config)
    monkeypatch.setattr(
        "module.Data.RuleService.Localizer.get",
        lambda: SimpleNamespace(
            app_glossary_page="术语表",
            app_text_preserve_page="文本保护",
            app_pre_translation_replacement_page="译前替换",
            app_post_translation_replacement_page="译后替换",
            app_custom_prompt_zh_page="自定义提示词-中文",
            app_custom_prompt_en_page="自定义提示词-英文",
        ),
    )

    db = MagicMock()
    service, _ = build_service(db)

    loaded = service.initialize_project_rules(db)

    assert loaded == [
        "术语表",
        "文本保护",
        "译前替换",
        "译后替换",
        "自定义提示词-中文",
        "自定义提示词-英文",
    ]
    db.set_meta.assert_any_call("text_preserve_mode", "smart")
    db.set_meta.assert_any_call("text_preserve_mode", "custom")
    db.set_rule_text.assert_any_call(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, "中文提示词")


def test_initialize_project_rules_skips_invalid_preset_and_continues(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    root_path = Path("/workspace/rule_service")
    root_path.mkdir(parents=True, exist_ok=True)
    valid = root_path / "valid.json"
    broken = root_path / "broken.json"
    valid.write_text(json.dumps([{"src": "HP", "dst": "生命值"}]), encoding="utf-8")
    broken.write_text("not-json", encoding="utf-8")

    config = Config(
        glossary_default_preset=str(valid),
        text_preserve_default_preset=str(broken),
    )
    monkeypatch.setattr("module.Data.RuleService.Config.load", lambda self: config)
    monkeypatch.setattr(
        "module.Data.RuleService.Localizer.get",
        lambda: SimpleNamespace(
            app_glossary_page="术语表",
            app_text_preserve_page="文本保护",
            app_pre_translation_replacement_page="译前替换",
            app_post_translation_replacement_page="译后替换",
            app_custom_prompt_zh_page="自定义提示词-中文",
            app_custom_prompt_en_page="自定义提示词-英文",
        ),
    )

    logger = MagicMock()
    monkeypatch.setattr("module.Data.RuleService.LogManager.get", lambda: logger)

    db = MagicMock()
    service, _ = build_service(db)
    loaded = service.initialize_project_rules(db)

    assert loaded == ["术语表"]
    assert logger.error.call_count == 1
