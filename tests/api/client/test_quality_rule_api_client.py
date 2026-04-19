from collections.abc import Callable
from unittest.mock import Mock

from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Client.ApiClient import ApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Models.QualityRule import ProofreadingLookupQuery
from api.Models.QualityRule import QualityRuleSnapshot
from api.Models.QualityRule import QualityRuleStatisticsSnapshot
from api.Server.Routes.QualityRoutes import QualityRoutes


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


def build_quality_rule_snapshot_payload() -> dict[str, object]:
    return {
        "snapshot": {
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
    }


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


def test_quality_rule_api_client_save_entries_and_update_meta_return_snapshots(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityRoutes.SAVE_ENTRIES_PATH,
        build_quality_rule_snapshot_payload(),
    )
    recording_api_client.queue_post_response(
        QualityRoutes.UPDATE_META_PATH,
        build_quality_rule_snapshot_payload(),
    )

    saved_snapshot = quality_client.save_entries(
        {"rule_type": "glossary", "entries": []}
    )
    updated_snapshot = quality_client.update_meta(
        {"rule_type": "glossary", "meta": {"enabled": True}}
    )

    assert isinstance(saved_snapshot, QualityRuleSnapshot)
    assert saved_snapshot.rule_type == "glossary"
    assert isinstance(updated_snapshot, QualityRuleSnapshot)
    assert updated_snapshot.entries[0].dst == "Hero"


def test_quality_rule_api_client_filters_invalid_rule_entry_payloads(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityRoutes.IMPORT_RULES_PATH,
        {"entries": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.RULE_PRESET_READ_PATH,
        {"entries": [{"src": "勇者", "dst": "Hero"}, "invalid"]},
    )

    imported_entries = quality_client.import_rules({"rule_type": "glossary"})
    preset_entries = quality_client.read_rule_preset("glossary", "builtin:base.json")

    assert imported_entries == []
    assert preset_entries == [{"src": "勇者", "dst": "Hero"}]


def test_quality_rule_api_client_build_rule_statistics_returns_snapshot(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityRoutes.STATISTICS_PATH,
        {
            "statistics": {
                "available": True,
                "results": {
                    "glossary": {
                        "matched_item_count": 4,
                        "subset_parents": ["root"],
                    }
                },
            }
        },
    )

    result = quality_client.build_rule_statistics({"rule_type": "glossary"})

    assert isinstance(result, QualityRuleStatisticsSnapshot)
    assert result.available is True
    assert result.results["glossary"].matched_item_count == 4


def test_quality_rule_api_client_normalizes_prompt_payload_variants(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_SNAPSHOT_PATH,
        {"prompt": {"task_type": "translation", "text": "snapshot"}},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_TEMPLATE_PATH,
        {"template": {"system": "system prompt", "version": 2}},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_SAVE_PATH,
        {"prompt": {"task_type": "translation", "text": "saved"}},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_IMPORT_PATH,
        {"prompt": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_EXPORT_PATH,
        {"path": "demo/output/prompt.txt"},
    )

    snapshot = quality_client.get_prompt_snapshot("translation")
    template = quality_client.get_prompt_template("translation")
    saved_prompt = quality_client.save_prompt({"task_type": "translation"})
    imported_prompt = quality_client.import_prompt({"task_type": "translation"})
    exported_path = quality_client.export_prompt({"task_type": "translation"})

    assert snapshot == {"task_type": "translation", "text": "snapshot"}
    assert template == {"system": "system prompt", "version": "2"}
    assert saved_prompt == {"task_type": "translation", "text": "saved"}
    assert imported_prompt == {}
    assert exported_path == "demo/output/prompt.txt"


def test_quality_rule_api_client_normalizes_prompt_preset_payloads(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_PRESETS_PATH,
        {
            "builtin_presets": [{"virtual_id": "builtin:base", "name": "内置"}],
            "user_presets": [{"virtual_id": "user:mine", "name": "用户"}],
        },
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_PRESET_READ_PATH,
        {"text": "preset body"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_PRESET_SAVE_PATH,
        {"path": "user/new.json"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_PRESET_RENAME_PATH,
        {"item": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_PRESET_DELETE_PATH,
        {"path": "user/old.json"},
    )

    builtin_presets, user_presets = quality_client.list_prompt_presets("translation")
    prompt_text = quality_client.read_prompt_preset("translation", "builtin:base")
    saved_path = quality_client.save_prompt_preset("translation", "新预设", "body")
    renamed_item = quality_client.rename_prompt_preset(
        "translation",
        "user:new.json",
        "重命名后",
    )
    deleted_path = quality_client.delete_prompt_preset("translation", "user:old.json")

    assert builtin_presets == [{"virtual_id": "builtin:base", "name": "内置"}]
    assert user_presets == [{"virtual_id": "user:mine", "name": "用户"}]
    assert prompt_text == "preset body"
    assert saved_path == "user/new.json"
    assert renamed_item == {}
    assert deleted_path == "user/old.json"


def test_quality_rule_api_client_returns_empty_dict_for_invalid_item_payloads(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_SNAPSHOT_PATH,
        {"prompt": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.RULE_PRESET_SAVE_PATH,
        {"item": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.RULE_PRESET_RENAME_PATH,
        {"item": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_TEMPLATE_PATH,
        {"template": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_SAVE_PATH,
        {"prompt": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.PROMPT_IMPORT_PATH,
        {"prompt": {"task_type": "translation", "text": "imported"}},
    )
    recording_api_client.queue_post_response(
        QualityRoutes.RULE_PRESET_READ_PATH,
        {"entries": "invalid"},
    )

    prompt_snapshot = quality_client.get_prompt_snapshot("translation")
    saved_prompt = quality_client.save_prompt({"task_type": "translation"})
    imported_prompt = quality_client.import_prompt({"task_type": "translation"})
    saved_item = quality_client.save_rule_preset("glossary", "新预设", [])
    renamed_item = quality_client.rename_rule_preset(
        "glossary",
        "user:new.json",
        "重命名后",
    )
    template = quality_client.get_prompt_template("translation")
    preset_entries = quality_client.read_rule_preset("glossary", "builtin:base.json")

    assert prompt_snapshot == {}
    assert saved_prompt == {}
    assert imported_prompt == {"task_type": "translation", "text": "imported"}
    assert saved_item == {}
    assert renamed_item == {}
    assert template == {}
    assert preset_entries == []
