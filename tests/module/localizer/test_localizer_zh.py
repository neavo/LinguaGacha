from string import Formatter

from module.Localizer.LocalizerZH import LocalizerZH


def get_public_text_catalog() -> dict[str, str]:
    return {
        key: value
        for key, value in vars(LocalizerZH).items()
        if not key.startswith("_") and isinstance(value, str)
    }


def get_placeholder_names(text: str) -> set[str]:
    formatter = Formatter()
    placeholder_names: set[str] = set()
    for _, field_name, _, _ in formatter.parse(text):
        if field_name:
            placeholder_names.add(field_name)
    return placeholder_names


def test_localizer_zh_catalog_contains_non_empty_strings() -> None:
    # Arrange
    catalog = get_public_text_catalog()

    # Act / Assert
    assert catalog
    for key, value in catalog.items():
        assert value != "", f"{key} 不应为空字符串"


def test_localizer_zh_templates_can_be_formatted_with_public_placeholders() -> None:
    # Arrange
    catalog = get_public_text_catalog()

    # Act / Assert
    for key, value in catalog.items():
        placeholder_values = {
            field_name: f"<{field_name}>" for field_name in get_placeholder_names(value)
        }
        formatted_value = value.format(**placeholder_values)

        assert isinstance(formatted_value, str), f"{key} 应保持为可展示文本"
