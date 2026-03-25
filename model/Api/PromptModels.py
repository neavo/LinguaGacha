from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self


@dataclass(frozen=True)
class CustomPromptSnapshot:
    """自定义提示词快照冻结后传给前端，避免页面直接读写数据层。"""

    translation_prompt_enable: bool = False
    translation_prompt: str = ""
    analysis_prompt_enable: bool = False
    analysis_prompt: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把提示词设置收敛成固定字段，避免前端继续处理原始字典。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            translation_prompt_enable=bool(
                normalized.get("translation_prompt_enable", False)
            ),
            translation_prompt=str(normalized.get("translation_prompt", "")),
            analysis_prompt_enable=bool(
                normalized.get("analysis_prompt_enable", False)
            ),
            analysis_prompt=str(normalized.get("analysis_prompt", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        """把提示词快照转换回 JSON 字典，供边界层复用。"""

        return {
            "translation_prompt_enable": self.translation_prompt_enable,
            "translation_prompt": self.translation_prompt,
            "analysis_prompt_enable": self.analysis_prompt_enable,
            "analysis_prompt": self.analysis_prompt,
        }


@dataclass(frozen=True)
class PromptPresetEntry:
    """提示词预设条目冻结后用于列表展示和预设操作。"""

    name: str = ""
    file_name: str = ""
    virtual_id: str = ""
    path: str = ""
    type: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把预设列表项统一转成稳定字段，避免前端再猜原始结构。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            name=str(normalized.get("name", "")),
            file_name=str(normalized.get("file_name", "")),
            virtual_id=str(normalized.get("virtual_id", "")),
            path=str(normalized.get("path", "")),
            type=str(normalized.get("type", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        """把提示词预设条目转回 JSON 字典，保持边界层接口一致。"""

        return {
            "name": self.name,
            "file_name": self.file_name,
            "virtual_id": self.virtual_id,
            "path": self.path,
            "type": self.type,
        }
