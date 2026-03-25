from __future__ import annotations

from typing import Any

from api.Contract.QualityPayloads import ProofreadingLookupPayload
from api.Contract.QualityPayloads import QualityRuleSnapshotPayload
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from module.Data.DataManager import DataManager
from module.Data.Quality.QualityRuleFacadeService import QualityRuleFacadeService
from module.Data.Quality.QualityRuleMutationService import QualityRuleMutationService


class QualityRuleAppService:
    """质量规则用例层，负责把 Core 结果映射成稳定 API 载荷。"""

    def __init__(self, quality_rule_facade: Any | None = None) -> None:
        if quality_rule_facade is None:
            data_manager = DataManager.get()
            self.quality_rule_facade = QualityRuleFacadeService(
                data_manager,
                data_manager,
            )
        else:
            self.quality_rule_facade = quality_rule_facade

    def get_rule_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        """读取规则快照，并统一通过 payload 输出。"""

        rule_type = str(request.get("rule_type", ""))
        snapshot = self.quality_rule_facade.get_rule_snapshot(rule_type)
        return QualityRuleSnapshotPayload.from_dict(snapshot).to_dict()

    def save_rule_entries(self, request: dict[str, Any]) -> dict[str, object]:
        """保存完整规则条目列表。"""

        rule_type = str(request.get("rule_type", ""))
        expected_revision = int(request.get("expected_revision", 0) or 0)
        entries_raw = request.get("entries", [])
        entries: list[dict[str, Any]] = []
        if isinstance(entries_raw, list):
            for entry in entries_raw:
                if isinstance(entry, dict):
                    entries.append(dict(entry))

        snapshot = self.quality_rule_facade.save_entries(
            rule_type,
            expected_revision=expected_revision,
            entries=entries,
        )
        return QualityRuleSnapshotPayload.from_dict(snapshot).to_dict()

    def update_rule_meta(self, request: dict[str, Any]) -> dict[str, object]:
        """更新规则 meta，并把 enabled 与普通 meta 写入统一收口。"""

        rule_type = str(request.get("rule_type", ""))
        current_revision = int(request.get("expected_revision", 0) or 0)
        meta_raw = request.get("meta", {})
        if isinstance(meta_raw, dict):
            meta = dict(meta_raw)
        else:
            meta = {}

        snapshot: dict[str, Any] | None = None
        for meta_key, value in meta.items():
            resolved_meta_key = str(meta_key)
            if rule_type == "text_preserve" and resolved_meta_key == "mode":
                resolved_meta_key = (
                    QualityRuleMutationService.TEXT_PRESERVE_MODE_META_KEY
                )

            if meta_key == "enabled":
                snapshot = self.quality_rule_facade.set_rule_enabled(
                    rule_type,
                    expected_revision=current_revision,
                    enabled=bool(value),
                )
            else:
                snapshot = self.quality_rule_facade.update_meta(
                    rule_type,
                    expected_revision=current_revision,
                    meta_key=resolved_meta_key,
                    value=value,
                )

            revision_raw = snapshot.get("revision", current_revision)
            current_revision = int(revision_raw or current_revision)

        if snapshot is None:
            snapshot = self.quality_rule_facade.get_rule_snapshot(rule_type)
        return QualityRuleSnapshotPayload.from_dict(snapshot).to_dict()

    def query_proofreading(self, request: dict[str, Any]) -> dict[str, object]:
        """把质量规则条目转换成校对页可直接消费的查询参数。"""

        entry_raw = request.get("entry", {})
        if isinstance(entry_raw, dict):
            keyword = str(entry_raw.get("src", "")).strip()
            is_regex = bool(entry_raw.get("regex", False))
        else:
            keyword = ""
            is_regex = bool(request.get("is_regex", False))

        query = ProofreadingLookupQuery(keyword=keyword, is_regex=is_regex)
        return ProofreadingLookupPayload(query=query).to_dict()
