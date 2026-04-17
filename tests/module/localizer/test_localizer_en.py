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
