from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config


def test_get_app_settings_returns_serializable_snapshot(
    settings_app_service,
) -> None:
    result = settings_app_service.get_app_settings({})

    settings = result["settings"]

    assert settings["theme"] == Config.Theme.LIGHT
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
            "proxy_enable": True,
            "proxy_url": "http://127.0.0.1:7890",
        }
    )

    settings = result["settings"]

    assert settings["target_language"] == BaseLanguage.Enum.EN
    assert settings["request_timeout"] == 300
    assert settings["proxy_enable"] is True
    assert settings["proxy_url"] == "http://127.0.0.1:7890"
    assert fake_settings_config.save_calls == 1
    assert settings_app_service.emitted_events == [
        (
            Base.Event.CONFIG_UPDATED,
            {
                "keys": [
                    "target_language",
                    "request_timeout",
                    "proxy_enable",
                    "proxy_url",
                ]
            },
        )
    ]


def test_update_expert_mode_resets_expert_settings_before_save(
    settings_app_service,
    fake_settings_config,
) -> None:
    fake_settings_config.clean_ruby = False

    result = settings_app_service.update_app_settings({"expert_mode": True})

    assert result["settings"]["expert_mode"] is True
    assert fake_settings_config.reset_calls == 1
    assert fake_settings_config.clean_ruby is True


def test_add_recent_project_updates_recent_project_snapshot(
    settings_app_service,
) -> None:
    result = settings_app_service.add_recent_project(
        {"path": "demo.lg", "name": "demo"}
    )

    recent_projects = result["settings"]["recent_projects"]

    assert recent_projects == [{"path": "demo.lg", "name": "demo"}]
    assert settings_app_service.emitted_events[-1] == (
        Base.Event.CONFIG_UPDATED,
        {"keys": ["recent_projects"]},
    )


def test_remove_recent_project_updates_recent_project_snapshot(
    settings_app_service,
    fake_settings_config,
) -> None:
    fake_settings_config.recent_projects = [
        {"path": "demo.lg", "name": "demo"},
        {"path": "other.lg", "name": "other"},
    ]

    result = settings_app_service.remove_recent_project({"path": "demo.lg"})

    recent_projects = result["settings"]["recent_projects"]

    assert recent_projects == [{"path": "other.lg", "name": "other"}]
