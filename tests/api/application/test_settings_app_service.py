from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config


def test_get_app_settings_returns_serializable_snapshot(
    settings_app_service,
) -> None:
    result = settings_app_service.get_app_settings({})

    settings = result["settings"]

    assert settings["app_language"] == BaseLanguage.Enum.ZH
    assert settings["project_save_mode"] == Config.ProjectSaveMode.MANUAL


def test_update_app_settings_persists_selected_keys(
    settings_app_service,
    fake_settings_config,
) -> None:
    result = settings_app_service.update_app_settings(
        {
            "target_language": BaseLanguage.Enum.EN,
            "request_timeout": 300,
        }
    )

    settings = result["settings"]

    assert settings["target_language"] == BaseLanguage.Enum.EN
    assert settings["request_timeout"] == 300
    assert fake_settings_config.save_calls == 1
    assert settings_app_service.emitted_events == [
        (
            Base.Event.CONFIG_UPDATED,
            {
                "keys": [
                    "target_language",
                    "request_timeout",
                ]
            },
        )
    ]


def test_update_app_settings_persists_laboratory_toggle_keys(
    settings_app_service,
    fake_settings_config,
) -> None:
    result = settings_app_service.update_app_settings(
        {
            "mtool_optimizer_enable": True,
            "force_thinking_enable": False,
        }
    )

    settings = result["settings"]

    assert settings["mtool_optimizer_enable"] is True
    assert settings["force_thinking_enable"] is False
    assert fake_settings_config.mtool_optimizer_enable is True
    assert fake_settings_config.force_thinking_enable is False
    assert settings_app_service.emitted_events == [
        (
            Base.Event.CONFIG_UPDATED,
            {"keys": ["mtool_optimizer_enable", "force_thinking_enable"]},
        )
    ]


def test_update_app_settings_ignores_removed_legacy_keys(
    settings_app_service,
    fake_settings_config,
) -> None:
    result = settings_app_service.update_app_settings(
        {
            "expert_mode": True,
            "proxy_enable": True,
            "proxy_url": "http://127.0.0.1:7890",
            "scale_factor": "1.25",
        }
    )

    assert "expert_mode" not in result["settings"]
    assert "proxy_enable" not in result["settings"]
    assert "proxy_url" not in result["settings"]
    assert "scale_factor" not in result["settings"]
    assert fake_settings_config.save_calls == 0
    assert settings_app_service.emitted_events == []


def test_add_recent_project_updates_recent_project_snapshot(
    settings_app_service,
) -> None:
    result = settings_app_service.add_recent_project(
        {"path": "E:/Project/LinguaGacha/output/demo.lg", "name": "source-dir"}
    )

    recent_projects = result["settings"]["recent_projects"]

    assert recent_projects == [
        {"path": "E:/Project/LinguaGacha/output/demo.lg", "name": "demo"}
    ]
    assert settings_app_service.emitted_events[-1] == (
        Base.Event.CONFIG_UPDATED,
        {"keys": ["recent_projects"]},
    )


def test_remove_recent_project_updates_recent_project_snapshot(
    settings_app_service,
    fake_settings_config,
) -> None:
    fake_settings_config.recent_projects = [
        {"path": "E:/Project/LinguaGacha/output/demo.lg", "name": "legacy-demo"},
        {"path": "E:/Project/LinguaGacha/output/other.lg", "name": "legacy-other"},
    ]

    result = settings_app_service.remove_recent_project(
        {"path": "E:/Project/LinguaGacha/output/demo.lg"}
    )

    recent_projects = result["settings"]["recent_projects"]

    assert recent_projects == [
        {"path": "E:/Project/LinguaGacha/output/other.lg", "name": "legacy-other"}
    ]
