from __future__ import annotations

from copy import deepcopy
from importlib import import_module

from api.v2.Application.QualityRuleAppService import QualityRuleAppService
from base.BaseLanguage import BaseLanguage

quality_rule_app_service_module = import_module(
    "api.v2.Application.QualityRuleAppService"
)


class RecordingQualityRuleFacade:
    """记录应用服务对门面的调用参数，避免测试只盯着 mock 细节。"""

    def __init__(self) -> None:
        self.operations: list[dict[str, object]] = []
        self.snapshot = {
            "rule_type": "glossary",
            "revision": 3,
            "meta": {"enabled": True},
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
        self.update_meta_result = deepcopy(self.snapshot)
        self.imported_entries = [{"src": "勇者", "dst": "Hero"}]
        self.exported_path = "demo/export/glossary.json"
        self.builtin_presets = [
            {
                "name": "内置预设",
                "virtual_id": "builtin:demo.json",
                "path": "resource/demo.json",
                "type": "builtin",
            }
        ]
        self.user_presets = [
            {
                "name": "用户预设",
                "virtual_id": "user:demo.json",
                "path": "user/demo.json",
                "type": "user",
            }
        ]
        self.preset_entries = [{"src": "勇者", "dst": "Hero"}]
        self.saved_preset_item = {
            "name": "我的预设",
            "virtual_id": "user:mine.json",
            "path": "user/mine.json",
            "type": "user",
        }
        self.renamed_preset_item = {
            "name": "新预设",
            "virtual_id": "user:new.json",
            "path": "user/new.json",
            "type": "user",
        }
        self.deleted_preset_path = "user/demo.json"
        self.saved_prompt_snapshot = {"task_type": "translation", "text": "saved"}
        self.imported_prompt_text = "imported"
        self.exported_prompt_path = "demo/output/prompt.txt"
        self.builtin_prompt_presets = [
            {"virtual_id": "builtin:translation.txt", "name": "内置预设"}
        ]
        self.user_prompt_presets = [
            {"virtual_id": "user:translation.txt", "name": "用户预设"}
        ]
        self.prompt_preset_text = "preset body"
        self.saved_prompt_preset_path = "user/new.txt"
        self.renamed_prompt_item = {
            "virtual_id": "user/renamed.txt",
            "name": "新名字",
        }
        self.deleted_prompt_path = "user/removed.txt"

    def record(self, operation_name: str, **payload: object) -> None:
        self.operations.append({"operation": operation_name, **payload})

    def save_entries(
        self,
        rule_type: str,
        *,
        expected_revision: int,
        entries: list[dict[str, object]],
    ) -> dict[str, object]:
        self.record(
            "save_entries",
            rule_type=rule_type,
            expected_revision=expected_revision,
            entries=deepcopy(entries),
        )
        return deepcopy(self.snapshot)

    def set_rule_enabled(
        self,
        rule_type: str,
        *,
        expected_revision: int,
        enabled: bool,
    ) -> dict[str, object]:
        self.record(
            "set_rule_enabled",
            rule_type=rule_type,
            expected_revision=expected_revision,
            enabled=enabled,
        )
        snapshot = deepcopy(self.snapshot)
        snapshot["meta"] = {"enabled": enabled}
        return snapshot

    def update_meta(
        self,
        rule_type: str,
        *,
        expected_revision: int,
        meta_key: str,
        value: object,
    ) -> dict[str, object]:
        self.record(
            "update_meta",
            rule_type=rule_type,
            expected_revision=expected_revision,
            meta_key=meta_key,
            value=value,
        )
        return deepcopy(self.update_meta_result)

    def import_rules(
        self,
        rule_type: str,
        path: str,
        *,
        expected_revision: int,
    ) -> list[dict[str, object]]:
        self.record(
            "import_rules",
            rule_type=rule_type,
            path=path,
            expected_revision=expected_revision,
        )
        return deepcopy(self.imported_entries)

    def export_rules(
        self,
        rule_type: str,
        path: str,
        entries: list[dict[str, object]],
    ) -> str:
        self.record(
            "export_rules",
            rule_type=rule_type,
            path=path,
            entries=deepcopy(entries),
        )
        return self.exported_path

    def list_presets(
        self,
        preset_dir_name: str,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        self.record("list_presets", preset_dir_name=preset_dir_name)
        return deepcopy(self.builtin_presets), deepcopy(self.user_presets)

    def read_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> list[dict[str, object]]:
        self.record(
            "read_preset",
            preset_dir_name=preset_dir_name,
            virtual_id=virtual_id,
        )
        return deepcopy(self.preset_entries)

    def save_user_preset(
        self,
        preset_dir_name: str,
        name: str,
        entries: list[dict[str, object]],
    ) -> dict[str, object]:
        self.record(
            "save_user_preset",
            preset_dir_name=preset_dir_name,
            name=name,
            entries=deepcopy(entries),
        )
        return deepcopy(self.saved_preset_item)

    def rename_user_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, object]:
        self.record(
            "rename_user_preset",
            preset_dir_name=preset_dir_name,
            virtual_id=virtual_id,
            new_name=new_name,
        )
        return deepcopy(self.renamed_preset_item)

    def delete_user_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> str:
        self.record(
            "delete_user_preset",
            preset_dir_name=preset_dir_name,
            virtual_id=virtual_id,
        )
        return self.deleted_preset_path

    def save_prompt(
        self,
        task_type: str,
        *,
        expected_revision: int,
        text: str,
        enabled: bool | None,
    ) -> dict[str, object]:
        self.record(
            "save_prompt",
            task_type=task_type,
            expected_revision=expected_revision,
            text=text,
            enabled=enabled,
        )
        return deepcopy(self.saved_prompt_snapshot)

    def read_prompt_import_text(
        self,
        task_type: str,
        path: str,
    ) -> str:
        self.record(
            "read_prompt_import_text",
            task_type=task_type,
            path=path,
        )
        return self.imported_prompt_text

    def export_prompt(self, task_type: str, path: str) -> str:
        self.record("export_prompt", task_type=task_type, path=path)
        return self.exported_prompt_path

    def list_prompt_presets(
        self,
        task_type: str,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        self.record("list_prompt_presets", task_type=task_type)
        return (
            deepcopy(self.builtin_prompt_presets),
            deepcopy(self.user_prompt_presets),
        )

    def read_prompt_preset(self, task_type: str, virtual_id: str) -> str:
        self.record(
            "read_prompt_preset",
            task_type=task_type,
            virtual_id=virtual_id,
        )
        return self.prompt_preset_text

    def save_prompt_preset(self, task_type: str, name: str, text: str) -> str:
        self.record(
            "save_prompt_preset",
            task_type=task_type,
            name=name,
            text=text,
        )
        return self.saved_prompt_preset_path

    def rename_prompt_preset(
        self,
        task_type: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, object]:
        self.record(
            "rename_prompt_preset",
            task_type=task_type,
            virtual_id=virtual_id,
            new_name=new_name,
        )
        return deepcopy(self.renamed_prompt_item)

    def delete_prompt_preset(self, task_type: str, virtual_id: str) -> str:
        self.record(
            "delete_prompt_preset",
            task_type=task_type,
            virtual_id=virtual_id,
        )
        return self.deleted_prompt_path


def build_fake_quality_rule_facade() -> RecordingQualityRuleFacade:
    """构造记录型门面桩，固定 app service 的参数归一化行为。"""

    return RecordingQualityRuleFacade()


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

    assert facade.operations[-1] == {
        "operation": "set_rule_enabled",
        "rule_type": "glossary",
        "expected_revision": 3,
        "enabled": False,
    }
    assert result == {
        "accepted": True,
        "projectRevision": 0,
        "sectionRevisions": {"quality": 0},
    }


def test_update_quality_rule_meta_maps_text_preserve_mode_to_core_key() -> None:
    facade = build_fake_quality_rule_facade()
    facade.update_meta_result = {
        "rule_type": "text_preserve",
        "revision": 2,
        "meta": {"mode": "SMART"},
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

    assert facade.operations[-1] == {
        "operation": "update_meta",
        "rule_type": "text_preserve",
        "expected_revision": 2,
        "meta_key": "text_preserve_mode",
        "value": "SMART",
    }
    assert result == {
        "accepted": True,
        "projectRevision": 0,
        "sectionRevisions": {"quality": 0},
    }


def test_save_quality_rule_entries_returns_minimal_ack() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.save_rule_entries(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "entries": [{"src": "勇者", "dst": "Hero"}],
        }
    )

    assert facade.operations[-1] == {
        "operation": "save_entries",
        "rule_type": "glossary",
        "expected_revision": 3,
        "entries": [{"src": "勇者", "dst": "Hero"}],
    }
    assert result == {
        "accepted": True,
        "projectRevision": 0,
        "sectionRevisions": {"quality": 0},
    }


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


def test_save_prompt_returns_minimal_ack() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    saved_prompt = app_service.save_prompt(
        {
            "task_type": "translation",
            "expected_revision": 7,
            "text": "next prompt",
            "enabled": False,
        }
    )

    assert facade.operations[-1] == {
        "operation": "save_prompt",
        "task_type": "translation",
        "expected_revision": 7,
        "text": "next prompt",
        "enabled": False,
    }
    assert saved_prompt == {
        "accepted": True,
        "projectRevision": 0,
        "sectionRevisions": {"prompts": 0},
    }


def test_prompt_import_text_export_and_presets_keep_payload_shapes() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    imported_prompt = app_service.read_prompt_import_text(
        {
            "task_type": "translation",
            "path": "demo/input.txt",
        }
    )
    exported_path = app_service.export_prompt(
        {
            "task_type": "translation",
            "path": "demo/output.txt",
        }
    )
    presets = app_service.list_prompt_presets({"task_type": "translation"})
    preset_text = app_service.read_prompt_preset(
        {
            "task_type": "translation",
            "virtual_id": "builtin:translation.txt",
        }
    )
    saved_path = app_service.save_prompt_preset(
        {
            "task_type": "translation",
            "name": "我的预设",
            "text": "preset body",
        }
    )
    renamed_item = app_service.rename_prompt_preset(
        {
            "task_type": "translation",
            "virtual_id": "user/old.txt",
            "new_name": "新名字",
        }
    )
    deleted_path = app_service.delete_prompt_preset(
        {
            "task_type": "translation",
            "virtual_id": "user/removed.txt",
        }
    )

    assert imported_prompt == {"text": "imported"}
    assert exported_path == {"path": "demo/output/prompt.txt"}
    assert presets["builtin_presets"][0]["virtual_id"] == "builtin:translation.txt"
    assert preset_text == {"text": "preset body"}
    assert saved_path == {"path": "user/new.txt"}
    assert renamed_item == {
        "item": {"virtual_id": "user/renamed.txt", "name": "新名字"}
    }
    assert deleted_path == {"path": "user/removed.txt"}


def test_import_rules_returns_entries_payload() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.import_rules(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "path": "demo/input.json",
        }
    )

    assert facade.operations[-1] == {
        "operation": "import_rules",
        "rule_type": "glossary",
        "path": "demo/input.json",
        "expected_revision": 3,
    }
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

    assert facade.operations[-1] == {
        "operation": "export_rules",
        "rule_type": "glossary",
        "path": "demo/output.json",
        "entries": [{"src": "勇者", "dst": "Hero"}],
    }
    assert result["path"] == "demo/export/glossary.json"


def test_list_rule_presets_returns_items() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.list_rule_presets({"preset_dir_name": "glossary"})

    assert facade.operations[-1] == {
        "operation": "list_presets",
        "preset_dir_name": "glossary",
    }
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

    assert facade.operations[-1] == {
        "operation": "read_preset",
        "preset_dir_name": "glossary",
        "virtual_id": "builtin:demo.json",
    }
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

    assert facade.operations[-1] == {
        "operation": "save_user_preset",
        "preset_dir_name": "glossary",
        "name": "我的预设",
        "entries": [{"src": "勇者", "dst": "Hero"}],
    }
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

    assert facade.operations[-1] == {
        "operation": "rename_user_preset",
        "preset_dir_name": "glossary",
        "virtual_id": "user:demo.json",
        "new_name": "新预设",
    }
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

    assert facade.operations[-1] == {
        "operation": "delete_user_preset",
        "preset_dir_name": "glossary",
        "virtual_id": "user:demo.json",
    }
    assert result["path"] == "user/demo.json"
