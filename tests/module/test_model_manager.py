import os

import pytest

from base.BaseLanguage import BaseLanguage
from model.Model import Model
from model.Model import ModelType
from module.ModelManager import ModelManager


def build_model_data(
    model_id: str, type_value: str, api_format: str = "OpenAI"
) -> dict:
    return {
        "id": model_id,
        "type": type_value,
        "name": model_id,
        "api_format": api_format,
        "api_url": "https://example.com",
        "api_key": "k",
        "model_id": "m",
    }


@pytest.fixture(autouse=True)
def reset_singleton(request: pytest.FixtureRequest) -> None:
    ModelManager.reset()
    request.addfinalizer(ModelManager.reset)


class TestModelManager:
    def test_get_returns_singleton(self) -> None:
        first = ModelManager.get()
        second = ModelManager.get()
        assert first is second

    def test_get_returns_instance_when_inner_check_is_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        expected = ModelManager()

        class LockThatInjectsInstance:
            def __enter__(self) -> None:
                ModelManager._instance = expected

            def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
                _ = (exc_type, exc, tb)
                return False

        monkeypatch.setattr(ModelManager, "_instance", None)
        monkeypatch.setattr(ModelManager, "_lock", LockThatInjectsInstance())

        manager = ModelManager.get()

        assert manager is expected

    def test_get_preset_dir_uses_app_language(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setenv("LINGUAGACHA_APP_DIR", "/tmp/app")

        manager.set_app_language(BaseLanguage.Enum.ZH)
        zh_path = manager.get_preset_dir()
        manager.set_app_language(BaseLanguage.Enum.EN)
        en_path = manager.get_preset_dir()

        assert zh_path.endswith(os.path.join("resource", "preset", "model", "zh"))
        assert en_path.endswith(os.path.join("resource", "preset", "model", "en"))

    def test_initialize_models_migrates_and_fills_missing_types(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        existing_models = [
            build_model_data("old-preset", ModelType.PRESET.value, api_format="Google"),
            build_model_data("custom-openai", ModelType.CUSTOM_OPENAI.value),
        ]

        monkeypatch.setattr(
            manager,
            "load_preset_models",
            lambda: [build_model_data("preset-new", ModelType.PRESET.value)],
        )

        generated_ids = iter(["generated-1", "generated-2"])
        monkeypatch.setattr(
            "module.ModelManager.Model.generate_id",
            lambda: next(generated_ids),
        )
        monkeypatch.setattr(
            manager,
            "load_template",
            lambda model_type: {
                "name": f"template-{model_type.value}",
                "api_format": "OpenAI",
                "api_url": "",
                "api_key": "k",
                "model_id": "m",
            },
        )

        models, migrated_count = manager.initialize_models(existing_models)

        assert migrated_count == 1
        assert models[0]["type"] == ModelType.CUSTOM_GOOGLE.value
        assert any(v.get("id") == "preset-new" for v in models)
        assert any(v.get("type") == ModelType.CUSTOM_ANTHROPIC.value for v in models)

    def test_delete_model_reselects_active_model_in_same_type(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("preset", ModelType.PRESET.value),
                build_model_data("openai-a", ModelType.CUSTOM_OPENAI.value),
                build_model_data("openai-b", ModelType.CUSTOM_OPENAI.value),
            ]
        )
        manager.set_active_model_id("openai-a")

        success = manager.delete_model("openai-a")

        assert success is True
        assert manager.activate_model_id == "openai-b"

    def test_delete_model_rejects_preset(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("preset", ModelType.PRESET.value)])

        assert manager.delete_model("preset") is False

    def test_load_preset_models_returns_empty_when_not_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setattr(
            "module.ModelManager.JSONTool.load_file", lambda path: {"bad": 1}
        )

        assert manager.load_preset_models() == []

    def test_load_template_returns_type_specific_template(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setattr(manager, "get_preset_dir", lambda: "/tmp/preset")

        def fake_load(path: str) -> dict:
            return {"path": path}

        monkeypatch.setattr("module.ModelManager.JSONTool.load_file", fake_load)

        google_template = manager.load_template(ModelType.CUSTOM_GOOGLE)
        openai_template = manager.load_template(ModelType.CUSTOM_OPENAI)
        anthropic_template = manager.load_template(ModelType.CUSTOM_ANTHROPIC)

        assert google_template["path"].endswith(manager.PRESET_CUSTOM_GOOGLE_FILENAME)
        assert openai_template["path"].endswith(manager.PRESET_CUSTOM_OPENAI_FILENAME)
        assert anthropic_template["path"].endswith(
            manager.PRESET_CUSTOM_ANTHROPIC_FILENAME
        )

    def test_get_active_model_falls_back_to_first_when_missing(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("preset", ModelType.PRESET.value),
                build_model_data("custom", ModelType.CUSTOM_OPENAI.value),
            ]
        )
        manager.set_active_model_id("missing")

        active = manager.get_active_model()
        assert isinstance(active, Model)
        assert active.id == "preset"

    def test_update_model_by_dict_preserves_id_and_type(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("custom", ModelType.CUSTOM_OPENAI.value)])

        ok = manager.update_model_by_dict(
            "custom",
            {
                "name": "updated",
                "type": ModelType.CUSTOM_GOOGLE.value,
                "api_format": "OpenAI",
                "api_url": "https://new.example.com",
                "api_key": "k2",
                "model_id": "m2",
            },
        )

        assert ok is True
        updated = manager.get_model_by_id("custom")
        assert isinstance(updated, Model)
        assert updated.id == "custom"
        assert updated.type == ModelType.CUSTOM_OPENAI
        assert updated.name == "updated"

    def test_load_preset_models_returns_empty_when_load_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()

        class DummyLogger:
            def warning(self, msg: str, e: Exception) -> None:
                _ = (msg, e)

        def fake_load(_: str) -> list[dict]:
            raise RuntimeError("boom")

        monkeypatch.setattr("module.ModelManager.LogManager.get", lambda: DummyLogger())
        monkeypatch.setattr("module.ModelManager.JSONTool.load_file", fake_load)

        assert manager.load_preset_models() == []

    def test_load_template_returns_empty_for_unknown_type(self) -> None:
        manager = ModelManager()
        assert manager.load_template(ModelType.PRESET) == {}

    def test_load_template_returns_empty_for_non_dict_payload(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setattr(manager, "get_preset_dir", lambda: "/tmp/preset")
        monkeypatch.setattr("module.ModelManager.JSONTool.load_file", lambda _: ["bad"])

        assert manager.load_template(ModelType.CUSTOM_OPENAI) == {}

    def test_load_template_returns_empty_when_load_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setattr(manager, "get_preset_dir", lambda: "/tmp/preset")

        class DummyLogger:
            def warning(self, msg: str, e: Exception) -> None:
                _ = (msg, e)

        def fake_load(_: str) -> dict:
            raise RuntimeError("boom")

        monkeypatch.setattr("module.ModelManager.LogManager.get", lambda: DummyLogger())
        monkeypatch.setattr("module.ModelManager.JSONTool.load_file", fake_load)

        assert manager.load_template(ModelType.CUSTOM_GOOGLE) == {}

    def test_initialize_models_handles_empty_input_and_fills_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setattr(
            manager,
            "load_preset_models",
            lambda: [
                build_model_data("preset-1", ModelType.PRESET.value),
                build_model_data("preset-2", ModelType.PRESET.value),
            ],
        )
        generated_ids = iter(["g-1", "g-2", "g-3"])
        monkeypatch.setattr(
            "module.ModelManager.Model.generate_id", lambda: next(generated_ids)
        )
        monkeypatch.setattr(
            manager,
            "load_template",
            lambda model_type: {
                "name": f"template-{model_type.value}",
                "api_format": "OpenAI",
                "api_url": "",
                "api_key": "k",
                "model_id": "m",
            },
        )

        models, migrated_count = manager.initialize_models([])

        assert migrated_count == 0
        assert [model["id"] for model in models[:2]] == ["preset-1", "preset-2"]
        assert {model["type"] for model in models[2:]} == {
            ModelType.CUSTOM_GOOGLE.value,
            ModelType.CUSTOM_OPENAI.value,
            ModelType.CUSTOM_ANTHROPIC.value,
        }

    def test_initialize_models_migrates_anthropic_and_openai_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        existing_models = [
            build_model_data(
                "old-anthropic", ModelType.PRESET.value, api_format="Anthropic"
            ),
            build_model_data(
                "old-other", ModelType.PRESET.value, api_format="SakuraLLM"
            ),
            build_model_data(
                "google", ModelType.CUSTOM_GOOGLE.value, api_format="Google"
            ),
            build_model_data("openai", ModelType.CUSTOM_OPENAI.value),
            build_model_data(
                "anthropic", ModelType.CUSTOM_ANTHROPIC.value, api_format="Anthropic"
            ),
        ]
        monkeypatch.setattr(manager, "load_preset_models", lambda: [])

        models, migrated_count = manager.initialize_models(existing_models)

        assert migrated_count == 2
        assert models[0]["type"] == ModelType.CUSTOM_ANTHROPIC.value
        assert models[1]["type"] == ModelType.CUSTOM_OPENAI.value

    def test_get_models_and_get_models_as_dict(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("preset", ModelType.PRESET.value),
                build_model_data("custom", ModelType.CUSTOM_OPENAI.value),
            ]
        )

        models = manager.get_models()
        models_as_dict = manager.get_models_as_dict()

        assert [model.id for model in models] == ["preset", "custom"]
        assert [model["id"] for model in models_as_dict] == ["preset", "custom"]

    def test_get_active_model_returns_configured_model(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("preset", ModelType.PRESET.value),
                build_model_data("custom", ModelType.CUSTOM_OPENAI.value),
            ]
        )
        manager.set_active_model_id("custom")

        active = manager.get_active_model()

        assert isinstance(active, Model)
        assert active.id == "custom"

    def test_get_active_model_returns_none_when_empty(self) -> None:
        manager = ModelManager()
        assert manager.get_active_model() is None

    def test_add_model_creates_model_from_template(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        monkeypatch.setattr(
            manager,
            "load_template",
            lambda _: {
                "name": "custom-model",
                "api_format": "OpenAI",
                "api_url": "https://example.com",
                "api_key": "k",
                "model_id": "m",
            },
        )
        monkeypatch.setattr("module.ModelManager.Model.generate_id", lambda: "new-id")

        created = manager.add_model(ModelType.CUSTOM_OPENAI)

        assert created.id == "new-id"
        assert created.type == ModelType.CUSTOM_OPENAI
        assert manager.get_models()[-1].id == "new-id"

    def test_delete_model_returns_false_when_missing_id(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("preset", ModelType.PRESET.value)])

        assert manager.delete_model("missing") is False

    def test_delete_model_active_falls_back_to_preset(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("preset", ModelType.PRESET.value),
                build_model_data(
                    "google", ModelType.CUSTOM_GOOGLE.value, api_format="Google"
                ),
            ]
        )
        manager.set_active_model_id("google")

        assert manager.delete_model("google") is True
        assert manager.activate_model_id == "preset"

    def test_delete_model_active_falls_back_to_first_when_no_preset(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data(
                    "google", ModelType.CUSTOM_GOOGLE.value, api_format="Google"
                ),
                build_model_data("openai", ModelType.CUSTOM_OPENAI.value),
            ]
        )
        manager.set_active_model_id("google")

        assert manager.delete_model("google") is True
        assert manager.activate_model_id == "openai"

    def test_delete_model_active_clears_id_when_last_item_removed(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("google", ModelType.CUSTOM_GOOGLE.value)])
        manager.set_active_model_id("google")

        assert manager.delete_model("google") is True
        assert manager.activate_model_id == ""

    def test_update_model_replaces_target(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("custom", ModelType.CUSTOM_OPENAI.value)])
        updated_model = Model.from_dict(
            {
                **build_model_data("custom", ModelType.CUSTOM_OPENAI.value),
                "name": "updated-name",
            }
        )

        ok = manager.update_model(updated_model)

        assert ok is True
        current = manager.get_model_by_id("custom")
        assert isinstance(current, Model)
        assert current.name == "updated-name"

    def test_update_model_returns_false_for_missing_id(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("custom", ModelType.CUSTOM_OPENAI.value)])
        not_exists = Model.from_dict(
            build_model_data("other", ModelType.CUSTOM_OPENAI.value)
        )

        assert manager.update_model(not_exists) is False

    def test_update_model_by_dict_returns_false_for_missing_id(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("custom", ModelType.CUSTOM_OPENAI.value)])

        ok = manager.update_model_by_dict(
            "missing",
            {
                "name": "updated",
                "api_format": "OpenAI",
                "api_url": "https://new.example.com",
                "api_key": "k2",
                "model_id": "m2",
            },
        )

        assert ok is False

    def test_reset_preset_model_returns_false_for_non_preset(self) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("custom", ModelType.CUSTOM_OPENAI.value)])

        assert manager.reset_preset_model("custom") is False

    def test_reset_preset_model_returns_false_when_preset_not_found(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("preset", ModelType.PRESET.value)])
        monkeypatch.setattr(manager, "load_preset_models", lambda: [])

        assert manager.reset_preset_model("preset") is False

    def test_reset_preset_model_reloads_data_from_preset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        manager.set_models([build_model_data("preset", ModelType.PRESET.value)])
        monkeypatch.setattr(
            manager,
            "load_preset_models",
            lambda: [
                {
                    **build_model_data("preset", ModelType.PRESET.value),
                    "name": "preset-updated",
                }
            ],
        )

        ok = manager.reset_preset_model("preset")

        assert ok is True
        current = manager.get_model_by_id("preset")
        assert isinstance(current, Model)
        assert current.name == "preset-updated"

    def test_reorder_models_applies_order_and_appends_missing(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("a", ModelType.PRESET.value),
                build_model_data("b", ModelType.CUSTOM_OPENAI.value),
                build_model_data("c", ModelType.CUSTOM_GOOGLE.value),
            ]
        )

        manager.reorder_models(["c", "a"])

        assert [model.id for model in manager.get_models()] == ["c", "a", "b"]

    def test_initialize_models_does_not_duplicate_existing_preset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        existing_models = [
            build_model_data("preset-1", ModelType.PRESET.value),
            build_model_data(
                "google", ModelType.CUSTOM_GOOGLE.value, api_format="Google"
            ),
            build_model_data("openai", ModelType.CUSTOM_OPENAI.value),
            build_model_data(
                "anthropic", ModelType.CUSTOM_ANTHROPIC.value, api_format="Anthropic"
            ),
        ]
        monkeypatch.setattr(
            manager,
            "load_preset_models",
            lambda: [build_model_data("preset-1", ModelType.PRESET.value)],
        )

        models, migrated_count = manager.initialize_models(existing_models)

        assert migrated_count == 0
        assert [model["id"] for model in models].count("preset-1") == 1

    def test_delete_model_keeps_active_id_when_deleting_non_active(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("preset", ModelType.PRESET.value),
                build_model_data(
                    "google", ModelType.CUSTOM_GOOGLE.value, api_format="Google"
                ),
                build_model_data("openai", ModelType.CUSTOM_OPENAI.value),
            ]
        )
        manager.set_active_model_id("openai")

        ok = manager.delete_model("google")

        assert ok is True
        assert manager.activate_model_id == "openai"

    def test_reset_preset_model_skips_unmatched_and_updates_target(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("other", ModelType.PRESET.value),
                build_model_data("target", ModelType.PRESET.value),
            ]
        )
        monkeypatch.setattr(
            manager,
            "load_preset_models",
            lambda: [
                build_model_data("unmatched", ModelType.PRESET.value),
                {
                    **build_model_data("target", ModelType.PRESET.value),
                    "name": "target-updated",
                },
            ],
        )

        ok = manager.reset_preset_model("target")

        assert ok is True
        current = manager.get_model_by_id("target")
        assert isinstance(current, Model)
        assert current.name == "target-updated"

    def test_reset_preset_model_returns_false_when_replace_loop_cannot_find_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = ModelManager()

        monkeypatch.setattr(
            manager,
            "get_model_by_id",
            lambda _: Model.from_dict(
                build_model_data("target", ModelType.PRESET.value)
            ),
        )
        monkeypatch.setattr(
            manager,
            "load_preset_models",
            lambda: [build_model_data("target", ModelType.PRESET.value)],
        )

        assert manager.reset_preset_model("target") is False

    def test_reorder_models_ignores_unknown_id(self) -> None:
        manager = ModelManager()
        manager.set_models(
            [
                build_model_data("a", ModelType.PRESET.value),
                build_model_data("b", ModelType.CUSTOM_OPENAI.value),
            ]
        )

        manager.reorder_models(["missing", "b"])

        assert [model.id for model in manager.get_models()] == ["b", "a"]
