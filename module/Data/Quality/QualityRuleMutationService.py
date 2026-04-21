from __future__ import annotations

from typing import Any

from module.Data.Core.DataEnums import TextPreserveMode
from module.Data.Quality.QualityRuleSnapshotService import (
    QualityRuleSnapshotService,
)


class QualityRuleRevisionConflictError(RuntimeError):
    """规则 revision 不一致时抛出的冲突异常。"""


class QualityRuleMutationService:
    """质量规则写入服务。

    这个服务只负责写入口与 revision 校验，避免 UI 或外层流程
    直接改底层服务后再自己补版本号。
    """

    TEXT_PRESERVE_MODE_META_KEY: str = "text_preserve_mode"

    def __init__(
        self,
        quality_rule_service: Any,
        meta_service: Any,
        snapshot_service: QualityRuleSnapshotService | None = None,
    ) -> None:
        self.quality_rule_service = quality_rule_service
        self.meta_service = meta_service
        if snapshot_service is None:
            self.snapshot_service = QualityRuleSnapshotService(
                quality_rule_service,
                meta_service,
            )
        else:
            self.snapshot_service = snapshot_service

    def _get_state_lock(self) -> Any:
        """复用工程会话锁，让检查、写入与 bump 落在同一临界区。"""

        return self.meta_service.session.state_lock

    @classmethod
    def build_revision_meta_key(
        cls, rule_type: str | QualityRuleSnapshotService.RuleType
    ) -> str:
        """统一复用快照服务的 revision 键生成规则。"""

        return QualityRuleSnapshotService.build_revision_meta_key(rule_type)

    def get_revision(self, rule_type: str | QualityRuleSnapshotService.RuleType) -> int:
        """读取当前 revision，供写入前做乐观锁校验。"""

        return self.snapshot_service.get_revision(rule_type)

    def _assert_revision(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        expected_revision: int,
    ) -> None:
        """在写入前校验 revision，避免旧 UI 覆盖新内容。"""

        current_revision = self.get_revision(rule_type)
        if expected_revision != current_revision:
            raise QualityRuleRevisionConflictError(
                f"质量规则 revision 冲突：当前={current_revision}，期望={expected_revision}"
            )

    def _bump_revision(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        current_revision: int,
    ) -> int:
        """写入成功后推进 revision，保证下一次快照能看见新版本。"""

        new_revision = current_revision + 1
        revision_key = self.build_revision_meta_key(rule_type)
        self.meta_service.set_meta(revision_key, new_revision)
        return new_revision

    def _copy_entries(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """复制可变条目，避免调用方继续持有底层引用。"""

        copied_entries: list[dict[str, Any]] = []
        for entry in entries:
            copied_entries.append(dict(entry))
        return copied_entries

    def _get_current_entries(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
    ) -> list[dict[str, Any]]:
        """读取当前条目快照，作为删除与排序的统一输入。"""

        snapshot = self.snapshot_service.build_rule_snapshot_payload(rule_type)
        entries = snapshot["entries"]
        if isinstance(entries, list):
            current_entries = [
                dict(entry) for entry in entries if isinstance(entry, dict)
            ]
        else:
            current_entries = []
        return current_entries

    def _save_entries(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        entries: list[dict[str, Any]],
    ) -> None:
        """把条目写回底层服务，规则类型分支留在这里集中处理。"""

        normalized_entries = self._copy_entries(entries)
        normalized_rule_type = self.snapshot_service.normalize_rule_type(rule_type)
        if normalized_rule_type == self.snapshot_service.RuleType.GLOSSARY:
            self.quality_rule_service.set_glossary(normalized_entries)
        elif normalized_rule_type == self.snapshot_service.RuleType.TEXT_PRESERVE:
            self.quality_rule_service.set_text_preserve(normalized_entries)
        elif normalized_rule_type == self.snapshot_service.RuleType.PRE_REPLACEMENT:
            self.quality_rule_service.set_pre_replacement(normalized_entries)
        elif normalized_rule_type == self.snapshot_service.RuleType.POST_REPLACEMENT:
            self.quality_rule_service.set_post_replacement(normalized_entries)
        else:
            raise ValueError(f"未知的质量规则类型：{rule_type}")

    def _entry_sort_key(self, entry: dict[str, Any]) -> tuple[str, str, str]:
        """统一排序规则，避免不同入口各自决定排序依据。"""

        src = str(entry.get("src", "")).strip().casefold()
        dst = str(entry.get("dst", "")).strip().casefold()
        info = str(entry.get("info", "")).strip().casefold()
        return src, dst, info

    def save_entries(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        entries: list[dict[str, Any]],
    ) -> dict[str, object]:
        """保存完整条目列表，并推进 revision。"""

        with self._get_state_lock():
            self._assert_revision(rule_type, expected_revision)
            current_revision = self.get_revision(rule_type)
            self._save_entries(rule_type, entries)
            new_revision = self._bump_revision(rule_type, current_revision)
            new_snapshot = self.snapshot_service.build_rule_snapshot_payload(
                rule_type
            ) | {"revision": new_revision}
        return new_snapshot

    def delete_entry(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        index: int,
    ) -> dict[str, object]:
        """删除单条条目，并把结果写回底层规则列表。"""

        with self._get_state_lock():
            self._assert_revision(rule_type, expected_revision)
            current_entries = self._get_current_entries(rule_type)
            if index < 0 or index >= len(current_entries):
                raise IndexError("条目索引超出范围")

            del current_entries[index]
            current_revision = self.get_revision(rule_type)
            self._save_entries(rule_type, current_entries)
            self._bump_revision(rule_type, current_revision)
            return self.snapshot_service.build_rule_snapshot_payload(rule_type)

    def sort_entries(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        reverse: bool = False,
    ) -> dict[str, object]:
        """按稳定规则对条目排序，方便 UI 一键整理列表。"""

        with self._get_state_lock():
            self._assert_revision(rule_type, expected_revision)
            current_entries = self._get_current_entries(rule_type)
            sorted_entries = sorted(
                current_entries,
                key=self._entry_sort_key,
                reverse=reverse,
            )
            current_revision = self.get_revision(rule_type)
            self._save_entries(rule_type, sorted_entries)
            self._bump_revision(rule_type, current_revision)
            return self.snapshot_service.build_rule_snapshot_payload(rule_type)

    def set_rule_enabled(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        enabled: bool,
    ) -> dict[str, object]:
        """切换规则启用状态，并推进 revision。"""

        with self._get_state_lock():
            self._assert_revision(rule_type, expected_revision)
            normalized_rule_type = self.snapshot_service.normalize_rule_type(rule_type)
            if normalized_rule_type == self.snapshot_service.RuleType.GLOSSARY:
                self.quality_rule_service.set_glossary_enable(bool(enabled))
            elif normalized_rule_type == self.snapshot_service.RuleType.PRE_REPLACEMENT:
                self.quality_rule_service.set_pre_replacement_enable(bool(enabled))
            elif (
                normalized_rule_type == self.snapshot_service.RuleType.POST_REPLACEMENT
            ):
                self.quality_rule_service.set_post_replacement_enable(bool(enabled))
            else:
                raise ValueError(f"当前规则类型不支持布尔启用切换：{rule_type}")

            current_revision = self.get_revision(rule_type)
            self._bump_revision(rule_type, current_revision)
            return self.snapshot_service.build_rule_snapshot_payload(rule_type)

    def _normalize_text_preserve_mode(
        self,
        value: Any,
    ) -> TextPreserveMode:
        """把文本保护模式统一收敛成枚举，避免调用方各自拼字符串。"""

        if isinstance(value, TextPreserveMode):
            normalized_mode = value
        else:
            try:
                normalized_mode = TextPreserveMode(str(value))
            except ValueError:
                normalized_mode = TextPreserveMode.OFF
        return normalized_mode

    def update_meta(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        meta_key: str,
        value: Any,
    ) -> dict[str, object]:
        """更新当前阶段明确需要的规则 meta。

        现在只放开文本保护模式这一类非布尔元数据，避免把这里做成
        一个泛化的配置写入口。
        """

        with self._get_state_lock():
            self._assert_revision(rule_type, expected_revision)
            normalized_rule_type = self.snapshot_service.normalize_rule_type(rule_type)
            if (
                normalized_rule_type == self.snapshot_service.RuleType.TEXT_PRESERVE
                and meta_key == self.TEXT_PRESERVE_MODE_META_KEY
            ):
                normalized_mode = self._normalize_text_preserve_mode(value)
                self.quality_rule_service.set_text_preserve_mode(normalized_mode)
            else:
                raise ValueError(
                    f"当前规则类型不支持该 meta 写入：{rule_type} -> {meta_key}"
                )

            current_revision = self.get_revision(rule_type)
            self._bump_revision(rule_type, current_revision)
            return self.snapshot_service.build_rule_snapshot_payload(rule_type)
