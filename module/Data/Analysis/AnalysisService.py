from __future__ import annotations

from typing import Any

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService
from module.Data.Analysis.AnalysisRepository import AnalysisRepository
from module.Data.Core.BatchService import BatchService
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession


class AnalysisService:
    """分析业务门面。"""

    ANALYSIS_CANDIDATE_COUNT_META_KEY: str = (
        AnalysisRepository.ANALYSIS_CANDIDATE_COUNT_META_KEY
    )

    def __init__(
        self,
        session: ProjectSession,
        batch_service: BatchService,
        meta_service: MetaService,
        item_service: ItemService,
    ) -> None:
        self.session = session
        self.batch_service = batch_service
        self.meta_service = meta_service
        self.item_service = item_service

        self.candidate_service = AnalysisCandidateService()
        self.progress_service = AnalysisProgressService()
        self.repository = AnalysisRepository(
            session,
            self.candidate_service,
            self.progress_service,
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

    def get_analysis_extras(self) -> dict[str, Any]:
        extras = self.meta_service.get_meta("analysis_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_analysis_extras(self, extras: dict[str, Any]) -> None:
        self.meta_service.set_meta("analysis_extras", extras)

    def get_analysis_candidate_count_cache(self) -> int | None:
        """候选术语数默认从缓存读，避免热路径重建整个 glossary。"""
        cached = self.meta_service.get_meta(
            self.ANALYSIS_CANDIDATE_COUNT_META_KEY, None
        )
        try:
            if cached is None:
                return None
            return max(0, int(cached))
        except TypeError, ValueError:
            return None

    def set_analysis_candidate_count_cache(self, count: int) -> int:
        """候选术语数缓存统一走 meta，便于项目检查快速读取。"""
        normalized_count = max(0, int(count))
        self.meta_service.set_meta(
            self.ANALYSIS_CANDIDATE_COUNT_META_KEY,
            normalized_count,
        )
        return normalized_count

    def normalize_optional_progress_snapshot(
        self,
        snapshot: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """仅在调用方真的传入快照时做规范化，避免重复写条件分支。"""
        if snapshot is None:
            return None
        return self.normalize_analysis_progress_snapshot(snapshot)

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
        cached_count = self.get_analysis_candidate_count_cache()
        if cached_count is not None:
            return cached_count

        candidate_count = len(self.build_analysis_glossary_from_candidates())
        return self.set_analysis_candidate_count_cache(candidate_count)

    def upsert_analysis_candidate_aggregate(
        self,
        aggregates: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        updated_aggregate = self.repository.upsert_candidate_aggregate(aggregates)
        self.set_analysis_candidate_count_cache(
            len(
                self.candidate_service.build_glossary_from_candidates(updated_aggregate)
            )
        )
        return updated_aggregate

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
        return self.commit_analysis_task_batch(
            success_checkpoints=checkpoints or [],
            glossary_entries=glossary_entries or [],
            progress_snapshot=progress_snapshot,
        )

    def commit_analysis_task_batch(
        self,
        *,
        success_checkpoints: list[dict[str, Any]] | None = None,
        error_checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        """原子提交一批分析任务结果，统一收口候选池和 checkpoint 事务。"""
        return self.repository.commit_task_batch(
            success_checkpoints=success_checkpoints or [],
            error_checkpoints=error_checkpoints or [],
            glossary_entries=glossary_entries or [],
            progress_snapshot=self.normalize_optional_progress_snapshot(
                progress_snapshot
            ),
        )

    def build_analysis_glossary_from_candidates(self) -> list[dict[str, Any]]:
        return self.candidate_service.build_glossary_from_candidates(
            self.get_analysis_candidate_aggregate()
        )

    def clear_analysis_progress(self) -> None:
        self.repository.clear_progress()
        self.set_analysis_extras({})
        self.set_analysis_candidate_count_cache(0)

    def clear_analysis_candidates_and_progress(self) -> None:
        self.clear_analysis_progress()

    def reset_failed_analysis_checkpoints(self) -> int:
        return self.repository.reset_failed_checkpoints()

    def preview_failed_reset_status_summary(self) -> dict[str, Any]:
        checkpoints = {
            item_id: dict(checkpoint)
            for item_id, checkpoint in self.get_analysis_item_checkpoints().items()
            if checkpoint.get("status") != Base.ProjectStatus.ERROR
        }
        return self.progress_service.build_status_summary(
            self.item_service.get_all_items(),
            checkpoints,
            skipped_statuses=(
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.RULE_SKIPPED,
                Base.ProjectStatus.LANGUAGE_SKIPPED,
                Base.ProjectStatus.DUPLICATED,
            ),
        )

    def clear_analysis_progress_with_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_snapshot = self.normalize_analysis_progress_snapshot(snapshot)
        persisted_snapshot = self.repository.clear_progress_with_snapshot(
            normalized_snapshot
        )
        self.set_analysis_candidate_count_cache(0)
        return self.normalize_analysis_progress_snapshot(persisted_snapshot)

    def reset_failed_analysis_with_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> tuple[int, dict[str, Any]]:
        normalized_snapshot = self.normalize_analysis_progress_snapshot(snapshot)
        deleted, persisted_snapshot = (
            self.repository.reset_failed_checkpoints_with_snapshot(normalized_snapshot)
        )
        return deleted, self.normalize_analysis_progress_snapshot(persisted_snapshot)

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
        """读取当前缓存快照；不在热路径里隐式触发全量重算。"""
        return self.normalize_analysis_progress_snapshot(self.get_analysis_extras())

    def refresh_analysis_progress_snapshot_cache(self) -> dict[str, Any]:
        """显式全量校准分析快照，并把结果回写到 meta 缓存。"""
        normalized_snapshot = self.progress_service.build_progress_snapshot(
            self.get_analysis_extras(),
            self.get_analysis_status_summary(),
        )
        self.set_analysis_extras(normalized_snapshot)
        return normalized_snapshot

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
        return self.repository.update_task_error(
            checkpoints,
            progress_snapshot=self.normalize_optional_progress_snapshot(
                progress_snapshot
            ),
        )
