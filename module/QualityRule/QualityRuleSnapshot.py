from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
import threading
from typing import Any

from module.Data.DataManager import DataManager


@dataclass
class QualityRuleSnapshot:
    """翻译用质量规则快照。

    约束：
    - 除自动术语表外，翻译过程中不应受到 UI 对规则的修改影响
    - 自动术语表的新增条目需要“即时生效”，因此术语表列表允许在翻译过程中增量更新
    """

    glossary_enable: bool
    text_preserve_mode: DataManager.TextPreserveMode
    text_preserve_entries: tuple[dict[str, Any], ...]
    pre_replacement_enable: bool
    pre_replacement_entries: tuple[dict[str, Any], ...]
    post_replacement_enable: bool
    post_replacement_entries: tuple[dict[str, Any], ...]
    custom_prompt_zh_enable: bool
    custom_prompt_zh: str
    custom_prompt_en_enable: bool
    custom_prompt_en: str

    glossary_entries: list[dict[str, Any]]

    glossary_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    glossary_src_set: set[str] = field(default_factory=set, repr=False)

    @classmethod
    def capture(cls) -> "QualityRuleSnapshot":
        dm = DataManager.get()

        glossary_entries = [
            dict(v)
            for v in dm.get_glossary()
            if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
        ]
        glossary_src_set = {str(v.get("src", "")).strip() for v in glossary_entries}

        preserve_entries = tuple(
            dict(v)
            for v in dm.get_text_preserve()
            if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
        )
        pre_replacement_entries = tuple(
            dict(v)
            for v in dm.get_pre_replacement()
            if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
        )
        post_replacement_entries = tuple(
            dict(v)
            for v in dm.get_post_replacement()
            if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
        )

        return cls(
            glossary_enable=dm.get_glossary_enable(),
            text_preserve_mode=dm.get_text_preserve_mode(),
            text_preserve_entries=preserve_entries,
            pre_replacement_enable=dm.get_pre_replacement_enable(),
            pre_replacement_entries=pre_replacement_entries,
            post_replacement_enable=dm.get_post_replacement_enable(),
            post_replacement_entries=post_replacement_entries,
            custom_prompt_zh_enable=dm.get_custom_prompt_zh_enable(),
            custom_prompt_zh=dm.get_custom_prompt_zh(),
            custom_prompt_en_enable=dm.get_custom_prompt_en_enable(),
            custom_prompt_en=dm.get_custom_prompt_en(),
            glossary_entries=glossary_entries,
            glossary_src_set=glossary_src_set,
        )

    def get_glossary_entries(self) -> tuple[dict[str, Any], ...]:
        with self.glossary_lock:
            return tuple(self.glossary_entries)

    def merge_glossary_entries(
        self, incoming: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """将新术语合并进快照术语表，返回本次实际新增的条目列表。"""
        if not incoming:
            return []
        if not self.glossary_enable:
            return []

        added: list[dict[str, Any]] = []
        with self.glossary_lock:
            for raw in incoming:
                if not isinstance(raw, dict):
                    continue

                src = str(raw.get("src", "")).strip()
                dst = str(raw.get("dst", "")).strip()
                info = str(raw.get("info", "")).strip()
                if not src or not dst:
                    continue

                if src in self.glossary_src_set:
                    continue

                entry = {
                    "src": src,
                    "dst": dst,
                    "info": info,
                    "case_sensitive": bool(raw.get("case_sensitive", False)),
                }
                self.glossary_entries.append(entry)
                self.glossary_src_set.add(src)
                added.append(entry)

        return added
