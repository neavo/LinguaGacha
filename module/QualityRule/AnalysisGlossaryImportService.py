from __future__ import annotations

from typing import Any

from module.Data.Core.DataTypes import AnalysisGlossaryImportPreview
from module.Data.Core.DataTypes import AnalysisGlossaryImportPreviewEntry
from module.Engine.Analysis.AnalysisTextPolicy import AnalysisTextPolicy
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics


class AnalysisGlossaryImportService:
    """负责把分析候选转成可导入术语的业务决策。"""

    def __init__(self, quality_rule_service: Any) -> None:
        self.quality_rule_service = quality_rule_service

    def build_preview(
        self,
        glossary_entries: list[dict[str, Any]],
    ) -> AnalysisGlossaryImportPreview:
        """在内存中预演候选导入，并附带命中统计与包含关系。"""

        preview = QualityRuleMerger.preview_merge(
            rule_type=QualityRuleMerger.RuleType.GLOSSARY,
            existing=self.quality_rule_service.get_glossary(),
            incoming=glossary_entries,
            merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
        )

        merged_entries = tuple(dict(entry) for entry in preview.merged)
        preview_entries: list[AnalysisGlossaryImportPreviewEntry] = []
        relation_target_candidates: list[tuple[str, str]] = []
        for preview_entry in preview.entries:
            statistics_key = QualityRuleStatistics.build_glossary_rule_stat_key(
                preview_entry.entry
            )
            if statistics_key == "":
                continue

            preview_entries.append(
                AnalysisGlossaryImportPreviewEntry(
                    entry=dict(preview_entry.entry),
                    statistics_key=statistics_key,
                    is_new=preview_entry.is_new,
                    incoming_indexes=preview_entry.incoming_indexes,
                )
            )
            if not preview_entry.is_new:
                continue

            src = str(preview_entry.entry.get("src", "")).strip()
            if src == "":
                continue
            relation_target_candidates.append((statistics_key, src))

        src_texts, dst_texts = self.quality_rule_service.collect_rule_statistics_texts()
        statistics_snapshot = QualityRuleStatistics.build_rule_statistics_snapshot(
            rules=tuple(
                QualityRuleStatistics.build_glossary_rule_stat_inputs(merged_entries)
            ),
            src_texts=src_texts,
            dst_texts=dst_texts,
            relation_candidates=QualityRuleStatistics.build_subset_relation_candidates(
                merged_entries,
                key_builder=QualityRuleStatistics.build_glossary_rule_stat_key,
            ),
            relation_target_candidates=tuple(relation_target_candidates),
        )

        return AnalysisGlossaryImportPreview(
            merged_entries=merged_entries,
            report=preview.report,
            entries=tuple(preview_entries),
            statistics_results=statistics_snapshot.results,
            subset_parents=statistics_snapshot.subset_parents,
        )

    def filter_candidates(
        self,
        glossary_entries: list[dict[str, Any]],
        preview: AnalysisGlossaryImportPreview,
    ) -> list[dict[str, Any]]:
        """按预演统计结果过滤低价值新增候选。"""

        filtered_indexes: set[int] = set()
        key_by_src: dict[str, str] = {}

        def get_matched_item_count(statistics_key: str) -> int:
            result = preview.statistics_results.get(statistics_key)
            if result is None:
                return 0
            return int(result.matched_item_count)

        for preview_entry in preview.entries:
            src = str(preview_entry.entry.get("src", "")).strip()
            if src != "":
                key_by_src[src] = preview_entry.statistics_key

        for preview_entry in preview.entries:
            if not preview_entry.is_new:
                continue

            if AnalysisTextPolicy.is_control_code_self_mapping(
                str(preview_entry.entry.get("src", "")).strip(),
                str(preview_entry.entry.get("dst", "")).strip(),
            ):
                continue

            matched_item_count = get_matched_item_count(preview_entry.statistics_key)
            if matched_item_count <= 1:
                filtered_indexes.update(preview_entry.incoming_indexes)
                continue

            child_src = str(preview_entry.entry.get("src", "")).strip()
            if child_src == "":
                continue

            for parent_src in preview.subset_parents.get(
                preview_entry.statistics_key,
                tuple(),
            ):
                parent_key = key_by_src.get(parent_src, "")
                if parent_key == "":
                    continue

                parent_count = get_matched_item_count(parent_key)
                if parent_count != matched_item_count:
                    continue
                if len(parent_src) < len(child_src):
                    continue

                filtered_indexes.update(preview_entry.incoming_indexes)
                break

        if not filtered_indexes:
            return [dict(entry) for entry in glossary_entries]

        filtered_entries: list[dict[str, Any]] = []
        for index, entry in enumerate(glossary_entries):
            if index in filtered_indexes:
                continue
            filtered_entries.append(dict(entry))
        return filtered_entries
