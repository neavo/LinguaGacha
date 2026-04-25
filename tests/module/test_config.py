import json
from pathlib import Path

import pytest

from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath
from module.Config import Config


class TestConfigBehavior:
    def test_load_returns_defaults_when_file_missing(self, fs) -> None:
        del fs
        config = Config().load("/workspace/config/missing.json")

        assert config.mtool_optimizer_enable is True
        assert not hasattr(config, "force_thinking_enable")
        assert config.recent_projects == []

    def test_load_ignores_removed_force_thinking_and_unknown_fields(self, fs) -> None:
        del fs
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "force_thinking_enable": False,
                    "expert_mode": True,
                    "unknown_field": "ignored",
                }
            ),
            encoding="utf-8",
        )

        config = Config().load(str(path))

        assert not hasattr(config, "force_thinking_enable")
        assert not hasattr(config, "expert_mode")
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

        assert not hasattr(config, "force_thinking_enable")
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

        assert config.mtool_optimizer_enable is True

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
            source_language=BaseLanguage.Enum.JA,
            target_language=BaseLanguage.Enum.ZH,
            models=[{"id": "m1", "type": "PRESET"}],
            recent_projects=[{"path": "/a", "name": "A", "updated_at": "now"}],
        )
        path = Path("/workspace/config/config.json")
        path.parent.mkdir(parents=True, exist_ok=True)

        config.save(str(path))
        saved = json.loads(path.read_text(encoding="utf-8"))

        assert saved["source_language"] == "JA"
        assert saved["target_language"] == "ZH"
        assert saved["models"][0]["id"] == "m1"
        assert saved["recent_projects"][0]["path"] == "/a"
        assert "force_thinking_enable" not in saved
        assert "auto_glossary_enable" not in saved
        assert "expert_mode" not in saved
        assert "proxy_enable" not in saved

    def test_recent_projects_deduplicate_and_limit_to_ten(self) -> None:
        config = Config()

        for i in range(12):
            config.add_recent_project(path=f"/p/{i}", name=f"n{i}")

        config.add_recent_project(path="/p/5", name="latest")

        assert len(config.recent_projects) == 10
        assert config.recent_projects[0]["path"] == "/p/5"
        assert config.recent_projects[0]["name"] == "5"
        assert len([v for v in config.recent_projects if v.get("path") == "/p/5"]) == 1

    def test_recent_projects_name_uses_project_path_stem(self) -> None:
        config = Config()

        config.add_recent_project(
            path="E:/Project/LinguaGacha/output/input_20260410_225647.lg",
            name="legacy-source-name",
        )

        assert config.recent_projects == [
            {
                "path": "E:/Project/LinguaGacha/output/input_20260410_225647.lg",
                "name": "input_20260410_225647",
                "updated_at": config.recent_projects[0]["updated_at"],
            }
        ]

    def test_remove_recent_project(self) -> None:
        config = Config()
        config.add_recent_project(path="/p/1", name="n1")
        config.add_recent_project(path="/p/2", name="n2")

        config.remove_recent_project("/p/1")

        assert [v["path"] for v in config.recent_projects] == ["/p/2"]


class TestConfigModels:
    def test_save_uses_default_path_when_path_is_none(self, fs, monkeypatch) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.initialize("/workspace/app", False)

        Config().save()

        saved_path = Path("/workspace/app/userdata/config.json")
        assert saved_path.exists() is True
        saved = json.loads(saved_path.read_text(encoding="utf-8"))
        assert "force_thinking_enable" not in saved
        assert "expert_mode" not in saved

    def test_load_prefers_new_config_when_new_and_legacy_both_exist(self, fs) -> None:
        del fs
        BasePath.reset_for_test()
        BasePath.initialize("/workspace/app", False)
        new_path = Path("/workspace/app/userdata/config.json")
        legacy_path = Path("/workspace/app/resource/config.json")
        new_path.parent.mkdir(parents=True, exist_ok=True)
        legacy_path.parent.mkdir(parents=True, exist_ok=True)
        new_path.write_text(
            json.dumps({"clean_ruby": False}),
            encoding="utf-8",
        )
        legacy_path.write_text(
            json.dumps({"clean_ruby": True}),
            encoding="utf-8",
        )

        config = Config().load()

        assert config.clean_ruby is False
        assert json.loads(new_path.read_text(encoding="utf-8"))["clean_ruby"] is False
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

    def test_initialize_models_keeps_existing_active_model_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.activate_model_id: str = ""
                self.models: list[dict[str, object]] = []

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

    def test_set_active_model_id_calls_manager(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class FakeManager:
            def __init__(self) -> None:
                self.active_id: str = ""

            def set_active_model_id(self, model_id: str) -> None:
                self.active_id = model_id

        fake = FakeManager()
        monkeypatch.setattr("module.Config.ModelManager.get", lambda: fake)

        config = Config(models=[{"id": "m1"}], activate_model_id="m1")
        config.set_active_model_id("m2")
        assert fake.active_id == "m2"
