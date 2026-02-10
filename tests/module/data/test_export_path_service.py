import re
from pathlib import Path

import pytest

from module.Data.ExportPathService import ExportPathService
from module.Localizer.Localizer import Localizer


@pytest.fixture
def patched_localizer(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeLocalizer:
        path_translated = "Translated"
        path_translated_bilingual = "Translated_Bilingual"

    monkeypatch.setattr(Localizer, "get", staticmethod(lambda: FakeLocalizer))


def test_custom_suffix_context_restores_value() -> None:
    service = ExportPathService()
    service.set_custom_suffix("_old")

    with service.custom_suffix_context("_new"):
        assert service.get_custom_suffix() == "_new"

    assert service.get_custom_suffix() == "_old"


def test_timestamp_suffix_context_without_existing_dirs_uses_empty_suffix(
    patched_localizer: None,
    fs,
) -> None:
    del patched_localizer
    del fs
    service = ExportPathService()
    root_path = Path("/workspace/export_path")
    lg_path = str(root_path / "project.lg")
    service.set_timestamp_suffix("_old")

    with service.timestamp_suffix_context(lg_path):
        assert service.get_timestamp_suffix() == ""

    assert service.get_timestamp_suffix() == "_old"


def test_timestamp_suffix_context_with_existing_dir_generates_timestamp(
    patched_localizer: None,
    fs,
) -> None:
    del patched_localizer
    del fs
    service = ExportPathService()
    root_path = Path("/workspace/export_path")
    lg_path = str(root_path / "project.lg")
    (root_path / "project_Translated").mkdir(parents=True)

    with service.timestamp_suffix_context(lg_path):
        suffix = service.get_timestamp_suffix()
        assert re.fullmatch(r"_\d{8}_\d{6}", suffix)

    assert service.get_timestamp_suffix() == ""


def test_get_paths_include_custom_and_timestamp_suffix(
    patched_localizer: None,
    fs,
) -> None:
    del patched_localizer
    del fs
    service = ExportPathService()
    lg_path = "/workspace/export_path/project.lg"
    service.set_custom_suffix("_v2")
    service.set_timestamp_suffix("_20260110_123000")

    translated_path = Path(service.get_translated_path(lg_path))
    bilingual_path = Path(service.get_bilingual_path(lg_path))

    assert translated_path.name == "project_Translated_v2_20260110_123000"
    assert bilingual_path.name == "project_Translated_Bilingual_v2_20260110_123000"


def test_ensure_paths_create_directories(
    patched_localizer: None,
    fs,
) -> None:
    del patched_localizer
    del fs
    service = ExportPathService()
    lg_path = "/workspace/export_path/project.lg"

    translated_path = Path(service.ensure_translated_path(lg_path))
    bilingual_path = Path(service.ensure_bilingual_path(lg_path))

    assert translated_path.is_dir()
    assert bilingual_path.is_dir()
