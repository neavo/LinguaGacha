from __future__ import annotations

from enum import StrEnum
from typing import Any

from module.Data.Core.DataEnums import TextPreserveMode


class QualityRuleSnapshotService:
    """质量规则快照服务。

    这个服务只负责把当前规则状态整理成稳定快照，避免 UI 直接拼装
    meta、entries 与 revision，从而把读取语义收口到单一入口。
    """

    class RuleType(StrEnum):
        """质量规则快照支持的规则类型。"""

        GLOSSARY = "glossary"
        TEXT_PRESERVE = "text_preserve"
        PRE_REPLACEMENT = "pre_replacement"
        POST_REPLACEMENT = "post_replacement"

    REVISION_META_KEY_PREFIX: str = "quality_rule_revision"

    def __init__(self, quality_rule_service: Any, meta_service: Any) -> None:
        self.quality_rule_service = quality_rule_service
        self.meta_service = meta_service

    def _get_state_lock(self) -> Any:
        """复用工程会话锁，把内容、meta 和 revision 读取收进同一临界区。"""

        return self.meta_service.session.state_lock

    @classmethod
    def normalize_rule_type(cls, rule_type: str | RuleType) -> RuleType:
        """把外部传入的规则类型统一收口为内部枚举。"""

        if isinstance(rule_type, cls.RuleType):
            normalized_rule_type = rule_type
        else:
            normalized_rule_type = cls.RuleType(str(rule_type))
        return normalized_rule_type

    @classmethod
    def build_revision_meta_key(cls, rule_type: str | RuleType) -> str:
        """统一生成 revision 的 meta 键，避免读写两边各自拼接。"""

        normalized_rule_type = cls.normalize_rule_type(rule_type)
        return f"{cls.REVISION_META_KEY_PREFIX}.{normalized_rule_type.value}"

    def get_revision(self, rule_type: str | RuleType) -> int:
        """读取规则 revision，缺省时视为初始版本。"""

        revision_key = self.build_revision_meta_key(rule_type)
        raw_revision = self.meta_service.get_meta(revision_key, 0)
        if isinstance(raw_revision, int):
            revision = raw_revision
        else:
            try:
                revision = int(raw_revision)
            except TypeError, ValueError:
                revision = 0
        if revision < 0:
            revision = 0
        return revision

    def _build_entries(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """复制 entries，避免快照把可变引用直接暴露给调用方。"""

        snapshot_entries: list[dict[str, Any]] = []
        for entry in entries:
            if isinstance(entry, dict):
                snapshot_entries.append(dict(entry))
            else:
                snapshot_entries.append({"value": entry})
        return snapshot_entries

    def _build_glossary_snapshot(self) -> dict[str, object]:
        """把术语表整理成包含启用状态的快照。"""

        entries = self._build_entries(self.quality_rule_service.get_glossary())
        meta = {"enabled": bool(self.quality_rule_service.get_glossary_enable())}
        return {
            "meta": meta,
            "entries": entries,
        }

    def _build_text_preserve_snapshot(self) -> dict[str, object]:
        """把文本保护整理成包含模式状态的快照。"""

        entries = self._build_entries(self.quality_rule_service.get_text_preserve())
        raw_mode = self.quality_rule_service.get_text_preserve_mode()
        if isinstance(raw_mode, TextPreserveMode):
            mode = raw_mode.value
        else:
            mode = str(raw_mode)
        meta = {"mode": mode}
        return {
            "meta": meta,
            "entries": entries,
        }

    def _build_pre_replacement_snapshot(self) -> dict[str, object]:
        """把翻译前替换整理成包含启用状态的快照。"""

        entries = self._build_entries(self.quality_rule_service.get_pre_replacement())
        meta = {"enabled": bool(self.quality_rule_service.get_pre_replacement_enable())}
        return {
            "meta": meta,
            "entries": entries,
        }

    def _build_post_replacement_snapshot(self) -> dict[str, object]:
        """把翻译后替换整理成包含启用状态的快照。"""

        entries = self._build_entries(self.quality_rule_service.get_post_replacement())
        meta = {
            "enabled": bool(self.quality_rule_service.get_post_replacement_enable())
        }
        return {
            "meta": meta,
            "entries": entries,
        }

    def build_rule_snapshot_payload(
        self,
        rule_type: str | RuleType,
    ) -> dict[str, object]:
        """在已持有锁的前提下构建规则快照，供写路径复用。"""

        normalized_rule_type = self.normalize_rule_type(rule_type)
        if normalized_rule_type == self.RuleType.GLOSSARY:
            payload = self._build_glossary_snapshot()
        elif normalized_rule_type == self.RuleType.TEXT_PRESERVE:
            payload = self._build_text_preserve_snapshot()
        elif normalized_rule_type == self.RuleType.PRE_REPLACEMENT:
            payload = self._build_pre_replacement_snapshot()
        elif normalized_rule_type == self.RuleType.POST_REPLACEMENT:
            payload = self._build_post_replacement_snapshot()
        else:
            raise ValueError(f"未知的质量规则类型：{rule_type}")

        payload["rule_type"] = normalized_rule_type.value
        payload["revision"] = self.get_revision(normalized_rule_type)
        return payload

    def get_rule_snapshot(self, rule_type: str | RuleType) -> dict[str, object]:
        """读取指定规则的完整快照。"""

        with self._get_state_lock():
            return self.build_rule_snapshot_payload(rule_type)
