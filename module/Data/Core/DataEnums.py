from enum import StrEnum


class TextPreserveMode(StrEnum):
    """文本保护模式。"""

    OFF = "off"
    SMART = "smart"
    CUSTOM = "custom"
