import json
import os
from pathlib import Path

import pytest

from base.BaseBrand import BaseBrand
from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath
from module.Config import Config
from module.Migration.UserDataMigrationService import UserDataMigrationService


class TestConfigPaths:
    def test_base_path_get_user_data_root_dir_prefers_userdata_root_in_portable_mode(
        self, monkeypatch
    ) -> None:
        BasePath.reset_for_test()
        BasePath.APP_DIR = "/tmp/app"
        BasePath.DATA_DIR = "/tmp/data"

        assert BasePath.get_user_data_root_dir() == os.path.join(
            "/tmp/data", "userdata"
        )

    def test_base_path_get_user_data_root_dir_uses_userdata_root_by_default(
        self, monkeypatch
    ) -> None:
        BasePath.reset_for_test()
        BasePath.initialize("/tmp/app", BaseBrand.get("lg"), False)

        assert BasePath.get_user_data_root_dir() == os.path.join("/tmp/app", "userdata")


class TestConfigBehavior:
    def test_load_returns_defaults_when_file_missing(self, fs) -> None:
        del fs
        config = Config().load("/workspace/config/missing.json")

        assert config.theme == Config.Theme.LIGHT
        assert config.force_thinking_enable is True
        assert config.recent_projects == []

    def test_load_applies_known_fields_only(self, fs) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"expert_mode": True, "unknown_field": "ignored"}),
            encoding="utf-8",
        )

        config = Config().load(str(path))

        assert config.expert_mode is True
        assert not hasattr(config, "unknown_field")

    def test_load_ignores_removed_auto_glossary_field(self, fs) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"force_thinking_enable": False, "auto_glossary_enable": True}),
            encoding="utf-8",
        )

        config = Config().load(str(path))

        assert config.force_thinking_enable is False
        assert not hasattr(config, "auto_glossary_enable")

    def test_load_logs_error_when_file_corrupted(
        self, fs, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{bad", encoding="utf-8")

        errors: list[tuple[str, Exception]] = []

        class DummyLogger:
            def error(self, msg: str, e: Exception) -> None:
                errors.append((msg, e))

        monkeypatch.setattr("module.Config.LogManager.get", lambda: DummyLogger())

        def raise_decode_error(path: str) -> dict:
            del path
            raise ValueError("invalid json")

        monkeypatch.setattr("module.Config.JSONTool.load_file", raise_decode_error)

        Config().load(str(path))

        assert len(errors) == 1
        assert isinstance(errors[0][1], ValueError)

    def test_load_ignores_non_dict_payload(self, fs) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(["not", "a", "dict"]), encoding="utf-8")

        config = Config().load(str(path))

        assert config.expert_mode is False
        assert config.theme == Config.Theme.LIGHT
        assert config.force_thinking_enable is True

    def test_load_reads_normalized_quality_preset_virtual_ids(self, fs) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "glossary_default_preset": "builtin:demo.json",
                    "text_preserve_default_preset": "user:custom.json",
                }
            ),
            encoding="utf-8",
        )

        config = Config().load(str(path))

        assert config.glossary_default_preset == "builtin:demo.json"
        assert config.text_preserve_default_preset == "user:custom.json"

    def test_load_keeps_unknown_quality_preset_value_as_is(self, fs) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "post_translation_replacement_default_preset": "unknown.txt",
                }
            ),
            encoding="utf-8",
        )

        config = Config().load(str(path))

        assert config.post_translation_replacement_default_preset == "unknown.txt"

    def test_save_sorts_models_before_dumping(self, fs) -> None:
        del fs
        config = Config(
            models=[
                {"id": "3", "type": "CUSTOM_OPENAI"},
                {"id": "4", "type": "UNKNOWN"},
                {"id": "1", "type": "PRESET"},
                {"id": "2", "type": "CUSTOM_GOOGLE"},
                {"id": "5", "type": "CUSTOM_ANTHROPIC"},
            ]
        )
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)

        config.save(str(path))
        saved = json.loads(path.read_text(encoding="utf-8"))

        assert [model["type"] for model in saved["models"]] == [
            "PRESET",
            "CUSTOM_GOOGLE",
            "CUSTOM_OPENAI",
            "CUSTOM_ANTHROPIC",
            "UNKNOWN",
        ]

    def test_save_and_load_preserve_relative_order_within_same_type(self, fs) -> None:
        del fs
        config = Config(
            models=[
                {"id": "openai-2", "type": "CUSTOM_OPENAI"},
                {"id": "preset-1", "type": "PRESET"},
                {"id": "openai-1", "type": "CUSTOM_OPENAI"},
                {"id": "google-1", "type": "CUSTOM_GOOGLE"},
            ]
        )
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)

        config.save(str(path))
        loaded = Config().load(str(path))

        openai_ids = [
            model["id"]
            for model in (loaded.models or [])
            if model.get("type") == "CUSTOM_OPENAI"
        ]
        assert openai_ids == ["openai-2", "openai-1"]

    def test_save_serializes_core_fields(self, fs) -> None:
        del fs
        config = Config(
            expert_mode=True,
            proxy_enable=True,
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.Enum.ZH,
            models=[{"id": "m1", "type": "PRESET"}],
            recent_projects=[{"path": "/a", "name": "A", "updated_at": "now"}],
        )
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)

        config.save(str(path))
        saved = json.loads(path.read_text(encoding="utf-8"))

        assert saved["expert_mode"] is True
        assert saved["proxy_enable"] is True
        assert saved["source_language"] == "JA"
        assert saved["target_language"] == "ZH"
        assert saved["models"][0]["id"] == "m1"
        assert saved["recent_projects"][0]["path"] == "/a"
        assert "auto_glossary_enable" not in saved

    def test_recent_projects_deduplicate_and_limit_to_ten(self) -> None:
        config = Config()

        for i in range(12):
            config.add_recent_project(path=f"/p/{i}", name=f"n{i}")

        config.add_recent_project(path="/p/5", name="latest")

        assert len(config.recent_projects) == 10
        assert config.recent_projects[0]["path"] == "/p/5"
        assert config.recent_projects[0]["name"] == "latest"
        assert len([v for v in config.recent_projects if v.get("path") == "/p/5"]) == 1

    def test_remove_recent_project(self) -> None:
        config = Config()
        config.add_recent_project(path="/p/1", name="n1")
        config.add_recent_project(path="/p/2", name="n2")

        config.remove_recent_project("/p/1")

        assert [v["path"] for v in config.recent_projects] == ["/p/2"]


class TestConfigModels:
    def test_reset_expert_settings_resets_fields(self) -> None:
        config = Config(
            preceding_lines_threshold=123,
            clean_ruby=False,
            deduplication_in_trans=False,
            deduplication_in_bilingual=False,
            check_kana_residue=False,
            check_hangeul_residue=False,
            check_similarity=False,
            write_translated_name_fields_to_file=False,
            auto_process_prefix_suffix_preserved_text=False,
        )

        config.reset_expert_settings()

        assert config.preceding_lines_threshold == 0
        assert config.clean_ruby is True
        assert config.deduplication_in_trans is True
        assert config.deduplication_in_bilingual is True
        assert config.check_kana_residue is True
        assert config.check_hangeul_residue is True
        assert config.check_similarity is True
        assert config.write_translated_name_fields_to_file is True
        assert config.auto_process_prefix_suffix_preserved_text is True

    def test_save_uses_default_path_when_path_is_none(self, fs, monkeypatch) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.initialize("/workspace/app", BaseBrand.get("lg"), False)

        Config(expert_mode=True).save()

        saved_path = Path("/workspace/app/userdata/config.json")
        assert saved_path.exists() is True
        assert json.loads(saved_path.read_text(encoding="utf-8"))["expert_mode"] is True

    def test_load_copies_legacy_resource_config_to_userdata(self, fs) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.initialize("/workspace/app", BaseBrand.get("lg"), False)
        legacy_path = Path("/workspace/app/resource/config.json")
        legacy_path.parent.mkdir(parents=True, exist_ok=True)
        legacy_path.write_text(
            json.dumps({"expert_mode": True}),
            encoding="utf-8",
        )

        UserDataMigrationService.run_startup_migrations()
        config = Config().load()
        migrated_path = Path("/workspace/app/userdata/config.json")

        assert config.expert_mode is True
        assert migrated_path.exists() is True
        assert legacy_path.exists() is True

    def test_load_copies_legacy_root_config_to_userdata(self, fs) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.initialize("/workspace/app", BaseBrand.get("lg"), False)
        legacy_path = Path("/workspace/app/config.json")
        legacy_path.write_text(
            json.dumps({"proxy_enable": True}),
            encoding="utf-8",
        )

        UserDataMigrationService.run_startup_migrations()
        config = Config().load()
        migrated_path = Path("/workspace/app/userdata/config.json")

        assert config.proxy_enable is True
        assert migrated_path.exists() is True
        assert legacy_path.exists() is True

    def test_load_copies_first_legacy_config_when_multiple_exist(self, fs) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.APP_DIR = "/workspace/app"
        BasePath.DATA_DIR = "/workspace/data"
        data_legacy_path = Path("/workspace/data/config.json")
        resource_legacy_path = Path("/workspace/app/resource/config.json")
        data_legacy_path.parent.mkdir(parents=True, exist_ok=True)
        resource_legacy_path.parent.mkdir(parents=True, exist_ok=True)
        resource_legacy_path.write_text(
            json.dumps({"expert_mode": False}),
            encoding="utf-8",
        )
        data_legacy_path.write_text(
            json.dumps({"expert_mode": True}),
            encoding="utf-8",
        )

        UserDataMigrationService.run_startup_migrations()
        config = Config().load()
        migrated_path = Path("/workspace/data/userdata/config.json")

        assert config.expert_mode is True
        assert migrated_path.exists() is True
        assert data_legacy_path.exists() is True
        assert resource_legacy_path.exists() is True

    def test_load_prefers_new_config_when_new_and_legacy_both_exist(self, fs) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.initialize("/workspace/app", BaseBrand.get("lg"), False)
        new_path = Path("/workspace/app/userdata/config.json")
        legacy_path = Path("/workspace/app/resource/config.json")
        new_path.parent.mkdir(parents=True, exist_ok=True)
        legacy_path.parent.mkdir(parents=True, exist_ok=True)
        new_path.write_text(
            json.dumps({"expert_mode": False}),
            encoding="utf-8",
        )
        legacy_path.write_text(
            json.dumps({"expert_mode": True}),
            encoding="utf-8",
        )

        config = Config().load()

        assert config.expert_mode is False
        assert json.loads(new_path.read_text(encoding="utf-8"))["expert_mode"] is False
        assert legacy_path.exists() is True

    def test_save_skips_model_sort_when_models_is_none(self, fs) -> None:
        del fs
        config = Config(models=None)
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)

        config.save(str(path))
        saved = json.loads(path.read_text(encoding="utf-8"))

        assert saved["models"] is None

    def test_save_logs_error_when_writer_open_fails(
        self, fs, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)

        errors: list[tuple[str, Exception]] = []

        class DummyLogger:
            def error(self, msg: str, e: Exception) -> None:
                errors.append((msg, e))

        monkeypatch.setattr("module.Config.LogManager.get", lambda: DummyLogger())

        def raise_open(*args, **kwargs):
            del args
            del kwargs
            raise OSError("permission denied")

        monkeypatch.setattr("builtins.open", raise_open)

        Config().save(str(path))

        assert len(errors) == 1
        assert isinstance(errors[0][1], OSError)

    def test_initialize_models_sets_active_model_id_when_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []
                self.activate_model_id: str = ""
                self.models: list[dict[str, object]] = []

            def set_app_language(self, language: BaseLanguage.Enum) -> None:
                self.calls.append(("set_app_language", language))

            def initialize_models(
                self, models: list[dict[str, object]]
            ) -> tuple[list[dict[str, object]], int]:
                self.calls.append(("initialize_models", list(models)))
                return ([{"id": "m1"}], 2)

            def set_models(self, models: list[dict[str, object]] | None) -> None:
                self.calls.append(("set_models", models))
                self.models = list(models or [])

            def set_active_model_id(self, model_id: str) -> None:
                self.calls.append(("set_active_model_id", model_id))
                self.activate_model_id = model_id

            def get_models_as_dict(self) -> list[dict[str, object]]:
                return list(self.models)

        fake = FakeManager()
        monkeypatch.setattr("module.Config.ModelManager.get", lambda: fake)

        config = Config(app_language=BaseLanguage.Enum.EN, models=None)
        migrated = config.initialize_models()

        assert migrated == 2
        assert config.models == [{"id": "m1"}]
        assert config.activate_model_id == "m1"
        assert fake.activate_model_id == "m1"
        assert ("set_app_language", BaseLanguage.Enum.EN) in fake.calls

    def test_initialize_models_keeps_existing_active_model_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.activate_model_id: str = ""
                self.models: list[dict[str, object]] = []

            def set_app_language(self, language: BaseLanguage.Enum) -> None:
                del language

            def initialize_models(
                self, models: list[dict[str, object]]
            ) -> tuple[list[dict[str, object]], int]:
                del models
                return ([{"id": "m1"}, {"id": "m2"}], 0)

            def set_models(self, models: list[dict[str, object]] | None) -> None:
                self.models = list(models or [])

            def set_active_model_id(self, model_id: str) -> None:
                self.activate_model_id = model_id

            def get_models_as_dict(self) -> list[dict[str, object]]:
                return list(self.models)

        fake = FakeManager()
        monkeypatch.setattr("module.Config.ModelManager.get", lambda: fake)

        config = Config(activate_model_id="m2", models=[{"id": "m2"}])
        migrated = config.initialize_models()

        assert migrated == 0
        assert config.activate_model_id == "m2"
        assert fake.activate_model_id == "m2"

    def test_get_model_and_get_active_model_and_fallbacks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        del monkeypatch
        config = Config(models=[{"id": "m1"}, {"id": "m2"}], activate_model_id="m2")

        assert config.get_model("missing") is None
        assert config.get_model("m1") == {"id": "m1"}
        assert config.get_active_model() == {"id": "m2"}

        config.activate_model_id = "not-exist"
        assert config.get_active_model() == {"id": "m1"}

        assert Config(models=[]).get_active_model() is None

    def test_set_model_updates_existing_and_syncs_to_manager(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.models: list[dict[str, object]] | None = None

            def set_models(self, models: list[dict[str, object]] | None) -> None:
                self.models = models

        fake = FakeManager()
        monkeypatch.setattr("module.Config.ModelManager.get", lambda: fake)

        config = Config(models=[{"id": "m1", "type": "PRESET"}, {"id": "m2"}])
        config.set_model({"id": "m2", "type": "CUSTOM"})

        assert config.models == [
            {"id": "m1", "type": "PRESET"},
            {"id": "m2", "type": "CUSTOM"},
        ]
        assert fake.models == config.models

    def test_set_model_keeps_models_when_id_not_found_and_still_syncs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.models: list[dict[str, object]] | None = None

            def set_models(self, models: list[dict[str, object]] | None) -> None:
                self.models = models

        fake = FakeManager()
        monkeypatch.setattr("module.Config.ModelManager.get", lambda: fake)

        config = Config(models=[{"id": "m1", "type": "PRESET"}])
        config.set_model({"id": "missing", "type": "CUSTOM"})

        assert config.models == [{"id": "m1", "type": "PRESET"}]
        assert fake.models == config.models

    def test_set_active_model_id_and_sync_methods_call_manager(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.active_id: str = ""
                self.models: list[dict[str, object]] = []
                self.activate_model_id: str = "from_manager"

            def set_models(self, models: list[dict[str, object]]) -> None:
                self.models = list(models)

            def set_active_model_id(self, model_id: str) -> None:
                self.active_id = model_id

            def get_models_as_dict(self) -> list[dict[str, object]]:
                return [{"id": "x"}]

        fake = FakeManager()
        monkeypatch.setattr("module.Config.ModelManager.get", lambda: fake)

        config = Config(models=[{"id": "m1"}], activate_model_id="m1")
        config.set_active_model_id("m2")
        assert fake.active_id == "m2"

        config.models = [{"id": "a"}]
        config.activate_model_id = "a"
        config.sync_models_to_manager()
        assert fake.models == [{"id": "a"}]
        assert fake.active_id == "a"

        config.sync_models_from_manager()
        assert config.models == [{"id": "x"}]
        assert config.activate_model_id == "from_manager"
