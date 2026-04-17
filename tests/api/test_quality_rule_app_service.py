from __future__ import annotations

from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock

from api.Application.QualityRuleAppService import QualityRuleAppService
from base.BaseLanguage import BaseLanguage
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot

quality_rule_app_service_module = import_module(
    "api.Application.QualityRuleAppService"
)


def build_fake_quality_rule_facade() -> SimpleNamespace:
    """构造最小质量规则门面桩，方便固定 app service 契约。"""

    snapshot = {
        "rule_type": "glossary",
        "revision": 3,
        "meta": {"enabled": True},
        "statistics": {
            "available": False,
            "results": {},
        },
        "entries": [
            {
                "entry_id": "glossary:0",
                "src": "勇者",
                "dst": "Hero",
                "info": "",
                "regex": False,
                "case_sensitive": False,
            }
        ],
    }
    return SimpleNamespace(
        get_rule_snapshot=MagicMock(return_value=snapshot),
        save_entries=MagicMock(return_value=dict(snapshot)),
        set_rule_enabled=MagicMock(return_value=dict(snapshot)),
        update_meta=MagicMock(return_value=dict(snapshot)),
        import_rules=MagicMock(return_value=dict(snapshot)),
        export_rules=MagicMock(return_value="demo/export/glossary.json"),
        list_presets=MagicMock(
            return_value=(
                [
                    {
                        "name": "内置预设",
                        "virtual_id": "builtin:demo.json",
                        "path": "resource/demo.json",
                        "type": "builtin",
                    }
                ],
                [
                    {
                        "name": "用户预设",
                        "virtual_id": "user:demo.json",
                        "path": "user/demo.json",
                        "type": "user",
                    }
                ],
            )
        ),
        read_preset=MagicMock(return_value=[{"src": "勇者", "dst": "Hero"}]),
        save_user_preset=MagicMock(
            return_value={
                "name": "我的预设",
                "virtual_id": "user:mine.json",
                "path": "user/mine.json",
                "type": "user",
            }
        ),
        rename_user_preset=MagicMock(
            return_value={
                "name": "新预设",
                "virtual_id": "user:new.json",
                "path": "user/new.json",
                "type": "user",
            }
        ),
        delete_user_preset=MagicMock(return_value="user/demo.json"),
    )


def test_get_quality_rule_snapshot_returns_payload() -> None:
    app_service = QualityRuleAppService(build_fake_quality_rule_facade())

    result = app_service.get_rule_snapshot({"rule_type": "glossary"})
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])

    assert snapshot.rule_type == "glossary"
    assert snapshot.revision == 3
    assert snapshot.entries[0].src == "勇者"


def test_update_quality_rule_meta_routes_enabled_toggle_to_core_service() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.update_rule_meta(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "meta": {"enabled": False},
        }
    )

    facade.set_rule_enabled.assert_called_once_with(
        "glossary",
        expected_revision=3,
        enabled=False,
    )
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])
    assert snapshot.rule_type == "glossary"


def test_update_quality_rule_meta_maps_text_preserve_mode_to_core_key() -> None:
    facade = build_fake_quality_rule_facade()
    facade.update_meta.return_value = {
        "rule_type": "text_preserve",
        "revision": 2,
        "meta": {"mode": "SMART"},
        "statistics": {"available": False, "results": {}},
        "entries": [],
    }
    app_service = QualityRuleAppService(facade)

    result = app_service.update_rule_meta(
        {
            "rule_type": "text_preserve",
            "expected_revision": 2,
            "meta": {"mode": "SMART"},
        }
    )

    facade.update_meta.assert_called_once_with(
        "text_preserve",
        expected_revision=2,
        meta_key="text_preserve_mode",
        value="SMART",
    )
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])
    assert snapshot.meta["mode"] == "SMART"


def test_save_quality_rule_entries_returns_snapshot_payload() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.save_rule_entries(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "entries": [{"src": "勇者", "dst": "Hero"}],
        }
    )

    facade.save_entries.assert_called_once_with(
        "glossary",
        expected_revision=3,
        entries=[{"src": "勇者", "dst": "Hero"}],
    )
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])
    assert snapshot.entries[0].dst == "Hero"


def test_query_proofreading_returns_lookup_query() -> None:
    app_service = QualityRuleAppService(build_fake_quality_rule_facade())

    result = app_service.query_proofreading({"entry": {"src": "^勇者$", "regex": True}})
    query = ProofreadingLookupQuery.from_dict(result["query"])

    assert query.keyword == "^勇者$"
    assert query.is_regex is True


def test_query_proofreading_for_text_preserve_forces_regex_lookup() -> None:
    app_service = QualityRuleAppService(build_fake_quality_rule_facade())

    result = app_service.query_proofreading(
        {
            "rule_type": "text_preserve",
            "entry": {"src": "[勇者]"},
        }
    )
    query = ProofreadingLookupQuery.from_dict(result["query"])

    assert query.keyword == "[勇者]"
    assert query.is_regex is True


def test_get_prompt_template_uses_current_localizer_language(
    monkeypatch,
) -> None:
    app_service = QualityRuleAppService(build_fake_quality_rule_facade())

    monkeypatch.setattr(
        quality_rule_app_service_module.Config,
        "load",
        lambda config: config,
    )
    monkeypatch.setattr(
        quality_rule_app_service_module.PromptBuilder,
        "get_prompt_ui_language",
        lambda builder: BaseLanguage.Enum.EN,
    )
    monkeypatch.setattr(
        quality_rule_app_service_module.PromptBuilder,
        "get_base",
        lambda builder, language: f"base:{language}",
    )
    monkeypatch.setattr(
        quality_rule_app_service_module.PromptBuilder,
        "get_prefix",
        lambda builder, language: f"prefix:{language}",
    )
    monkeypatch.setattr(
        quality_rule_app_service_module.PromptBuilder,
        "get_suffix",
        lambda builder, language: f"suffix:{language}",
    )

    result = app_service.get_prompt_template(
        {
            "task_type": "translation",
            "app_language": "ZH",
        }
    )

    assert result["template"] == {
        "default_text": "base:EN",
        "prefix_text": "prefix:EN",
        "suffix_text": "suffix:EN",
    }


def test_import_rules_returns_entries_payload() -> None:
    facade = build_fake_quality_rule_facade()
    facade.import_rules.return_value = [{"src": "勇者", "dst": "Hero"}]
    app_service = QualityRuleAppService(facade)

    result = app_service.import_rules(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "path": "demo/input.json",
        }
    )

    facade.import_rules.assert_called_once_with(
        "glossary",
        "demo/input.json",
        expected_revision=3,
    )
    assert result["entries"] == [{"src": "勇者", "dst": "Hero"}]


def test_export_rules_returns_exported_path() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.export_rules(
        {
            "rule_type": "glossary",
            "path": "demo/output.json",
            "entries": [{"src": "勇者", "dst": "Hero"}],
        }
    )

    facade.export_rules.assert_called_once_with(
        "glossary",
        "demo/output.json",
        [{"src": "勇者", "dst": "Hero"}],
    )
    assert result["path"] == "demo/export/glossary.json"


def test_list_rule_presets_returns_items() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.list_rule_presets({"preset_dir_name": "glossary"})

    facade.list_presets.assert_called_once_with("glossary")
    assert result["builtin_presets"][0]["virtual_id"] == "builtin:demo.json"
    assert result["user_presets"][0]["virtual_id"] == "user:demo.json"


def test_read_rule_preset_returns_entries() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.read_rule_preset(
        {
            "preset_dir_name": "glossary",
            "virtual_id": "builtin:demo.json",
        }
    )

    facade.read_preset.assert_called_once_with("glossary", "builtin:demo.json")
    assert result["entries"] == [{"src": "勇者", "dst": "Hero"}]


def test_save_rule_preset_returns_item() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.save_rule_preset(
        {
            "preset_dir_name": "glossary",
            "name": "我的预设",
            "entries": [{"src": "勇者", "dst": "Hero"}],
        }
    )

    facade.save_user_preset.assert_called_once_with(
        "glossary",
        "我的预设",
        [{"src": "勇者", "dst": "Hero"}],
    )
    assert result["item"]["virtual_id"] == "user:mine.json"


def test_rename_rule_preset_returns_item() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.rename_rule_preset(
        {
            "preset_dir_name": "glossary",
            "virtual_id": "user:demo.json",
            "new_name": "新预设",
        }
    )

    facade.rename_user_preset.assert_called_once_with(
        "glossary",
        "user:demo.json",
        "新预设",
    )
    assert result["item"]["virtual_id"] == "user:new.json"


def test_delete_rule_preset_returns_deleted_path() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.delete_rule_preset(
        {
            "preset_dir_name": "glossary",
            "virtual_id": "user:demo.json",
        }
    )

    facade.delete_user_preset.assert_called_once_with("glossary", "user:demo.json")
    assert result["path"] == "user/demo.json"
