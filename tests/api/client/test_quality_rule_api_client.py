from collections.abc import Callable
from unittest.mock import Mock

from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Client.ApiClient import ApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot


def build_quality_rule_facade() -> Mock:
    """构造最小规则门面，目的是固定客户端与服务端之间的载荷契约。"""

    quality_rule_facade = Mock()
    quality_rule_facade.get_rule_snapshot.return_value = {
        "rule_type": "glossary",
        "revision": 2,
        "meta": {"enabled": True},
        "statistics": {"available": False, "results": {}},
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
    quality_rule_facade.import_rules.return_value = [{"src": "勇者", "dst": "Hero"}]
    quality_rule_facade.export_rules.return_value = "demo/output/glossary.json"
    quality_rule_facade.list_presets.return_value = (
        [
            {
                "name": "内置",
                "virtual_id": "builtin:base.json",
                "path": "resource/base.json",
                "type": "builtin",
            }
        ],
        [
            {
                "name": "用户",
                "virtual_id": "user:mine.json",
                "path": "user/mine.json",
                "type": "user",
            }
        ],
    )
    quality_rule_facade.read_preset.return_value = [{"src": "勇者", "dst": "Hero"}]
    quality_rule_facade.save_user_preset.return_value = {
        "name": "新预设",
        "virtual_id": "user:new.json",
        "path": "user/new.json",
        "type": "user",
    }
    quality_rule_facade.rename_user_preset.return_value = {
        "name": "重命名后",
        "virtual_id": "user:renamed.json",
        "path": "user/renamed.json",
        "type": "user",
    }
    quality_rule_facade.delete_user_preset.return_value = "user/renamed.json"
    return quality_rule_facade


def test_quality_rule_api_client_get_rule_snapshot_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    quality_rule_facade = build_quality_rule_facade()
    base_url = start_api_server(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )
    quality_client = QualityRuleApiClient(ApiClient(base_url))

    snapshot = quality_client.get_rule_snapshot("glossary")

    assert isinstance(snapshot, QualityRuleSnapshot)
    assert snapshot.rule_type == "glossary"
    assert snapshot.entries[0].src == "勇者"


def test_quality_rule_api_client_query_proofreading_returns_lookup_object(
    start_api_server: Callable[..., str],
) -> None:
    quality_rule_facade = Mock()
    base_url = start_api_server(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )
    quality_client = QualityRuleApiClient(ApiClient(base_url))

    query = quality_client.query_proofreading({"src": "^勇者$", "regex": True})

    assert isinstance(query, ProofreadingLookupQuery)
    assert query.keyword == "^勇者$"
    assert query.is_regex is True


def test_quality_rule_api_client_query_text_preserve_uses_regex_lookup(
    start_api_server: Callable[..., str],
) -> None:
    quality_rule_facade = Mock()
    base_url = start_api_server(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )
    quality_client = QualityRuleApiClient(ApiClient(base_url))

    query = quality_client.query_proofreading(
        {
            "rule_type": "text_preserve",
            "entry": {"src": "[勇者]"},
        }
    )

    assert isinstance(query, ProofreadingLookupQuery)
    assert query.keyword == "[勇者]"
    assert query.is_regex is True


def test_quality_rule_api_client_rule_import_export_and_presets_round_trip(
    start_api_server: Callable[..., str],
) -> None:
    quality_rule_facade = build_quality_rule_facade()
    base_url = start_api_server(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )
    quality_client = QualityRuleApiClient(ApiClient(base_url))

    imported_entries = quality_client.import_rules(
        {
            "rule_type": "glossary",
            "expected_revision": 2,
            "path": "demo/input.json",
        }
    )
    exported_path = quality_client.export_rules(
        {
            "rule_type": "glossary",
            "path": "demo/output.json",
            "entries": [{"src": "勇者", "dst": "Hero"}],
        }
    )
    builtin_presets, user_presets = quality_client.list_rule_presets("glossary")
    preset_entries = quality_client.read_rule_preset("glossary", "builtin:base.json")
    saved_item = quality_client.save_rule_preset(
        "glossary",
        "新预设",
        [{"src": "勇者", "dst": "Hero"}],
    )
    renamed_item = quality_client.rename_rule_preset(
        "glossary",
        "user:new.json",
        "重命名后",
    )
    deleted_path = quality_client.delete_rule_preset(
        "glossary",
        "user:renamed.json",
    )

    assert imported_entries == [{"src": "勇者", "dst": "Hero"}]
    assert exported_path == "demo/output/glossary.json"
    assert builtin_presets[0]["virtual_id"] == "builtin:base.json"
    assert user_presets[0]["virtual_id"] == "user:mine.json"
    assert preset_entries == [{"src": "勇者", "dst": "Hero"}]
    assert saved_item["virtual_id"] == "user:new.json"
    assert renamed_item["virtual_id"] == "user:renamed.json"
    assert deleted_path == "user/renamed.json"
