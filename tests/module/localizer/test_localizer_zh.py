from module.Localizer.LocalizerZH import LocalizerZH


def test_localizer_zh_declares_non_empty_text_values_for_all_keys() -> None:
    assert LocalizerZH.__annotations__

    for key in LocalizerZH.__annotations__:
        value = getattr(LocalizerZH, key)
        assert isinstance(value, str), f"{key} 必须是字符串"
        assert value != "", f"{key} 不应为空字符串"
