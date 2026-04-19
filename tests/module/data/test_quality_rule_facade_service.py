from types import SimpleNamespace
from unittest.mock import MagicMock

from module.Data.Quality.QualityRuleFacadeService import QualityRuleFacadeService
from module.QualityRule.QualityRuleIO import QualityRuleIO


def build_facade() -> QualityRuleFacadeService:
    return QualityRuleFacadeService(SimpleNamespace(), SimpleNamespace())


def test_facade_forwards_preset_and_prompt_methods() -> None:
    facade = build_facade()
    facade.preset_service = SimpleNamespace(
        list_presets=MagicMock(return_value=(["builtin"], ["user"])),
        read_preset=MagicMock(return_value="预设内容"),
        save_user_preset=MagicMock(return_value="/tmp/preset.txt"),
        rename_user_preset=MagicMock(return_value={"name": "新名字"}),
        delete_user_preset=MagicMock(return_value="/tmp/deleted.txt"),
    )
    facade.prompt_service = SimpleNamespace(
        get_prompt_snapshot=MagicMock(return_value={"task_type": "translation"}),
        save_prompt=MagicMock(return_value={"task_type": "translation"}),
        get_default_preset_text=MagicMock(return_value="默认预设"),
    )

    assert facade.list_presets("translation") == (["builtin"], ["user"])
    assert facade.read_preset("translation", "builtin:sample.txt") == "预设内容"
    assert facade.save_user_preset("translation", "新预设", "文本") == "/tmp/preset.txt"
    assert facade.rename_user_preset(
        "translation",
        "user:old.txt",
        "新名字",
    ) == {"name": "新名字"}
    assert (
        facade.delete_user_preset("translation", "user:old.txt") == "/tmp/deleted.txt"
    )
    assert (
        facade.get_default_preset_text("translation", "builtin:default.txt")
        == "默认预设"
    )
    assert facade.get_prompt_snapshot("translation") == {"task_type": "translation"}
    assert facade.save_prompt(
        "translation",
        expected_revision=0,
        text="新内容",
        enabled=True,
    ) == {"task_type": "translation"}


def test_facade_forwards_snapshot_and_mutation_methods() -> None:
    facade = build_facade()
    call_log: list[tuple[object, ...]] = []
    facade.snapshot_service = SimpleNamespace(
        get_rule_snapshot=lambda rule_type: (
            call_log.append(("snapshot", rule_type))
            or {"rule_type": rule_type, "revision": 3}
        )
    )
    facade.mutation_service = SimpleNamespace(
        save_entries=lambda rule_type, **kwargs: (
            call_log.append(("save_entries", rule_type, kwargs)) or {"kind": "save"}
        ),
        delete_entry=lambda rule_type, **kwargs: (
            call_log.append(("delete_entry", rule_type, kwargs)) or {"kind": "delete"}
        ),
        sort_entries=lambda rule_type, **kwargs: (
            call_log.append(("sort_entries", rule_type, kwargs)) or {"kind": "sort"}
        ),
        set_rule_enabled=lambda rule_type, **kwargs: (
            call_log.append(("set_rule_enabled", rule_type, kwargs))
            or {"kind": "toggle"}
        ),
        update_meta=lambda rule_type, **kwargs: (
            call_log.append(("update_meta", rule_type, kwargs)) or {"kind": "meta"}
        ),
    )

    assert facade.get_rule_snapshot("glossary") == {
        "rule_type": "glossary",
        "revision": 3,
    }
    assert facade.save_entries(
        "glossary",
        expected_revision=1,
        entries=[{"src": "HP", "dst": "生命"}],
    ) == {"kind": "save"}
    assert facade.delete_entry(
        "glossary",
        expected_revision=1,
        index=2,
    ) == {"kind": "delete"}
    assert facade.sort_entries(
        "glossary",
        expected_revision=1,
        reverse=True,
    ) == {"kind": "sort"}
    assert facade.set_rule_enabled(
        "glossary",
        expected_revision=1,
        enabled=False,
    ) == {"kind": "toggle"}
    assert facade.update_meta(
        "glossary",
        expected_revision=1,
        meta_key="glossary_enable",
        value=False,
    ) == {"kind": "meta"}
    assert call_log == [
        ("snapshot", "glossary"),
        (
            "save_entries",
            "glossary",
            {
                "expected_revision": 1,
                "entries": [{"src": "HP", "dst": "生命"}],
            },
        ),
        ("delete_entry", "glossary", {"expected_revision": 1, "index": 2}),
        ("sort_entries", "glossary", {"expected_revision": 1, "reverse": True}),
        ("set_rule_enabled", "glossary", {"expected_revision": 1, "enabled": False}),
        (
            "update_meta",
            "glossary",
            {
                "expected_revision": 1,
                "meta_key": "glossary_enable",
                "value": False,
            },
        ),
    ]


def test_facade_import_and_export_rules_use_quality_rule_io(monkeypatch) -> None:
    facade = build_facade()
    exported: list[tuple[str, list[dict[str, str]]]] = []

    monkeypatch.setattr(
        QualityRuleIO,
        "load_rules_from_file",
        lambda path: [{"loaded_from": path}],
    )
    monkeypatch.setattr(
        QualityRuleIO,
        "export_rules",
        lambda path, entries: exported.append((path, entries)),
    )

    imported_rules = facade.import_rules(
        "glossary",
        "/workspace/rules/demo.json",
        expected_revision=9,
    )
    exported_path = facade.export_rules(
        "glossary",
        "/workspace/rules/demo.rules",
        [{"src": "HP", "dst": "生命"}],
    )

    assert imported_rules == [{"loaded_from": "/workspace/rules/demo.json"}]
    assert [(path.replace("\\", "/"), entries) for path, entries in exported] == [
        ("/workspace/rules/demo", [{"src": "HP", "dst": "生命"}]),
    ]
    assert exported_path == "/workspace/rules/demo.json"
