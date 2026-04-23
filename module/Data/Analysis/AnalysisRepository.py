from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from base.Base import Base
from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Storage.LGDatabase import LGDatabase


class AnalysisRepository:
    """承接分析专用表读写和事务内 meta 同步。"""

    ANALYSIS_CANDIDATE_COUNT_META_KEY: str = "analysis_candidate_count"

    def __init__(
        self,
        session: ProjectSession,
        candidate_service: AnalysisCandidateService,
        progress_service: AnalysisProgressService,
    ) -> None:
        self.session = session
        self.candidate_service = candidate_service
        self.progress_service = progress_service

    def persist_progress_snapshot_with_db(
        self,
        db: LGDatabase,
        conn: sqlite3.Connection,
        snapshot: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """在现有事务内持久化分析快照，并同步会话缓存。"""

        if snapshot is None:
            return None

        persisted_snapshot = dict(snapshot)
        db.upsert_meta_entries({"analysis_extras": persisted_snapshot}, conn=conn)
        self.session.meta_cache["analysis_extras"] = dict(persisted_snapshot)
        return persisted_snapshot

    def persist_analysis_candidate_count_with_db(
        self,
        db: LGDatabase,
        conn: sqlite3.Connection,
        count: int,
    ) -> int:
        """候选术语数缓存和候选池提交同事务写回，避免项目检查读到旧值。"""
        normalized_count = max(0, int(count))
        db.upsert_meta_entries(
            {self.ANALYSIS_CANDIDATE_COUNT_META_KEY: normalized_count},
            conn=conn,
        )
        self.session.meta_cache[self.ANALYSIS_CANDIDATE_COUNT_META_KEY] = (
            normalized_count
        )
        return normalized_count

    def get_cached_analysis_candidate_count_or_none(self) -> int | None:
        """区分缓存缺失和真实 0，避免旧工程首轮增量提交丢掉历史候选数。"""
        if self.ANALYSIS_CANDIDATE_COUNT_META_KEY not in self.session.meta_cache:
            return None

        raw_value = self.session.meta_cache.get(self.ANALYSIS_CANDIDATE_COUNT_META_KEY)
        try:
            return max(0, int(raw_value))
        except TypeError, ValueError:
            return None

    def count_candidate_entries(
        self,
        aggregate_map: dict[str, dict[str, Any]],
    ) -> int:
        """只统计可导出的候选项，保持和 UI 展示口径一致。"""
        return sum(
            1
            for src, entry in aggregate_map.items()
            if self.candidate_service.build_glossary_entry_from_candidate(src, entry)
        )

    def clone_candidate_aggregate_map(
        self,
        aggregate_map: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """事务内合并前先复制一份可变聚合，避免意外改脏原快照。"""
        return {
            src: {
                "src": entry["src"],
                "dst_votes": dict(entry["dst_votes"]),
                "info_votes": dict(entry["info_votes"]),
                "observation_count": int(entry["observation_count"]),
                "first_seen_at": entry["first_seen_at"],
                "last_seen_at": entry["last_seen_at"],
                "case_sensitive": bool(entry["case_sensitive"]),
                "first_seen_index": int(entry.get("first_seen_index", 0)),
            }
            for src, entry in aggregate_map.items()
        }

    def build_full_candidate_count_with_db(
        self,
        db: LGDatabase,
        conn: sqlite3.Connection,
    ) -> int:
        """候选数缓存缺失时回表重建一次真实基线，保证后续增量修正有依据。"""
        aggregate_map = self.candidate_service.normalize_candidate_aggregate_rows(
            db.get_analysis_candidate_aggregates(conn=conn)
        )
        return self.count_candidate_entries(aggregate_map)

    def get_item_checkpoints(self) -> dict[int, dict[str, Any]]:
        """返回条目级检查点快照。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            raw_rows = db.get_analysis_item_checkpoints()
        return self.progress_service.normalize_item_checkpoint_rows(raw_rows)

    def upsert_item_checkpoints(
        self,
        checkpoints: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        """批量写入条目级检查点，并返回最新快照。"""

        normalized_rows = self.progress_service.normalize_item_checkpoint_upsert_rows(
            checkpoints
        )
        if not normalized_rows:
            return self.get_item_checkpoints()

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            db.upsert_analysis_item_checkpoints(normalized_rows)

        return self.get_item_checkpoints()

    def get_candidate_aggregate(self) -> dict[str, dict[str, Any]]:
        """返回项目级候选池汇总。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            raw_rows = db.get_analysis_candidate_aggregates()
        return self.candidate_service.normalize_candidate_aggregate_rows(raw_rows)

    def upsert_candidate_aggregate(
        self,
        aggregates: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """批量写入项目级候选池汇总。"""

        normalized_rows: list[dict[str, Any]] = []
        for raw_src, raw_entry in aggregates.items():
            src = str(raw_src).strip()
            entry = self.candidate_service.normalize_candidate_aggregate_entry(
                src,
                raw_entry,
            )
            if entry is None:
                continue
            normalized_rows.append(
                {
                    "src": entry["src"],
                    "dst_votes": dict(entry["dst_votes"]),
                    "info_votes": dict(entry["info_votes"]),
                    "observation_count": entry["observation_count"],
                    "first_seen_at": entry["first_seen_at"],
                    "last_seen_at": entry["last_seen_at"],
                    "case_sensitive": entry["case_sensitive"],
                }
            )

        if not normalized_rows:
            return self.get_candidate_aggregate()

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            db.upsert_analysis_candidate_aggregates(normalized_rows)

        return self.get_candidate_aggregate()

    def commit_task_batch(
        self,
        *,
        success_checkpoints: list[dict[str, Any]],
        error_checkpoints: list[dict[str, Any]],
        glossary_entries: list[dict[str, Any]],
        progress_snapshot: dict[str, Any] | None,
    ) -> int:
        """原子提交一批分析任务结果，并同步候选计数缓存。"""

        now = datetime.now().isoformat()
        normalized_glossary_entries = (
            self.candidate_service.build_commit_glossary_entries(
                glossary_entries,
                created_at=now,
            )
        )
        normalized_success_checkpoints = (
            self.progress_service.normalize_item_checkpoint_upsert_rows(
                success_checkpoints
            )
        )

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return 0

            with db.connection() as conn:
                inserted_count = len(normalized_glossary_entries)
                cached_candidate_count = (
                    self.get_cached_analysis_candidate_count_or_none()
                )
                next_candidate_count = (
                    cached_candidate_count
                    if cached_candidate_count is not None
                    else self.build_full_candidate_count_with_db(db, conn)
                )
                touched_srcs = sorted(
                    {entry["src"] for entry in normalized_glossary_entries}
                )
                if touched_srcs:
                    existing_aggregate_map = (
                        self.candidate_service.normalize_candidate_aggregate_rows(
                            db.get_analysis_candidate_aggregates_by_srcs(
                                touched_srcs,
                                conn=conn,
                            )
                        )
                    )
                    aggregate_map = self.clone_candidate_aggregate_map(
                        existing_aggregate_map
                    )
                    self.candidate_service.merge_glossary_entries_into_candidate_aggregates(
                        normalized_glossary_entries,
                        aggregate_map,
                    )
                    db.upsert_analysis_candidate_aggregates(
                        self.candidate_service.build_candidate_aggregate_upsert_rows(
                            aggregate_map,
                            touched_srcs,
                        ),
                        conn=conn,
                    )
                    next_candidate_count = max(
                        0,
                        next_candidate_count
                        - self.count_candidate_entries(existing_aggregate_map)
                        + self.count_candidate_entries(aggregate_map),
                    )

                if normalized_success_checkpoints:
                    db.upsert_analysis_item_checkpoints(
                        normalized_success_checkpoints,
                        conn=conn,
                    )

                if error_checkpoints:
                    existing_checkpoints = (
                        self.progress_service.normalize_item_checkpoint_rows(
                            db.get_analysis_item_checkpoints(conn=conn)
                        )
                    )
                    error_rows, _updated_checkpoints = (
                        self.progress_service.build_error_checkpoint_rows(
                            error_checkpoints,
                            existing_checkpoints,
                            updated_at=now,
                        )
                    )
                    if error_rows:
                        db.upsert_analysis_item_checkpoints(error_rows, conn=conn)

                self.persist_progress_snapshot_with_db(
                    db,
                    conn,
                    progress_snapshot,
                )
                self.persist_analysis_candidate_count_with_db(
                    db,
                    conn,
                    next_candidate_count,
                )
                conn.commit()

        return inserted_count

    def clear_progress(self) -> None:
        """清空分析快照、检查点和候选池。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return
            with db.connection() as conn:
                db.delete_analysis_item_checkpoints(conn=conn)
                db.clear_analysis_candidate_aggregates(conn=conn)
                self.persist_progress_snapshot_with_db(db, conn, {})
                self.persist_analysis_candidate_count_with_db(db, conn, 0)
                conn.commit()

    def clear_progress_with_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        """清空分析事实，并把调用方确认后的快照一并落库。"""

        normalized_snapshot = dict(snapshot)
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            with db.connection() as conn:
                db.delete_analysis_item_checkpoints(conn=conn)
                db.clear_analysis_candidate_aggregates(conn=conn)
                persisted_snapshot = self.persist_progress_snapshot_with_db(
                    db,
                    conn,
                    normalized_snapshot,
                )
                self.persist_analysis_candidate_count_with_db(db, conn, 0)
                conn.commit()

        return {} if persisted_snapshot is None else dict(persisted_snapshot)

    def reset_failed_checkpoints(self) -> int:
        """仅清除失败检查点，不动候选池和成功检查点。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return 0
            return db.delete_analysis_item_checkpoints(
                status=Base.ProjectStatus.ERROR.value
            )

    def reset_failed_checkpoints_with_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> tuple[int, dict[str, Any]]:
        """删除失败检查点，并把最新分析快照同事务写回。"""

        normalized_snapshot = dict(snapshot)
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return 0, {}
            with db.connection() as conn:
                deleted = db.delete_analysis_item_checkpoints(
                    status=Base.ProjectStatus.ERROR.value,
                    conn=conn,
                )
                persisted_snapshot = self.persist_progress_snapshot_with_db(
                    db,
                    conn,
                    normalized_snapshot,
                )
                conn.commit()

        return deleted, {} if persisted_snapshot is None else dict(persisted_snapshot)

    def update_task_error(
        self,
        checkpoints: list[dict[str, Any]],
        progress_snapshot: dict[str, Any] | None = None,
    ) -> dict[int, dict[str, Any]]:
        """任务失败后记录当前条目的失败检查点，并和进度快照同事务落库。"""

        now_text = datetime.now().isoformat()
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}

            with db.connection() as conn:
                existing = self.progress_service.normalize_item_checkpoint_rows(
                    db.get_analysis_item_checkpoints(conn=conn)
                )
                error_rows, updated_checkpoints = (
                    self.progress_service.build_error_checkpoint_rows(
                        checkpoints,
                        existing,
                        updated_at=now_text,
                    )
                )

                if error_rows:
                    db.upsert_analysis_item_checkpoints(error_rows, conn=conn)
                self.persist_progress_snapshot_with_db(db, conn, progress_snapshot)
                conn.commit()
                return updated_checkpoints
