from __future__ import annotations

import os
from collections.abc import Callable

import pytest

import base.BasePath as base_path_module
from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath


@pytest.fixture(autouse=True)
def reset_base_path_state() -> None:
    BasePath.reset_for_test()
    yield
    BasePath.reset_for_test()


def test_initialize_caches_app_dir_and_resolved_data_dir(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        BasePath,
        "resolve_data_dir",
        lambda app_dir, is_frozen: ("C:/data", "app_dir_not_writable"),
    )

    reason = BasePath.initialize("C:/app", is_frozen=True)

    assert reason == "app_dir_not_writable"
    assert BasePath.APP_DIR == "C:/app"
    assert BasePath.DATA_DIR == "C:/data"


def test_resolve_app_dir_uses_frozen_executable_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(base_path_module.sys, "frozen", True, raising=False)
    monkeypatch.setattr(
        base_path_module.sys,
        "executable",
        "C:/Program Files/LinguaGacha/LinguaGacha.exe",
    )

    result = BasePath.resolve_app_dir()

    assert result == os.path.abspath("C:/Program Files/LinguaGacha")


@pytest.mark.parametrize(
    ("is_frozen", "is_appimage", "is_macos_bundle", "can_write", "expected"),
    [
        (True, True, False, True, ("C:/Users/demo/LinguaGacha", "appimage")),
        (
            True,
            False,
            True,
            True,
            ("C:/Users/demo/LinguaGacha", "macos_app_bundle"),
        ),
        (False, False, False, True, ("C:/app", None)),
        (
            False,
            False,
            False,
            False,
            ("C:/Users/demo/LinguaGacha", "app_dir_not_writable"),
        ),
    ],
)
def test_resolve_data_dir_selects_single_writable_location(
    monkeypatch: pytest.MonkeyPatch,
    is_frozen: bool,
    is_appimage: bool,
    is_macos_bundle: bool,
    can_write: bool,
    expected: tuple[str, str | None],
) -> None:
    monkeypatch.setattr(
        BasePath, "get_home_data_dir", lambda: "C:/Users/demo/LinguaGacha"
    )
    monkeypatch.setattr(BasePath, "is_appimage_runtime", lambda: is_appimage)
    monkeypatch.setattr(
        BasePath, "is_macos_app_bundle", lambda app_dir: is_macos_bundle
    )
    monkeypatch.setattr(BasePath, "can_write_directory", lambda app_dir: can_write)

    result = BasePath.resolve_data_dir("C:/app", is_frozen)

    assert result == expected


def test_get_app_dir_and_data_dir_fall_back_to_resolved_runtime_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(BasePath, "resolve_app_dir", lambda: "C:/runtime")

    assert BasePath.get_app_dir() == "C:/runtime"
    assert BasePath.get_data_dir() == "C:/runtime"
    assert BasePath.APP_DIR == "C:/runtime"
    assert BasePath.DATA_DIR == "C:/runtime"


def test_can_write_directory_uses_real_probe_file(fs) -> None:
    directory = "C:/workspace"
    fs.create_dir(directory)

    assert BasePath.can_write_directory(directory) is True


def test_can_write_directory_returns_false_when_probe_creation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_permission_error(*args: object, **kwargs: object) -> tuple[int, str]:
        del args, kwargs
        raise PermissionError("denied")

    monkeypatch.setattr(base_path_module.tempfile, "mkstemp", raise_permission_error)

    assert BasePath.can_write_directory("C:/locked") is False


@pytest.mark.parametrize(
    ("resolver", "expected"),
    [
        (lambda: BasePath.get_resource_dir(), os.path.join("C:/app", "resource")),
        (
            lambda: BasePath.get_resource_relative_dir("quality", "preset"),
            os.path.join("resource", "quality", "preset"),
        ),
        (
            lambda: BasePath.get_resource_path("update", "script.ps1"),
            os.path.join("C:/app", "resource", "update", "script.ps1"),
        ),
        (
            lambda: BasePath.get_user_data_root_dir(),
            os.path.join("C:/data", "userdata"),
        ),
        (
            lambda: BasePath.get_user_data_path("config.json"),
            os.path.join("C:/data", "userdata", "config.json"),
        ),
        (lambda: BasePath.get_log_dir(), os.path.join("C:/data", "log")),
        (
            lambda: BasePath.get_update_template_dir(),
            os.path.join("C:/app", "resource", "update"),
        ),
        (
            lambda: BasePath.get_update_runtime_dir(),
            os.path.join("C:/data", "userdata", "update"),
        ),
        (
            lambda: BasePath.get_update_legacy_runtime_dir(),
            os.path.join("C:/app", "resource", "update"),
        ),
        (
            lambda: BasePath.get_update_dir(),
            os.path.join("C:/data", "userdata", "update"),
        ),
        (
            lambda: BasePath.get_prompt_user_preset_dir("translation"),
            os.path.join("C:/data", "userdata", "translation"),
        ),
        (
            lambda: BasePath.get_prompt_template_dir(
                "translation",
                BaseLanguage.Enum.EN,
            ),
            os.path.join("C:/app", "resource", "translation", "template", "en"),
        ),
        (
            lambda: BasePath.get_prompt_builtin_preset_dir("translation"),
            os.path.join("C:/app", "resource", "translation", "preset"),
        ),
        (
            lambda: BasePath.get_prompt_builtin_preset_relative_dir("translation"),
            os.path.join("resource", "translation", "preset"),
        ),
        (
            lambda: BasePath.get_prompt_legacy_user_preset_dir(BaseLanguage.Enum.JA),
            os.path.join("C:/app", "resource", "preset", "custom_prompt", "user", "ja"),
        ),
        (
            lambda: BasePath.get_quality_rule_builtin_preset_dir(
                BasePath.GLOSSARY_DIR_NAME
            ),
            os.path.join("C:/app", "resource", "glossary", "preset"),
        ),
        (
            lambda: BasePath.get_quality_rule_builtin_preset_relative_dir(
                BasePath.GLOSSARY_DIR_NAME
            ),
            os.path.join("resource", "glossary", "preset"),
        ),
        (
            lambda: BasePath.get_quality_rule_user_preset_dir(
                BasePath.GLOSSARY_DIR_NAME
            ),
            os.path.join("C:/data", "userdata", "glossary"),
        ),
        (
            lambda: BasePath.get_quality_rule_legacy_user_preset_dir(
                BasePath.GLOSSARY_DIR_NAME
            ),
            os.path.join("C:/app", "resource", "preset", "glossary", "user"),
        ),
        (
            lambda: BasePath.get_quality_rule_legacy_builtin_preset_dir(
                BasePath.TEXT_PRESERVE_DIR_NAME,
                BaseLanguage.Enum.KO,
            ),
            os.path.join("C:/app", "resource", "preset", "text_preserve", "ko"),
        ),
        (
            lambda: BasePath.get_model_preset_dir(BaseLanguage.Enum.ZH),
            os.path.join("C:/app", "resource", "preset", "model", "zh"),
        ),
        (
            lambda: BasePath.get_model_preset_dir(BaseLanguage.Enum.EN),
            os.path.join("C:/app", "resource", "preset", "model", "en"),
        ),
        (
            lambda: BasePath.get_text_preserve_preset_dir(),
            os.path.join("C:/app", "resource", "text_preserve", "preset"),
        ),
    ],
)
def test_path_helpers_build_paths_from_cached_roots(
    resolver: Callable[[], str],
    expected: str,
) -> None:
    BasePath.APP_DIR = "C:/app"
    BasePath.DATA_DIR = "C:/data"

    assert resolver() == expected


def test_get_language_dir_name_normalizes_language_enum() -> None:
    assert BasePath.get_language_dir_name(BaseLanguage.Enum.TR) == "tr"
