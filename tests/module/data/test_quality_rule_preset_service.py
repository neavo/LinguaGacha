from module.Data.Quality.QualityRulePresetService import QualityRulePresetService
from module.QualityRulePathResolver import QualityRulePathResolver


def test_quality_rule_preset_service_forwards_all_resolver_methods(monkeypatch) -> None:
    service = QualityRulePresetService()
    call_log: list[tuple[object, ...]] = []

    monkeypatch.setattr(
        QualityRulePathResolver,
        "list_presets",
        lambda preset_dir_name: (
            call_log.append(("list", preset_dir_name))
            or ([{"name": "builtin"}], [{"name": "user"}])
        ),
    )
    monkeypatch.setattr(
        QualityRulePathResolver,
        "read_preset",
        lambda preset_dir_name, virtual_id: (
            call_log.append(("read", preset_dir_name, virtual_id))
            or [{"src": "HP", "dst": "生命"}]
        ),
    )
    monkeypatch.setattr(
        QualityRulePathResolver,
        "save_user_preset",
        lambda preset_dir_name, name, data: (
            call_log.append(("save", preset_dir_name, name, tuple(data)))
            or {"name": name, "virtual_id": "user:new.json"}
        ),
    )
    monkeypatch.setattr(
        QualityRulePathResolver,
        "rename_user_preset",
        lambda preset_dir_name, virtual_id, new_name: (
            call_log.append(("rename", preset_dir_name, virtual_id, new_name))
            or {"name": new_name, "virtual_id": virtual_id}
        ),
    )
    monkeypatch.setattr(
        QualityRulePathResolver,
        "delete_user_preset",
        lambda preset_dir_name, virtual_id: (
            call_log.append(("delete", preset_dir_name, virtual_id))
            or "/workspace/user/demo.json"
        ),
    )

    assert service.list_presets("glossary") == (
        [{"name": "builtin"}],
        [{"name": "user"}],
    )
    assert service.read_preset("glossary", "builtin:default.json") == [
        {"src": "HP", "dst": "生命"}
    ]
    assert service.save_user_preset(
        "glossary",
        "新预设",
        [{"src": "HP", "dst": "生命"}],
    ) == {"name": "新预设", "virtual_id": "user:new.json"}
    assert service.rename_user_preset(
        "glossary",
        "user:old.json",
        "新名字",
    ) == {"name": "新名字", "virtual_id": "user:old.json"}
    assert (
        service.delete_user_preset("glossary", "user:old.json")
        == "/workspace/user/demo.json"
    )
    assert call_log == [
        ("list", "glossary"),
        ("read", "glossary", "builtin:default.json"),
        ("save", "glossary", "新预设", ({"src": "HP", "dst": "生命"},)),
        ("rename", "glossary", "user:old.json", "新名字"),
        ("delete", "glossary", "user:old.json"),
    ]
