from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime
from typing import Any

from base.Base import Base
from model.Item import Item
from module.Data.Core.BatchService import BatchService
from module.Data.Core.DataTypes import AnalysisGlossaryImportPreview
from module.Data.Core.DataTypes import AnalysisGlossaryImportPreviewEntry
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Quality.QualityRuleService import QualityRuleService
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics
from module.Utils.JSONTool import JSONTool


class AnalysisService:
    """分析业务服务。"""

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
    def build_analysis_source_text(item: Item) -> str:
        """统一生成分析输入文本。"""

        src = item.get_src().strip()
        names_raw = item.get_name_src()
        names: list[str] = []
        if isinstance(names_raw, str):
            name = names_raw.strip()
            if name != "":
                names.append(name)
        elif isinstance(names_raw, list):
            for raw_name in names_raw:
                if not isinstance(raw_name, str):
                    continue
                name = raw_name.strip()
                if name == "" or name in names:
                    continue
                names.append(name)

        parts: list[str] = []
        if names:
            parts.append("\n".join(names))
        if src != "":
            parts.append(src)
        return "\n".join(parts).strip()

    @staticmethod
    def build_analysis_source_hash(source_text: str) -> str:
        """只认稳定文本哈希，避免切块变化导致重复提交。"""

        if source_text == "":
            return ""
        return hashlib.sha256(source_text.encode("utf-8")).hexdigest()

    @staticmethod
    def is_analysis_control_code_text(text: str) -> bool:
        """分析术语里只有纯控制码需要特殊放行。"""

        from module.Engine.Analyzer.AnalysisFakeNameInjector import (
            AnalysisFakeNameInjector,
        )

        return AnalysisFakeNameInjector.is_control_code_text(str(text).strip())

    @classmethod
    def is_analysis_control_code_self_mapping(cls, src: str, dst: str) -> bool:
        """纯控制码自映射代表占位符本体，不走普通自映射过滤。"""

        from module.Engine.Analyzer.AnalysisFakeNameInjector import (
            AnalysisFakeNameInjector,
        )

        return AnalysisFakeNameInjector.is_control_code_self_mapping(
            str(src).strip(),
            str(dst).strip(),
        )

    def get_analysis_extras(self) -> dict[str, Any]:
        extras = self.meta_service.get_meta("analysis_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_analysis_extras(self, extras: dict[str, Any]) -> None:
        self.meta_service.set_meta("analysis_extras", extras)

    def normalize_analysis_state_value(
        self,
        raw_status: Base.ProjectStatus | str | object,
    ) -> Base.ProjectStatus | None:
        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return None
        return None

    def get_analysis_state(self) -> dict[str, Base.ProjectStatus]:
        raw_state = self.meta_service.get_meta("analysis_state", {})
        if not isinstance(raw_state, dict):
            return {}

        normalized: dict[str, Base.ProjectStatus] = {}
        for rel_path, raw_status in raw_state.items():
            if not isinstance(rel_path, str) or rel_path.strip() == "":
                continue
            status = self.normalize_analysis_state_value(raw_status)
            if status is not None:
                normalized[rel_path] = status
        return normalized

    def set_analysis_state(self, state: dict[str, Base.ProjectStatus | str]) -> None:
        normalized: dict[str, str] = {}
        for rel_path, raw_status in state.items():
            if not isinstance(rel_path, str) or rel_path.strip() == "":
                continue
            status = self.normalize_analysis_state_value(raw_status)
            if status is not None:
                normalized[rel_path] = status.value
        self.meta_service.set_meta("analysis_state", normalized)

    def normalize_analysis_term_vote_map(self, raw_votes: object) -> dict[str, int]:
        """把候选票数字段规整成稳定的 {文本: 票数} 结构。"""

        if not isinstance(raw_votes, dict):
            return {}

        normalized: dict[str, int] = {}
        for raw_key, raw_value in raw_votes.items():
            if not isinstance(raw_key, str):
                continue
            key = raw_key.strip()
            try:
                votes = int(raw_value)
            except TypeError, ValueError:
                continue
            if votes <= 0:
                continue
            normalized[key] = normalized.get(key, 0) + votes
        return normalized

    def normalize_analysis_term_pool_entry(
        self,
        raw_src: str,
        raw_entry: object,
    ) -> dict[str, Any] | None:
        """把兼容旧接口的票池单项规整成固定结构。"""

        if not isinstance(raw_entry, dict):
            return None

        src = str(raw_entry.get("src", raw_src)).strip()
        if src == "":
            return None

        dst_votes = self.normalize_analysis_term_vote_map(raw_entry.get("dst_votes"))
        info_votes = self.normalize_analysis_term_vote_map(raw_entry.get("info_votes"))
        if not dst_votes:
            return None

        try:
            first_seen_index = int(raw_entry.get("first_seen_index", 0))
        except TypeError, ValueError:
            first_seen_index = 0

        return {
            "src": src,
            "dst_votes": dst_votes,
            "info_votes": info_votes,
            "first_seen_index": max(0, first_seen_index),
            "case_sensitive": bool(raw_entry.get("case_sensitive", False)),
        }

    def pick_analysis_term_pool_winner(self, votes: dict[str, int]) -> str:
        """同票时保留先出现者，避免导入结果来回抖动。"""

        if not votes:
            return ""

        best_text = ""
        best_votes = -1
        for text, count in votes.items():
            if count > best_votes:
                best_text = text
                best_votes = count
        return best_text

    def normalize_analysis_item_checkpoint(
        self,
        raw_checkpoint: object,
    ) -> dict[str, Any] | None:
        """把条目级检查点规整成固定结构。"""

        if not isinstance(raw_checkpoint, dict):
            return None

        item_id = raw_checkpoint.get("item_id")
        if not isinstance(item_id, int) or item_id <= 0:
            return None

        source_hash = str(raw_checkpoint.get("source_hash", "")).strip()
        if source_hash == "":
            return None

        status = self.normalize_analysis_state_value(raw_checkpoint.get("status"))
        if status not in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR):
            return None

        try:
            error_count = int(raw_checkpoint.get("error_count", 0))
        except TypeError, ValueError:
            error_count = 0

        updated_at_raw = raw_checkpoint.get("updated_at", "")
        if isinstance(updated_at_raw, str) and updated_at_raw.strip() != "":
            updated_at = updated_at_raw.strip()
        else:
            updated_at = datetime.now().isoformat()

        return {
            "item_id": item_id,
            "source_hash": source_hash,
            "status": status,
            "updated_at": updated_at,
            "error_count": max(0, error_count),
        }

    def normalize_analysis_task_observation(
        self,
        raw_observation: object,
    ) -> dict[str, Any] | None:
        """把任务级 observation 规整成稳定结构。"""

        if not isinstance(raw_observation, dict):
            return None

        task_fingerprint = str(raw_observation.get("task_fingerprint", "")).strip()
        src = str(raw_observation.get("src", "")).strip()
        dst = str(raw_observation.get("dst", "")).strip()
        info = str(raw_observation.get("info", "")).strip()
        if task_fingerprint == "" or src == "" or dst == "":
            return None

        created_at_raw = raw_observation.get("created_at", "")
        if isinstance(created_at_raw, str) and created_at_raw.strip() != "":
            created_at = created_at_raw.strip()
        else:
            created_at = datetime.now().isoformat()

        return {
            "task_fingerprint": task_fingerprint,
            "src": src,
            "dst": dst,
            "info": info,
            "case_sensitive": bool(raw_observation.get("case_sensitive", False)),
            "created_at": created_at,
        }

    def normalize_analysis_candidate_aggregate_entry(
        self,
        raw_src: str,
        raw_entry: object,
    ) -> dict[str, Any] | None:
        """把候选池单项规整成固定结构。"""

        if not isinstance(raw_entry, dict):
            return None

        src = str(raw_entry.get("src", raw_src)).strip()
        if src == "":
            return None

        raw_dst_votes = raw_entry.get("dst_votes")
        if isinstance(raw_dst_votes, str):
            raw_dst_votes = JSONTool.loads(raw_dst_votes)
        raw_info_votes = raw_entry.get("info_votes")
        if isinstance(raw_info_votes, str):
            raw_info_votes = JSONTool.loads(raw_info_votes)

        dst_votes = self.normalize_analysis_term_vote_map(raw_dst_votes)
        info_votes = self.normalize_analysis_term_vote_map(raw_info_votes)
        if not dst_votes:
            return None

        try:
            observation_count = int(raw_entry.get("observation_count", 0))
        except TypeError, ValueError:
            observation_count = 0

        default_time = datetime.now().isoformat()
        first_seen_at_raw = raw_entry.get("first_seen_at", default_time)
        if isinstance(first_seen_at_raw, str) and first_seen_at_raw.strip() != "":
            first_seen_at = first_seen_at_raw.strip()
        else:
            first_seen_at = default_time

        last_seen_at_raw = raw_entry.get("last_seen_at", first_seen_at)
        if isinstance(last_seen_at_raw, str) and last_seen_at_raw.strip() != "":
            last_seen_at = last_seen_at_raw.strip()
        else:
            last_seen_at = first_seen_at

        try:
            first_seen_index = int(raw_entry.get("first_seen_index", 0))
        except TypeError, ValueError:
            first_seen_index = 0

        return {
            "src": src,
            "dst_votes": dst_votes,
            "info_votes": info_votes,
            "observation_count": max(observation_count, sum(dst_votes.values()), 1),
            "first_seen_at": first_seen_at,
            "last_seen_at": last_seen_at,
            "case_sensitive": bool(raw_entry.get("case_sensitive", False)),
            "first_seen_index": max(0, first_seen_index),
        }

    def normalize_analysis_item_checkpoint_rows(
        self,
        raw_rows: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        """把批量 checkpoint 行规整成以 item_id 为键的映射。"""

        normalized: dict[int, dict[str, Any]] = {}
        for raw_row in raw_rows:
            checkpoint = self.normalize_analysis_item_checkpoint(raw_row)
            if checkpoint is None:
                continue
            normalized[checkpoint["item_id"]] = checkpoint
        return normalized

    def normalize_analysis_candidate_aggregate_rows(
        self,
        raw_rows: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """把候选池批量行规整成以 src 为键的映射。"""

        normalized: dict[str, dict[str, Any]] = {}
        for raw_row in raw_rows:
            src = str(raw_row.get("src", "")).strip()
            entry = self.normalize_analysis_candidate_aggregate_entry(src, raw_row)
            if entry is None:
                continue
            normalized[entry["src"]] = entry
        return normalized

    def normalize_analysis_progress_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        """把分析快照规整成固定字段。"""

        return {
            "start_time": float(snapshot.get("start_time", 0.0) or 0.0),
            "time": float(snapshot.get("time", 0.0) or 0.0),
            "total_line": int(snapshot.get("total_line", 0) or 0),
            "line": int(snapshot.get("line", 0) or 0),
            "processed_line": int(snapshot.get("processed_line", 0) or 0),
            "error_line": int(snapshot.get("error_line", 0) or 0),
            "total_tokens": int(snapshot.get("total_tokens", 0) or 0),
            "total_input_tokens": int(snapshot.get("total_input_tokens", 0) or 0),
            "total_output_tokens": int(snapshot.get("total_output_tokens", 0) or 0),
            "added_glossary": int(snapshot.get("added_glossary", 0) or 0),
        }

    def normalize_analysis_item_checkpoint_upsert_rows(
        self,
        checkpoints: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """把 checkpoint 输入规整成可直接写库的行。"""

        normalized_rows: list[dict[str, Any]] = []
        for raw_checkpoint in checkpoints:
            checkpoint = self.normalize_analysis_item_checkpoint(raw_checkpoint)
            if checkpoint is None:
                continue
            normalized_rows.append(
                {
                    "item_id": checkpoint["item_id"],
                    "source_hash": checkpoint["source_hash"],
                    "status": checkpoint["status"].value,
                    "updated_at": checkpoint["updated_at"],
                    "error_count": checkpoint["error_count"],
                }
            )
        return normalized_rows

    def build_analysis_task_observations_for_commit(
        self,
        task_fingerprint: str,
        glossary_entries: list[dict[str, Any]],
        *,
        created_at: str,
    ) -> list[dict[str, Any]]:
        """把模型抽出的术语规整成 observation 行。"""

        normalized_observations: list[dict[str, Any]] = []
        for raw_entry in glossary_entries:
            observation = self.normalize_analysis_task_observation(
                {
                    "task_fingerprint": task_fingerprint,
                    "src": raw_entry.get("src", ""),
                    "dst": raw_entry.get("dst", ""),
                    "info": raw_entry.get("info", ""),
                    "case_sensitive": bool(raw_entry.get("case_sensitive", False)),
                    "created_at": created_at,
                }
            )
            if observation is None:
                continue
            normalized_observations.append(observation)
        return normalized_observations

    def collect_new_analysis_task_observations(
        self,
        existing_rows: list[dict[str, Any]],
        observations: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """只保留当前任务真正新增的 observation。"""

        existing_keys = {
            (
                str(row.get("src", "")),
                str(row.get("dst", "")),
                str(row.get("info", "")),
                bool(row.get("case_sensitive", False)),
            )
            for row in existing_rows
        }

        new_observations: list[dict[str, Any]] = []
        pending_keys = set(existing_keys)
        for observation in observations:
            observation_key = (
                observation["src"],
                observation["dst"],
                observation["info"],
                observation["case_sensitive"],
            )
            if observation_key in pending_keys:
                continue
            pending_keys.add(observation_key)
            new_observations.append(observation)
        return new_observations

    def build_analysis_task_observation_insert_rows(
        self,
        observations: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """把 observation 快照转换成写库行。"""

        return [
            {
                "task_fingerprint": observation["task_fingerprint"],
                "src": observation["src"],
                "dst": observation["dst"],
                "info": observation["info"],
                "case_sensitive": observation["case_sensitive"],
                "created_at": observation["created_at"],
            }
            for observation in observations
        ]

    def merge_analysis_observations_into_candidate_aggregates(
        self,
        observations: list[dict[str, Any]],
        aggregate_map: dict[str, dict[str, Any]],
    ) -> None:
        """把新增 observation 合并进候选池快照。"""

        for observation in observations:
            src = observation["src"]
            existing_entry = aggregate_map.get(src)
            if existing_entry is None:
                aggregate_map[src] = {
                    "src": src,
                    "dst_votes": {observation["dst"]: 1},
                    "info_votes": {observation["info"]: 1},
                    "observation_count": 1,
                    "first_seen_at": observation["created_at"],
                    "last_seen_at": observation["created_at"],
                    "case_sensitive": observation["case_sensitive"],
                    "first_seen_index": 0,
                }
                continue

            dst = observation["dst"]
            existing_entry["dst_votes"][dst] = (
                int(existing_entry["dst_votes"].get(dst, 0)) + 1
            )
            info = observation["info"]
            existing_entry["info_votes"][info] = (
                int(existing_entry["info_votes"].get(info, 0)) + 1
            )
            existing_entry["observation_count"] = (
                int(existing_entry.get("observation_count", 0)) + 1
            )
            existing_entry["last_seen_at"] = observation["created_at"]
            existing_entry["case_sensitive"] = bool(
                existing_entry.get("case_sensitive", False)
                or observation["case_sensitive"]
            )

    def build_analysis_candidate_aggregate_upsert_rows(
        self,
        aggregate_map: dict[str, dict[str, Any]],
        srcs: list[str],
    ) -> list[dict[str, Any]]:
        """把指定 src 的候选池快照转换成写库行。"""

        rows: list[dict[str, Any]] = []
        for src in srcs:
            entry = aggregate_map.get(src)
            if entry is None:
                continue
            rows.append(
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
        return rows

    def persist_analysis_progress_snapshot_with_db(
        self,
        db: LGDatabase,
        conn: sqlite3.Connection,
        snapshot: dict[str, Any] | None,
        *,
        added_glossary_delta: int = 0,
    ) -> dict[str, Any] | None:
        """在现有事务内持久化分析快照，并同步会话缓存。"""

        if snapshot is None:
            return None

        persisted_snapshot = dict(snapshot)
        persisted_snapshot["added_glossary"] = (
            int(persisted_snapshot.get("added_glossary", 0) or 0) + added_glossary_delta
        )
        db.upsert_meta_entries({"analysis_extras": persisted_snapshot}, conn=conn)
        self.session.meta_cache["analysis_extras"] = dict(persisted_snapshot)
        return persisted_snapshot

    def build_analysis_error_checkpoint_rows(
        self,
        checkpoints: list[dict[str, Any]],
        existing: dict[int, dict[str, Any]],
        *,
        updated_at: str,
    ) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
        """把失败任务规整成写库行和最新快照。"""

        error_rows: list[dict[str, Any]] = []
        updated_checkpoints = dict(existing)

        for raw_checkpoint in checkpoints:
            checkpoint = self.normalize_analysis_item_checkpoint(
                {
                    "item_id": raw_checkpoint.get("item_id"),
                    "source_hash": raw_checkpoint.get("source_hash"),
                    "status": Base.ProjectStatus.ERROR.value,
                    "updated_at": updated_at,
                    "error_count": raw_checkpoint.get("error_count", 0),
                }
            )
            if checkpoint is None:
                continue

            previous = existing.get(checkpoint["item_id"])
            error_count = 1
            if (
                previous is not None
                and previous["status"] == Base.ProjectStatus.ERROR
                and previous["source_hash"] == checkpoint["source_hash"]
            ):
                error_count = int(previous.get("error_count", 0)) + 1

            row = {
                "item_id": checkpoint["item_id"],
                "source_hash": checkpoint["source_hash"],
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": checkpoint["updated_at"],
                "error_count": error_count,
            }
            error_rows.append(row)
            updated_checkpoints[checkpoint["item_id"]] = {
                "item_id": checkpoint["item_id"],
                "source_hash": checkpoint["source_hash"],
                "status": Base.ProjectStatus.ERROR,
                "updated_at": checkpoint["updated_at"],
                "error_count": error_count,
            }

        return error_rows, updated_checkpoints

    def get_analysis_item_checkpoints(self) -> dict[int, dict[str, Any]]:
        """返回条目级检查点快照。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            raw_rows = db.get_analysis_item_checkpoints()
        return self.normalize_analysis_item_checkpoint_rows(raw_rows)

    def upsert_analysis_item_checkpoints(
        self,
        checkpoints: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        """批量写入条目级检查点，并返回最新快照。"""

        normalized_rows = self.normalize_analysis_item_checkpoint_upsert_rows(
            checkpoints
        )
        if not normalized_rows:
            return self.get_analysis_item_checkpoints()

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            db.upsert_analysis_item_checkpoints(normalized_rows)

        return self.get_analysis_item_checkpoints()

    def get_analysis_task_observations(
        self,
        *,
        task_fingerprint: str | None = None,
    ) -> list[dict[str, Any]]:
        """返回任务级 observation 快照。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return []
            raw_rows = db.get_analysis_task_observations(
                task_fingerprint=task_fingerprint
            )

        normalized_rows: list[dict[str, Any]] = []
        for raw_row in raw_rows:
            observation = self.normalize_analysis_task_observation(raw_row)
            if observation is None:
                continue
            normalized_rows.append(observation)
        return normalized_rows

    def get_analysis_candidate_aggregate(self) -> dict[str, dict[str, Any]]:
        """返回项目级候选池汇总。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            raw_rows = db.get_analysis_candidate_aggregates()
        return self.normalize_analysis_candidate_aggregate_rows(raw_rows)

    def get_analysis_candidate_count(self) -> int:
        """只统计真正能导入正式术语表的候选。"""

        return len(self.build_analysis_glossary_from_candidates())

    def upsert_analysis_candidate_aggregate(
        self,
        aggregates: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """批量写入项目级候选池汇总。"""

        normalized_rows: list[dict[str, Any]] = []
        for raw_src, raw_entry in aggregates.items():
            src = str(raw_src).strip()
            entry = self.normalize_analysis_candidate_aggregate_entry(src, raw_entry)
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
            return self.get_analysis_candidate_aggregate()

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}
            db.upsert_analysis_candidate_aggregates(normalized_rows)

        return self.get_analysis_candidate_aggregate()

    def merge_analysis_candidate_aggregate(
        self,
        incoming_pool: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """兼容旧调用口径：把旧票池并进 aggregate。"""

        if not incoming_pool:
            return self.get_analysis_candidate_aggregate()

        merged_pool = self.get_analysis_candidate_aggregate()
        for raw_src, raw_entry in incoming_pool.items():
            src = str(raw_src).strip()
            incoming_entry = self.normalize_analysis_candidate_aggregate_entry(
                src,
                raw_entry,
            )
            if incoming_entry is None:
                continue

            existing_entry = merged_pool.get(incoming_entry["src"])
            if existing_entry is None:
                merged_pool[incoming_entry["src"]] = incoming_entry
                continue

            for dst, votes in incoming_entry["dst_votes"].items():
                existing_entry["dst_votes"][dst] = (
                    existing_entry["dst_votes"].get(dst, 0) + votes
                )
            for info, votes in incoming_entry["info_votes"].items():
                existing_entry["info_votes"][info] = (
                    existing_entry["info_votes"].get(info, 0) + votes
                )

            existing_entry["observation_count"] = int(
                existing_entry.get("observation_count", 0)
            ) + int(incoming_entry["observation_count"])
            existing_entry["first_seen_at"] = min(
                str(
                    existing_entry.get(
                        "first_seen_at",
                        incoming_entry["first_seen_at"],
                    )
                ),
                incoming_entry["first_seen_at"],
            )
            existing_entry["last_seen_at"] = max(
                str(
                    existing_entry.get(
                        "last_seen_at",
                        incoming_entry["last_seen_at"],
                    )
                ),
                incoming_entry["last_seen_at"],
            )
            existing_entry["case_sensitive"] = bool(
                existing_entry.get("case_sensitive", False)
                or incoming_entry["case_sensitive"]
            )

        return self.upsert_analysis_candidate_aggregate(merged_pool)

    def commit_analysis_task_result(
        self,
        *,
        task_fingerprint: str = "",
        checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        """原子提交单个分析任务结果。"""

        task_key = task_fingerprint.strip()
        if task_key == "":
            return 0
        if checkpoints is None:
            checkpoints = []
        if glossary_entries is None:
            glossary_entries = []

        normalized_checkpoints = self.normalize_analysis_item_checkpoint_upsert_rows(
            checkpoints
        )
        normalized_progress_snapshot = None
        if progress_snapshot is not None:
            normalized_progress_snapshot = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        now = datetime.now().isoformat()
        normalized_observations = self.build_analysis_task_observations_for_commit(
            task_key,
            glossary_entries,
            created_at=now,
        )

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return 0

            with db.connection() as conn:
                existing_rows = db.get_analysis_task_observations(
                    task_fingerprint=task_key,
                    conn=conn,
                )
                new_observations = self.collect_new_analysis_task_observations(
                    existing_rows,
                    normalized_observations,
                )
                inserted_count = db.insert_analysis_task_observations(
                    self.build_analysis_task_observation_insert_rows(new_observations),
                    conn=conn,
                )

                touched_srcs = sorted(
                    {observation["src"] for observation in new_observations}
                )
                if touched_srcs:
                    aggregate_map = self.normalize_analysis_candidate_aggregate_rows(
                        db.get_analysis_candidate_aggregates_by_srcs(
                            touched_srcs,
                            conn=conn,
                        )
                    )
                    self.merge_analysis_observations_into_candidate_aggregates(
                        new_observations,
                        aggregate_map,
                    )
                    db.upsert_analysis_candidate_aggregates(
                        self.build_analysis_candidate_aggregate_upsert_rows(
                            aggregate_map,
                            touched_srcs,
                        ),
                        conn=conn,
                    )

                if normalized_checkpoints:
                    db.upsert_analysis_item_checkpoints(
                        normalized_checkpoints,
                        conn=conn,
                    )

                self.persist_analysis_progress_snapshot_with_db(
                    db,
                    conn,
                    normalized_progress_snapshot,
                    added_glossary_delta=inserted_count,
                )
                conn.commit()

        return inserted_count

    def build_analysis_glossary_entry_from_candidate(
        self,
        src: str,
        entry: dict[str, Any],
    ) -> dict[str, Any] | None:
        """把候选池单项票选成正式术语。"""

        dst = self.pick_analysis_term_pool_winner(entry.get("dst_votes", {}))
        info = self.pick_analysis_term_pool_winner(entry.get("info_votes", {}))
        normalized_info = info.strip().lower()
        is_control_code_self_mapping = self.is_analysis_control_code_self_mapping(
            src,
            dst,
        )

        if src == "" or dst == "" or normalized_info == "":
            return None
        if dst == src and not is_control_code_self_mapping:
            return None
        if normalized_info in {"其它", "其他", "other"}:
            return None

        return {
            "src": src,
            "dst": dst,
            "info": info,
            "case_sensitive": bool(entry.get("case_sensitive", False)),
        }

    def build_analysis_glossary_from_candidates(self) -> list[dict[str, Any]]:
        """把项目级候选池票选成可直接导入的术语条目。"""

        glossary_entries: list[dict[str, Any]] = []
        for src, entry in sorted(self.get_analysis_candidate_aggregate().items()):
            glossary_entry = self.build_analysis_glossary_entry_from_candidate(
                src,
                entry,
            )
            if glossary_entry is None:
                continue
            glossary_entries.append(glossary_entry)
        return glossary_entries

    def build_analysis_glossary_import_preview(
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

    def filter_analysis_glossary_import_candidates(
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

            if self.is_analysis_control_code_self_mapping(
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
        """清空分析快照、检查点和候选池。"""

        with self.session.state_lock:
            db = self.session.db
            if db is not None:
                with db.connection() as conn:
                    db.delete_analysis_item_checkpoints(conn=conn)
                    db.clear_analysis_task_observations(conn=conn)
                    db.clear_analysis_candidate_aggregates(conn=conn)
                    conn.commit()

        self.set_analysis_extras({})
        self.meta_service.set_meta("analysis_state", {})
        self.meta_service.set_meta("analysis_term_pool", {})

    def clear_analysis_candidates_and_progress(self) -> None:
        """兼容旧入口，统一走完整重置。"""

        self.clear_analysis_progress()

    def reset_failed_analysis_checkpoints(self) -> int:
        """仅清除失败检查点，不动候选池和成功检查点。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return 0
            return db.delete_analysis_item_checkpoints(
                status=Base.ProjectStatus.ERROR.value
            )

    def get_analysis_status_summary(self) -> dict[str, Any]:
        """按当前条目文本重新计算分析覆盖率。"""

        checkpoints = self.get_analysis_item_checkpoints()
        total_line = 0
        processed_line = 0
        error_line = 0

        for item in self.item_service.get_all_items():
            if self.is_skipped_analysis_status(item.get_status()):
                continue

            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            source_text = self.build_analysis_source_text(item)
            if source_text == "":
                continue

            total_line += 1
            source_hash = self.build_analysis_source_hash(source_text)
            checkpoint = checkpoints.get(item_id)
            if checkpoint is None or checkpoint["source_hash"] != source_hash:
                continue

            status = checkpoint["status"]
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
            elif status == Base.ProjectStatus.ERROR:
                error_line += 1

        pending_line = max(0, total_line - processed_line - error_line)
        return {
            "total_line": total_line,
            "processed_line": processed_line,
            "error_line": error_line,
            "line": processed_line + error_line,
            "pending_line": pending_line,
        }

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        """把持久化快照和当前覆盖率合并。"""

        snapshot = {
            "start_time": 0.0,
            "time": 0.0,
            "total_line": 0,
            "line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "added_glossary": 0,
        }
        snapshot.update(self.get_analysis_extras())

        status_summary = self.get_analysis_status_summary()
        snapshot["total_line"] = status_summary["total_line"]
        snapshot["line"] = status_summary["line"]
        snapshot["processed_line"] = status_summary["processed_line"]
        snapshot["error_line"] = status_summary["error_line"]
        return snapshot

    def update_analysis_progress_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        """统一写入分析进度快照。"""

        normalized_snapshot = self.normalize_analysis_progress_snapshot(snapshot)
        self.set_analysis_extras(normalized_snapshot)
        return normalized_snapshot

    def get_pending_analysis_items(self) -> list[Item]:
        """找出当前仍需进入分析任务的条目。"""

        checkpoints = self.get_analysis_item_checkpoints()
        pending_items: list[Item] = []
        for item in self.item_service.get_all_items():
            if self.is_skipped_analysis_status(item.get_status()):
                continue

            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            source_text = self.build_analysis_source_text(item)
            if source_text == "":
                continue

            source_hash = self.build_analysis_source_hash(source_text)
            checkpoint = checkpoints.get(item_id)
            if (
                checkpoint is not None
                and checkpoint["status"] == Base.ProjectStatus.PROCESSED
                and checkpoint["source_hash"] == source_hash
            ):
                continue

            pending_items.append(item)

        return pending_items

    def update_analysis_task_error(
        self,
        checkpoints: list[dict[str, Any]],
        progress_snapshot: dict[str, Any] | None = None,
    ) -> dict[int, dict[str, Any]]:
        """任务失败后记录当前 hash 的失败检查点，并和进度快照同事务落库。"""

        normalized_progress_snapshot = None
        if progress_snapshot is not None:
            normalized_progress_snapshot = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        now_text = datetime.now().isoformat()
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return {}

            with db.connection() as conn:
                existing = self.normalize_analysis_item_checkpoint_rows(
                    db.get_analysis_item_checkpoints(conn=conn)
                )
                error_rows, updated_checkpoints = (
                    self.build_analysis_error_checkpoint_rows(
                        checkpoints,
                        existing,
                        updated_at=now_text,
                    )
                )

                if error_rows:
                    db.upsert_analysis_item_checkpoints(error_rows, conn=conn)
                self.persist_analysis_progress_snapshot_with_db(
                    db,
                    conn,
                    normalized_progress_snapshot,
                )
                conn.commit()
                return updated_checkpoints

    def get_analysis_term_pool(self) -> dict[str, dict[str, Any]]:
        """兼容旧接口：直接返回 aggregate 映射。"""

        return self.get_analysis_candidate_aggregate()

    def set_analysis_term_pool(self, pool: dict[str, dict[str, Any]]) -> None:
        """兼容旧接口：用旧票池结构重建 aggregate。"""

        with self.session.state_lock:
            db = self.session.db
            if db is not None:
                with db.connection() as conn:
                    db.clear_analysis_task_observations(conn=conn)
                    db.clear_analysis_candidate_aggregates(conn=conn)
                    conn.commit()

        normalized: dict[str, dict[str, Any]] = {}
        for raw_src, raw_entry in pool.items():
            src = str(raw_src).strip()
            entry = self.normalize_analysis_candidate_aggregate_entry(src, raw_entry)
            if entry is None:
                continue
            normalized[entry["src"]] = entry

        if normalized:
            self.upsert_analysis_candidate_aggregate(normalized)
        self.meta_service.set_meta("analysis_term_pool", {})

    def clear_analysis_term_pool(self) -> None:
        """兼容旧接口：清空候选池相关表，但不动 checkpoint。"""

        with self.session.state_lock:
            db = self.session.db
            if db is None:
                return

            with db.connection() as conn:
                db.clear_analysis_task_observations(conn=conn)
                db.clear_analysis_candidate_aggregates(conn=conn)
                conn.commit()

        self.meta_service.set_meta("analysis_term_pool", {})

    def merge_analysis_term_votes(
        self,
        incoming_pool: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """兼容旧接口：把旧票池并入 aggregate。"""

        return self.merge_analysis_candidate_aggregate(incoming_pool)

    def build_analysis_glossary_from_term_pool(self) -> list[dict[str, Any]]:
        """兼容旧接口：候选池来源已切到 aggregate。"""

        return self.build_analysis_glossary_from_candidates()

    def import_analysis_term_pool(
        self,
        expected_lg_path: str | None = None,
    ) -> int | None:
        """兼容旧接口：导入逻辑改成“新增 + 补空”。"""

        return self.import_analysis_candidates(expected_lg_path=expected_lg_path)

    def reset_failed_items_sync(self) -> dict[str, Any] | None:
        """重置失败条目并同步进度元数据。"""

        with self.session.state_lock:
            if self.session.db is None:
                return None

        items = self.item_service.get_all_items()
        if not items:
            return None

        changed_items: list[dict[str, Any]] = []
        for item in items:
            if item.get_status() != Base.ProjectStatus.ERROR:
                continue

            item.set_dst("")
            item.set_status(Base.ProjectStatus.NONE)
            item.set_retry_count(0)

            item_dict = item.to_dict()
            if isinstance(item_dict.get("id"), int):
                changed_items.append(item_dict)

        processed_line = sum(
            1 for item in items if item.get_status() == Base.ProjectStatus.PROCESSED
        )
        error_line = sum(
            1 for item in items if item.get_status() == Base.ProjectStatus.ERROR
        )
        total_line = sum(
            1
            for item in items
            if item.get_status()
            in (
                Base.ProjectStatus.NONE,
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.ERROR,
            )
        )

        extras = self.meta_service.get_meta("translation_extras", {})
        if not isinstance(extras, dict):
            extras = {}
        extras["processed_line"] = processed_line
        extras["error_line"] = error_line
        extras["line"] = processed_line + error_line
        extras["total_line"] = total_line

        project_status = (
            Base.ProjectStatus.PROCESSING
            if any(item.get_status() == Base.ProjectStatus.NONE for item in items)
            else Base.ProjectStatus.PROCESSED
        )

        self.batch_service.update_batch(
            items=changed_items or None,
            meta={
                "translation_extras": extras,
                "project_status": project_status,
            },
        )
        return extras
