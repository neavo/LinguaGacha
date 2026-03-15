from module.Localizer.LocalizerZH import LocalizerZH


def test_localizer_zh_declares_all_text_keys_as_strings() -> None:
    for key in LocalizerZH.__annotations__:
        value = getattr(LocalizerZH, key)
        assert isinstance(value, str)
        assert value != ""
