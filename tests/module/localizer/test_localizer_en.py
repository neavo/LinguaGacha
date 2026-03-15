from pathlib import Path

from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


def test_localizer_en_inherits_from_zh() -> None:
    assert issubclass(LocalizerEN, LocalizerZH)


def test_localizer_en_and_zh_keep_same_annotation_keys() -> None:
    assert set(LocalizerZH.__annotations__) == set(LocalizerEN.__annotations__)


def test_localizer_en_and_zh_files_keep_same_line_count() -> None:
    project_root = Path(__file__).resolve().parents[3]
    zh_path = project_root / "module" / "Localizer" / "LocalizerZH.py"
    en_path = project_root / "module" / "Localizer" / "LocalizerEN.py"

    zh_line_count = len(zh_path.read_text(encoding="utf-8").splitlines())
    en_line_count = len(en_path.read_text(encoding="utf-8").splitlines())

    assert zh_line_count == en_line_count
