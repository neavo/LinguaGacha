from string import Formatter

from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


def get_public_text_catalog(bundle: type[LocalizerZH]) -> dict[str, str]:
    return {
        key: value
        for key, value in vars(bundle).items()
        if not key.startswith("_") and isinstance(value, str)
    }


def get_placeholder_names(text: str) -> set[str]:
    formatter = Formatter()
    placeholder_names: set[str] = set()
    for _, field_name, _, _ in formatter.parse(text):
        if field_name:
            placeholder_names.add(field_name)
    return placeholder_names


def test_localizer_en_catalog_contains_non_empty_strings() -> None:
    # Arrange
    catalog = get_public_text_catalog(LocalizerEN)

    # Act / Assert
    assert catalog
    for key, value in catalog.items():
        assert value != "", f"{key} 不应为空字符串"


def test_localizer_en_templates_can_be_formatted_with_public_placeholders() -> None:
    # Arrange
    catalog = get_public_text_catalog(LocalizerEN)

    # Act / Assert
    for key, value in catalog.items():
        placeholder_values = {
            field_name: f"<{field_name}>" for field_name in get_placeholder_names(value)
        }
        formatted_value = value.format(**placeholder_values)

        assert isinstance(formatted_value, str), f"{key} 应保持为可展示文本"


def test_localizer_en_overrides_zh_catalog_with_same_placeholders() -> None:
    # Arrange
    zh_catalog = get_public_text_catalog(LocalizerZH)
    en_catalog = get_public_text_catalog(LocalizerEN)

    # Act / Assert
    assert en_catalog.keys() == zh_catalog.keys()
    for key in en_catalog:
        assert get_placeholder_names(en_catalog[key]) == get_placeholder_names(
            zh_catalog[key]
        ), f"{key} 的中英文占位符集合应保持一致"
