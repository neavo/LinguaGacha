from pathlib import Path

from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


def test_localizer_en_inherits_from_zh() -> None:
    assert issubclass(LocalizerEN, LocalizerZH)


def test_localizer_en_declares_same_text_keys_as_zh() -> None:
    assert set(LocalizerZH.__annotations__) == set(LocalizerEN.__annotations__)


def test_localizer_en_declares_non_empty_text_values_for_all_keys() -> None:
    assert LocalizerEN.__annotations__

    for key in LocalizerEN.__annotations__:
        value = getattr(LocalizerEN, key)
        assert isinstance(value, str), f"{key} 必须是字符串"
        assert value != "", f"{key} 不应为空字符串"


def test_localizer_en_source_file_keeps_same_line_count_as_zh() -> None:
    project_root = Path(__file__).resolve().parents[3]
    zh_path = project_root / "module" / "Localizer" / "LocalizerZH.py"
    en_path = project_root / "module" / "Localizer" / "LocalizerEN.py"

    zh_line_count = len(zh_path.read_text(encoding="utf-8").splitlines())
    en_line_count = len(en_path.read_text(encoding="utf-8").splitlines())

    assert zh_line_count == en_line_count
