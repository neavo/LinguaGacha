from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Contract.ApiPaths import QualityApiPaths
from api.Models.ProjectRuntime import ProjectMutationAck


def test_quality_rule_api_client_rule_import_export_and_presets_round_trip(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityApiPaths.IMPORT_RULES_PATH,
        {"entries": [{"src": "勇者", "dst": "Hero"}]},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.EXPORT_RULES_PATH,
        {"path": "demo/output/glossary.json"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESETS_PATH,
        {
            "builtin_presets": [
                {
                    "name": "内置",
                    "virtual_id": "builtin:base.json",
                    "path": "resource/base.json",
                    "type": "builtin",
                }
            ],
            "user_presets": [
                {
                    "name": "用户",
                    "virtual_id": "user:mine.json",
                    "path": "user/mine.json",
                    "type": "user",
                }
            ],
        },
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_READ_PATH,
        {"entries": [{"src": "勇者", "dst": "Hero"}]},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_SAVE_PATH,
        {
            "item": {
                "name": "新预设",
                "virtual_id": "user:new.json",
                "path": "user/new.json",
                "type": "user",
            }
        },
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_RENAME_PATH,
        {
            "item": {
                "name": "重命名后",
                "virtual_id": "user:renamed.json",
                "path": "user/renamed.json",
                "type": "user",
            }
        },
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_DELETE_PATH,
        {"path": "user/renamed.json"},
    )

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
    assert recording_api_client.post_requests == [
        (
            QualityApiPaths.IMPORT_RULES_PATH,
            {
                "rule_type": "glossary",
                "expected_revision": 2,
                "path": "demo/input.json",
            },
        ),
        (
            QualityApiPaths.EXPORT_RULES_PATH,
            {
                "rule_type": "glossary",
                "path": "demo/output.json",
                "entries": [{"src": "勇者", "dst": "Hero"}],
            },
        ),
        (QualityApiPaths.RULE_PRESETS_PATH, {"preset_dir_name": "glossary"}),
        (
            QualityApiPaths.RULE_PRESET_READ_PATH,
            {"preset_dir_name": "glossary", "virtual_id": "builtin:base.json"},
        ),
        (
            QualityApiPaths.RULE_PRESET_SAVE_PATH,
            {
                "preset_dir_name": "glossary",
                "name": "新预设",
                "entries": [{"src": "勇者", "dst": "Hero"}],
            },
        ),
        (
            QualityApiPaths.RULE_PRESET_RENAME_PATH,
            {
                "preset_dir_name": "glossary",
                "virtual_id": "user:new.json",
                "new_name": "重命名后",
            },
        ),
        (
            QualityApiPaths.RULE_PRESET_DELETE_PATH,
            {"preset_dir_name": "glossary", "virtual_id": "user:renamed.json"},
        ),
    ]


def test_quality_rule_api_client_save_entries_and_update_meta_return_project_mutation_ack(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityApiPaths.SAVE_ENTRIES_PATH,
        {"accepted": True, "projectRevision": 9, "sectionRevisions": {"quality": 4}},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.UPDATE_META_PATH,
        {"accepted": True, "projectRevision": 10, "sectionRevisions": {"quality": 5}},
    )

    saved_snapshot = quality_client.save_entries(
        {"rule_type": "glossary", "entries": []}
    )
    updated_snapshot = quality_client.update_meta(
        {"rule_type": "glossary", "meta": {"enabled": True}}
    )

    assert isinstance(saved_snapshot, ProjectMutationAck)
    assert isinstance(updated_snapshot, ProjectMutationAck)
    assert saved_snapshot.to_dict() == {
        "accepted": True,
        "projectRevision": 9,
        "sectionRevisions": {"quality": 4},
    }
    assert updated_snapshot.to_dict() == {
        "accepted": True,
        "projectRevision": 10,
        "sectionRevisions": {"quality": 5},
    }


def test_quality_rule_api_client_filters_invalid_rule_entry_payloads(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityApiPaths.IMPORT_RULES_PATH,
        {"entries": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_READ_PATH,
        {"entries": [{"src": "勇者", "dst": "Hero"}, "invalid"]},
    )

    imported_entries = quality_client.import_rules({"rule_type": "glossary"})
    preset_entries = quality_client.read_rule_preset("glossary", "builtin:base.json")

    assert imported_entries == []
    assert preset_entries == [{"src": "勇者", "dst": "Hero"}]


def test_quality_rule_api_client_normalizes_prompt_payload_variants(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_TEMPLATE_PATH,
        {"template": {"system": "system prompt", "version": 2}},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_SAVE_PATH,
        {"accepted": True, "projectRevision": 6, "sectionRevisions": {"prompts": 3}},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_IMPORT_PATH,
        {"text": "imported body"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_EXPORT_PATH,
        {"path": "demo/output/prompt.txt"},
    )

    template = quality_client.get_prompt_template("translation")
    saved_prompt = quality_client.save_prompt({"task_type": "translation"})
    imported_prompt = quality_client.read_prompt_import_text(
        {"task_type": "translation"}
    )
    exported_path = quality_client.export_prompt({"task_type": "translation"})

    assert template == {"system": "system prompt", "version": "2"}
    assert isinstance(saved_prompt, ProjectMutationAck)
    assert saved_prompt.to_dict() == {
        "accepted": True,
        "projectRevision": 6,
        "sectionRevisions": {"prompts": 3},
    }
    assert imported_prompt == "imported body"
    assert exported_path == "demo/output/prompt.txt"


def test_quality_rule_api_client_normalizes_prompt_preset_payloads(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_PRESETS_PATH,
        {
            "builtin_presets": [{"virtual_id": "builtin:base", "name": "内置"}],
            "user_presets": [{"virtual_id": "user:mine", "name": "用户"}],
        },
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_PRESET_READ_PATH,
        {"text": "preset body"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_PRESET_SAVE_PATH,
        {"path": "user/new.json"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_PRESET_RENAME_PATH,
        {"item": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_PRESET_DELETE_PATH,
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


def test_quality_rule_api_client_uses_default_ack_for_invalid_mutation_payloads(
    recording_api_client,
) -> None:
    quality_client = QualityRuleApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_SAVE_PATH,
        {"item": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_RENAME_PATH,
        {"item": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_TEMPLATE_PATH,
        {"template": "invalid"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_SAVE_PATH,
        {},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.PROMPT_IMPORT_PATH,
        {"text": "imported"},
    )
    recording_api_client.queue_post_response(
        QualityApiPaths.RULE_PRESET_READ_PATH,
        {"entries": "invalid"},
    )

    saved_prompt = quality_client.save_prompt({"task_type": "translation"})
    imported_prompt = quality_client.read_prompt_import_text(
        {"task_type": "translation"}
    )
    saved_item = quality_client.save_rule_preset("glossary", "新预设", [])
    renamed_item = quality_client.rename_rule_preset(
        "glossary",
        "user:new.json",
        "重命名后",
    )
    template = quality_client.get_prompt_template("translation")
    preset_entries = quality_client.read_rule_preset("glossary", "builtin:base.json")

    assert isinstance(saved_prompt, ProjectMutationAck)
    assert saved_prompt.to_dict() == {
        "accepted": True,
        "projectRevision": 0,
        "sectionRevisions": {},
    }
    assert imported_prompt == "imported"
    assert saved_item == {}
    assert renamed_item == {}
    assert template == {}
    assert preset_entries == []
