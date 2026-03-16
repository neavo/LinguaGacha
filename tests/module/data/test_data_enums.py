import pytest

from module.Data.Core.DataEnums import TextPreserveMode


def test_text_preserve_mode_values_are_stable() -> None:
    assert TextPreserveMode.OFF.value == "off"
    assert TextPreserveMode.SMART.value == "smart"
    assert TextPreserveMode.CUSTOM.value == "custom"


def test_text_preserve_mode_accepts_valid_value_and_rejects_invalid() -> None:
    assert TextPreserveMode("smart") is TextPreserveMode.SMART

    with pytest.raises(ValueError):
        TextPreserveMode("broken")
