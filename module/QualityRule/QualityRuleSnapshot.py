from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any

from module.Data.DataManager import DataManager


@dataclass
class QualityRuleSnapshot:
    """翻译用质量规则快照。

    约束：
    - 翻译过程中不应受到 UI 对规则的修改影响
    """

    glossary_enable: bool = False
    text_preserve_mode: DataManager.TextPreserveMode = DataManager.TextPreserveMode.OFF
    text_preserve_entries: tuple[dict[str, Any], ...] = ()
    pre_replacement_enable: bool = False
    pre_replacement_entries: tuple[dict[str, Any], ...] = ()
    post_replacement_enable: bool = False
    post_replacement_entries: tuple[dict[str, Any], ...] = ()
    glossary_revision: int = 0
    text_preserve_revision: int = 0
    pre_replacement_revision: int = 0
    post_replacement_revision: int = 0
    translation_prompt_enable: bool = False
    translation_prompt: str = ""
    translation_prompt_revision: int = 0
    analysis_prompt_enable: bool = False
    analysis_prompt: str = ""
    analysis_prompt_revision: int = 0

    glossary_entries: list[dict[str, Any]] = field(default_factory=list)

    QUALITY_RULE_REVISION_META_KEY_PREFIX: str = "quality_rule_revision"
    QUALITY_PROMPT_REVISION_META_KEY_PREFIX: str = "quality_prompt_revision"

    @staticmethod
    def copy_non_empty_entries(
        raw_entries: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], ...]:
        """统一复制有效规则项，避免不同规则各写一套筛选逻辑。"""
        return tuple(
            dict(entry)
            for entry in raw_entries
            if isinstance(entry, dict) and str(entry.get("src", "")).strip() != ""
        )

    @classmethod
    def normalize_entries(
        cls,
        raw_entries: object,
    ) -> list[dict[str, Any]]:
        if not isinstance(raw_entries, list):
            return []

        normalized_entries: list[dict[str, Any]] = []
        for entry in raw_entries:
            if isinstance(entry, dict):
                normalized_entries.append(dict(entry))
        return normalized_entries

    @classmethod
    def normalize_text_preserve_mode(
        cls,
        value: object,
    ) -> DataManager.TextPreserveMode:
        if isinstance(value, DataManager.TextPreserveMode):
            return value

        normalized_value = getattr(value, "value", value)
        try:
            return DataManager.TextPreserveMode(str(normalized_value))
        except ValueError:
            return DataManager.TextPreserveMode.OFF

    @classmethod
    def normalize_revision(cls, value: object) -> int:
        try:
            revision = int(value)
        except TypeError, ValueError:
            revision = 0
        return max(0, revision)

    @classmethod
    def build_rule_revision_meta_key(cls, rule_type: str) -> str:
        return f"{cls.QUALITY_RULE_REVISION_META_KEY_PREFIX}.{rule_type}"

    @classmethod
    def build_prompt_revision_meta_key(cls, task_type: str) -> str:
        return f"{cls.QUALITY_PROMPT_REVISION_META_KEY_PREFIX}.{task_type}"

    @classmethod
    def read_meta_revision(
        cls,
        dm: DataManager,
        meta_key: str,
    ) -> int:
        meta_service = getattr(dm, "meta_service", None)
        if meta_service is None:
            return 0

        get_meta = getattr(meta_service, "get_meta", None)
        if not callable(get_meta):
            return 0

        return cls.normalize_revision(get_meta(meta_key, 0))

    @classmethod
    def from_dict(
        cls,
        data: dict[str, Any] | None,
    ) -> "QualityRuleSnapshot":
        normalized = data if isinstance(data, dict) else {}
        quality = (
            dict(normalized.get("quality", {}))
            if isinstance(normalized.get("quality"), dict)
            else {}
        )
        prompts = (
            dict(normalized.get("prompts", {}))
            if isinstance(normalized.get("prompts"), dict)
            else {}
        )

        glossary = (
            dict(quality.get("glossary", {}))
            if isinstance(quality.get("glossary"), dict)
            else {}
        )
        text_preserve = (
            dict(quality.get("text_preserve", {}))
            if isinstance(quality.get("text_preserve"), dict)
            else {}
        )
        pre_replacement = (
            dict(quality.get("pre_replacement", {}))
            if isinstance(quality.get("pre_replacement"), dict)
            else {}
        )
        post_replacement = (
            dict(quality.get("post_replacement", {}))
            if isinstance(quality.get("post_replacement"), dict)
            else {}
        )
        translation = (
            dict(prompts.get("translation", {}))
            if isinstance(prompts.get("translation"), dict)
            else {}
        )
        analysis = (
            dict(prompts.get("analysis", {}))
            if isinstance(prompts.get("analysis"), dict)
            else {}
        )

        glossary_entries = cls.normalize_entries(glossary.get("entries", []))

        return cls(
            glossary_enable=bool(glossary.get("enabled", True)),
            text_preserve_mode=cls.normalize_text_preserve_mode(
                text_preserve.get("mode", DataManager.TextPreserveMode.OFF.value)
            ),
            text_preserve_entries=cls.copy_non_empty_entries(
                cls.normalize_entries(text_preserve.get("entries", []))
            ),
            pre_replacement_enable=bool(pre_replacement.get("enabled", False)),
            pre_replacement_entries=cls.copy_non_empty_entries(
                cls.normalize_entries(pre_replacement.get("entries", []))
            ),
            post_replacement_enable=bool(post_replacement.get("enabled", False)),
            post_replacement_entries=cls.copy_non_empty_entries(
                cls.normalize_entries(post_replacement.get("entries", []))
            ),
            glossary_revision=cls.normalize_revision(glossary.get("revision", 0)),
            text_preserve_revision=cls.normalize_revision(
                text_preserve.get("revision", 0)
            ),
            pre_replacement_revision=cls.normalize_revision(
                pre_replacement.get("revision", 0)
            ),
            post_replacement_revision=cls.normalize_revision(
                post_replacement.get("revision", 0)
            ),
            translation_prompt_enable=bool(translation.get("enabled", False)),
            translation_prompt=str(translation.get("text", "")),
            translation_prompt_revision=cls.normalize_revision(
                translation.get("revision", 0)
            ),
            analysis_prompt_enable=bool(analysis.get("enabled", False)),
            analysis_prompt=str(analysis.get("text", "")),
            analysis_prompt_revision=cls.normalize_revision(
                analysis.get("revision", 0)
            ),
            glossary_entries=list(cls.copy_non_empty_entries(glossary_entries)),
        )

    @classmethod
    def capture(cls) -> "QualityRuleSnapshot":
        dm = DataManager.get()

        return cls(
            glossary_enable=dm.get_glossary_enable(),
            text_preserve_mode=dm.get_text_preserve_mode(),
            text_preserve_entries=cls.copy_non_empty_entries(dm.get_text_preserve()),
            pre_replacement_enable=dm.get_pre_replacement_enable(),
            pre_replacement_entries=cls.copy_non_empty_entries(
                dm.get_pre_replacement()
            ),
            post_replacement_enable=dm.get_post_replacement_enable(),
            post_replacement_entries=cls.copy_non_empty_entries(
                dm.get_post_replacement()
            ),
            glossary_revision=cls.read_meta_revision(
                dm,
                cls.build_rule_revision_meta_key("glossary"),
            ),
            text_preserve_revision=cls.read_meta_revision(
                dm,
                cls.build_rule_revision_meta_key("text_preserve"),
            ),
            pre_replacement_revision=cls.read_meta_revision(
                dm,
                cls.build_rule_revision_meta_key("pre_replacement"),
            ),
            post_replacement_revision=cls.read_meta_revision(
                dm,
                cls.build_rule_revision_meta_key("post_replacement"),
            ),
            translation_prompt_enable=dm.get_translation_prompt_enable(),
            translation_prompt=dm.get_translation_prompt(),
            translation_prompt_revision=cls.read_meta_revision(
                dm,
                cls.build_prompt_revision_meta_key("translation"),
            ),
            analysis_prompt_enable=dm.get_analysis_prompt_enable(),
            analysis_prompt=dm.get_analysis_prompt(),
            analysis_prompt_revision=cls.read_meta_revision(
                dm,
                cls.build_prompt_revision_meta_key("analysis"),
            ),
            glossary_entries=list(cls.copy_non_empty_entries(dm.get_glossary())),
        )

    def get_glossary_entries(self) -> tuple[dict[str, Any], ...]:
        return tuple(self.glossary_entries)

    def to_dict(self) -> dict[str, Any]:
        return {
            "quality": {
                "glossary": {
                    "entries": [dict(entry) for entry in self.glossary_entries],
                    "enabled": self.glossary_enable,
                    "revision": self.glossary_revision,
                },
                "text_preserve": {
                    "entries": [dict(entry) for entry in self.text_preserve_entries],
                    "mode": self.text_preserve_mode.value,
                    "revision": self.text_preserve_revision,
                },
                "pre_replacement": {
                    "entries": [dict(entry) for entry in self.pre_replacement_entries],
                    "enabled": self.pre_replacement_enable,
                    "revision": self.pre_replacement_revision,
                },
                "post_replacement": {
                    "entries": [dict(entry) for entry in self.post_replacement_entries],
                    "enabled": self.post_replacement_enable,
                    "revision": self.post_replacement_revision,
                },
            },
            "prompts": {
                "translation": {
                    "text": self.translation_prompt,
                    "enabled": self.translation_prompt_enable,
                    "revision": self.translation_prompt_revision,
                },
                "analysis": {
                    "text": self.analysis_prompt,
                    "enabled": self.analysis_prompt_enable,
                    "revision": self.analysis_prompt_revision,
                },
            },
        }
