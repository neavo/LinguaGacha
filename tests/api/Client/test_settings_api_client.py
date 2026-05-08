from api.Client.SettingsApiClient import SettingsApiClient
from api.Contract.ApiPaths import SettingsApiPaths
from api.Models.Settings import AppSettingsSnapshot
from api.Models.Settings import RecentProjectEntry


def build_settings_payload() -> dict[str, object]:
    return {
        "settings": {
            "app_language": "ZH",
            "source_language": "JA",
            "target_language": "ZH",
            "project_save_mode": "source",
            "project_fixed_path": "",
            "output_folder_open_on_finish": False,
            "request_timeout": 120,
            "preceding_lines_threshold": 3,
            "clean_ruby": True,
            "deduplication_in_bilingual": True,
            "check_kana_residue": True,
            "check_hangeul_residue": True,
            "check_similarity": True,
            "write_translated_name_fields_to_file": True,
            "auto_process_prefix_suffix_preserved_text": False,
            "mtool_optimizer_enable": True,
            "skip_duplicate_source_text_enable": False,
            "glossary_default_preset": "",
            "text_preserve_default_preset": "",
            "pre_translation_replacement_default_preset": "",
            "post_translation_replacement_default_preset": "",
            "translation_custom_prompt_default_preset": "",
            "analysis_custom_prompt_default_preset": "",
            "recent_projects": [{"path": "demo.lg", "name": "demo"}],
        }
    }


def test_settings_api_client_methods_use_public_contract_paths(
    recording_api_client,
) -> None:
    settings_client = SettingsApiClient(recording_api_client)
    for path in (
        SettingsApiPaths.SNAPSHOT_PATH,
        SettingsApiPaths.UPDATE_PATH,
        SettingsApiPaths.ADD_RECENT_PROJECT_PATH,
        SettingsApiPaths.REMOVE_RECENT_PROJECT_PATH,
    ):
        recording_api_client.queue_post_response(path, build_settings_payload())

    snapshot = settings_client.get_app_settings()
    updated = settings_client.update_app_settings({"target_language": "EN"})
    added = settings_client.add_recent_project("demo.lg", "demo")
    removed = settings_client.remove_recent_project("demo.lg")

    assert isinstance(snapshot, AppSettingsSnapshot)
    assert snapshot.request_timeout == 120
    assert isinstance(updated, AppSettingsSnapshot)
    assert added.recent_projects == (RecentProjectEntry(path="demo.lg", name="demo"),)
    assert isinstance(removed, AppSettingsSnapshot)
    assert recording_api_client.post_requests == [
        (SettingsApiPaths.SNAPSHOT_PATH, {}),
        (SettingsApiPaths.UPDATE_PATH, {"target_language": "EN"}),
        (
            SettingsApiPaths.ADD_RECENT_PROJECT_PATH,
            {"path": "demo.lg", "name": "demo"},
        ),
        (SettingsApiPaths.REMOVE_RECENT_PROJECT_PATH, {"path": "demo.lg"}),
    ]
