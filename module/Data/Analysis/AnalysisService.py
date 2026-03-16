from __future__ import annotations

from typing import Any

from base.Base import Base
from model.Item import Item
from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService
from module.Data.Analysis.AnalysisRepository import AnalysisRepository
from module.Data.Core.BatchService import BatchService
from module.Data.Core.DataTypes import AnalysisGlossaryImportPreview
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Quality.QualityRuleService import QualityRuleService
from module.Data.Storage.LGDatabase import LGDatabase
from module.Engine.Analysis.AnalysisFakeNameInjector import AnalysisFakeNameInjector
from module.QualityRule.AnalysisGlossaryImportService import (
    AnalysisGlossaryImportService,
)
from module.QualityRule.QualityRuleMerger import QualityRuleMerger


class AnalysisService:
    """分析业务门面。"""

    def __init__(
        self,
        session: ProjectSession,
        batch_service: BatchService,
        meta_service: MetaService,
        item_service: ItemService,
        quality_rule_service: QualityRuleService,
    ) -> None:
        self.session = session
        self.batch_service = batch_service
        self.meta_service = meta_service
        self.item_service = item_service
        self.quality_rule_service = quality_rule_service

        self.candidate_service = AnalysisCandidateService()
        self.progress_service = AnalysisProgressService()
        self.repository = AnalysisRepository(
            session,
            self.candidate_service,
            self.progress_service,
        )
        self.glossary_import_service = AnalysisGlossaryImportService(
            quality_rule_service
        )

    @staticmethod
    def is_skipped_analysis_status(status: Base.ProjectStatus) -> bool:
        """统一维护分析链路的跳过状态。"""

        return status in (
            Base.ProjectStatus.EXCLUDED,
            Base.ProjectStatus.RULE_SKIPPED,
            Base.ProjectStatus.LANGUAGE_SKIPPED,
            Base.ProjectStatus.DUPLICATED,
        )

    @staticmethod
    def is_analysis_control_code_text(text: str) -> bool:
        """分析术语里只有纯控制码需要特殊放行。"""

        return AnalysisFakeNameInjector.is_control_code_text(str(text).strip())

    @classmethod
    def is_analysis_control_code_self_mapping(cls, src: str, dst: str) -> bool:
        """纯控制码自映射代表占位符本体，不走普通自映射过滤。"""

        return AnalysisFakeNameInjector.is_control_code_self_mapping(
            str(src).strip(),
            str(dst).strip(),
        )

    def get_analysis_extras(self) -> dict[str, Any]:
        extras = self.meta_service.get_meta("analysis_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_analysis_extras(self, extras: dict[str, Any]) -> None:
        self.meta_service.set_meta("analysis_extras", extras)

    def normalize_analysis_progress_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        return self.progress_service.normalize_progress_snapshot(snapshot)

    def get_analysis_item_checkpoints(self) -> dict[int, dict[str, Any]]:
        return self.repository.get_item_checkpoints()

    def upsert_analysis_item_checkpoints(
        self,
        checkpoints: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        return self.repository.upsert_item_checkpoints(checkpoints)

    def get_analysis_candidate_aggregate(self) -> dict[str, dict[str, Any]]:
        return self.repository.get_candidate_aggregate()

    def get_analysis_candidate_count(self) -> int:
        return len(self.build_analysis_glossary_from_candidates())

    def upsert_analysis_candidate_aggregate(
        self,
        aggregates: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        return self.repository.upsert_candidate_aggregate(aggregates)

    def merge_analysis_candidate_aggregate(
        self,
        incoming_aggregate: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        if not incoming_aggregate:
            return self.get_analysis_candidate_aggregate()

        current_aggregate = self.get_analysis_candidate_aggregate()
        merged_aggregate = self.candidate_service.merge_candidate_aggregate(
            current_aggregate,
            incoming_aggregate,
        )
        return self.upsert_analysis_candidate_aggregate(merged_aggregate)

    def commit_analysis_task_result(
        self,
        *,
        checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        """原子提交单个分析任务结果。"""

        normalized_progress_snapshot = None
        if progress_snapshot is not None:
            normalized_progress_snapshot = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        return self.repository.commit_task_result(
            checkpoints=checkpoints or [],
            glossary_entries=glossary_entries or [],
            progress_snapshot=normalized_progress_snapshot,
        )

    def build_analysis_glossary_from_candidates(self) -> list[dict[str, Any]]:
        return self.candidate_service.build_glossary_from_candidates(
            self.get_analysis_candidate_aggregate()
        )

    def build_analysis_glossary_import_preview(
        self,
        glossary_entries: list[dict[str, Any]],
    ) -> AnalysisGlossaryImportPreview:
        return self.glossary_import_service.build_preview(glossary_entries)

    def filter_analysis_glossary_import_candidates(
        self,
        glossary_entries: list[dict[str, Any]],
        preview: AnalysisGlossaryImportPreview,
    ) -> list[dict[str, Any]]:
        return self.glossary_import_service.filter_candidates(
            glossary_entries,
            preview,
        )

    def import_analysis_candidates(
        self,
        expected_lg_path: str | None = None,
    ) -> int | None:
        """把候选池按“新增 + 补空”导入正式术语表。"""

        with self.session.state_lock:
            if self.session.db is None or self.session.lg_path is None:
                return None
            if (
                expected_lg_path is not None
                and self.session.lg_path != expected_lg_path
            ):
                return None

        glossary_entries = self.build_analysis_glossary_from_candidates()
        if not glossary_entries:
            return 0

        preview = self.build_analysis_glossary_import_preview(glossary_entries)
        filtered_glossary_entries = self.filter_analysis_glossary_import_candidates(
            glossary_entries,
            preview,
        )
        if not filtered_glossary_entries:
            return 0

        merged, report = self.quality_rule_service.merge_glossary_incoming(
            filtered_glossary_entries,
            merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
            save=False,
        )
        if merged is None:
            return 0

        self.batch_service.update_batch(
            items=None,
            rules={LGDatabase.RuleType.GLOSSARY: merged},
            meta=None,
        )
        return int(report.added) + int(report.filled)

    def clear_analysis_progress(self) -> None:
        self.repository.clear_progress()
        self.set_analysis_extras({})

    def clear_analysis_candidates_and_progress(self) -> None:
        self.clear_analysis_progress()

    def reset_failed_analysis_checkpoints(self) -> int:
        return self.repository.reset_failed_checkpoints()

    def get_analysis_status_summary(self) -> dict[str, Any]:
        return self.progress_service.build_status_summary(
            self.item_service.get_all_items(),
            self.get_analysis_item_checkpoints(),
            skipped_statuses=(
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.RULE_SKIPPED,
                Base.ProjectStatus.LANGUAGE_SKIPPED,
                Base.ProjectStatus.DUPLICATED,
            ),
        )

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        return self.progress_service.build_progress_snapshot(
            self.get_analysis_extras(),
            self.get_analysis_status_summary(),
        )

    def update_analysis_progress_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_snapshot = self.normalize_analysis_progress_snapshot(snapshot)
        self.set_analysis_extras(normalized_snapshot)
        return normalized_snapshot

    def get_pending_analysis_items(self) -> list[Item]:
        return self.progress_service.collect_pending_items(
            self.item_service.get_all_items(),
            self.get_analysis_item_checkpoints(),
            skipped_statuses=(
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.RULE_SKIPPED,
                Base.ProjectStatus.LANGUAGE_SKIPPED,
                Base.ProjectStatus.DUPLICATED,
            ),
        )

    def update_analysis_task_error(
        self,
        checkpoints: list[dict[str, Any]],
        progress_snapshot: dict[str, Any] | None = None,
    ) -> dict[int, dict[str, Any]]:
        normalized_progress_snapshot = None
        if progress_snapshot is not None:
            normalized_progress_snapshot = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        return self.repository.update_task_error(
            checkpoints,
            progress_snapshot=normalized_progress_snapshot,
        )
