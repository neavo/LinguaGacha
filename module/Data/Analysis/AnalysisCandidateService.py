from __future__ import annotations

from datetime import datetime
from typing import Any

from module.Engine.Analyzer.AnalysisTextPolicy import AnalysisTextPolicy
from module.Utils.JSONTool import JSONTool


class AnalysisCandidateService:
    """承接分析 observation、候选聚合和候选转术语的纯业务逻辑。"""

    def normalize_vote_map(self, raw_votes: object) -> dict[str, int]:
        """把票数字段规整成稳定的 {文本: 票数} 结构。"""

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

    def normalize_task_observation(
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

    def normalize_candidate_aggregate_entry(
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

        dst_votes = self.normalize_vote_map(raw_dst_votes)
        info_votes = self.normalize_vote_map(raw_info_votes)
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

    def normalize_candidate_aggregate_rows(
        self,
        raw_rows: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """把候选池批量行规整成以 src 为键的映射。"""

        normalized: dict[str, dict[str, Any]] = {}
        for raw_row in raw_rows:
            src = str(raw_row.get("src", "")).strip()
            entry = self.normalize_candidate_aggregate_entry(src, raw_row)
            if entry is None:
                continue
            normalized[entry["src"]] = entry
        return normalized

    def build_task_observations_for_commit(
        self,
        task_fingerprint: str,
        glossary_entries: list[dict[str, Any]],
        *,
        created_at: str,
    ) -> list[dict[str, Any]]:
        """把模型抽出的术语规整成 observation 行。"""

        normalized_observations: list[dict[str, Any]] = []
        for raw_entry in glossary_entries:
            observation = self.normalize_task_observation(
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

    def collect_new_task_observations(
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

    def build_task_observation_insert_rows(
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

    def merge_observations_into_candidate_aggregates(
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

    def build_candidate_aggregate_upsert_rows(
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

    def merge_candidate_aggregate(
        self,
        current_aggregate: dict[str, dict[str, Any]],
        incoming_aggregate: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """把传入候选池并入现有聚合快照。"""

        merged_aggregate = {
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
            for src, entry in current_aggregate.items()
        }

        for raw_src, raw_entry in incoming_aggregate.items():
            src = str(raw_src).strip()
            incoming_entry = self.normalize_candidate_aggregate_entry(src, raw_entry)
            if incoming_entry is None:
                continue

            existing_entry = merged_aggregate.get(incoming_entry["src"])
            if existing_entry is None:
                merged_aggregate[incoming_entry["src"]] = incoming_entry
                continue

            for dst, votes in incoming_entry["dst_votes"].items():
                existing_entry["dst_votes"][dst] = (
                    int(existing_entry["dst_votes"].get(dst, 0)) + votes
                )
            for info, votes in incoming_entry["info_votes"].items():
                existing_entry["info_votes"][info] = (
                    int(existing_entry["info_votes"].get(info, 0)) + votes
                )

            existing_entry["observation_count"] = int(
                existing_entry.get("observation_count", 0)
            ) + int(incoming_entry["observation_count"])
            existing_entry["first_seen_at"] = min(
                str(
                    existing_entry.get("first_seen_at", incoming_entry["first_seen_at"])
                ),
                incoming_entry["first_seen_at"],
            )
            existing_entry["last_seen_at"] = max(
                str(existing_entry.get("last_seen_at", incoming_entry["last_seen_at"])),
                incoming_entry["last_seen_at"],
            )
            existing_entry["case_sensitive"] = bool(
                existing_entry.get("case_sensitive", False)
                or incoming_entry["case_sensitive"]
            )

        return merged_aggregate

    def pick_candidate_winner(self, votes: dict[str, int]) -> str:
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

    def build_glossary_entry_from_candidate(
        self,
        src: str,
        entry: dict[str, Any],
    ) -> dict[str, Any] | None:
        """把候选池单项票选成正式术语。"""

        dst = self.pick_candidate_winner(entry.get("dst_votes", {}))
        info = self.pick_candidate_winner(entry.get("info_votes", {}))
        normalized_info = info.strip().lower()
        is_control_code_self_mapping = AnalysisTextPolicy.is_control_code_self_mapping(
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

    def build_glossary_from_candidates(
        self,
        candidate_aggregate: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """把项目级候选池票选成可直接导入的术语条目。"""

        glossary_entries: list[dict[str, Any]] = []
        for src, entry in sorted(candidate_aggregate.items()):
            glossary_entry = self.build_glossary_entry_from_candidate(src, entry)
            if glossary_entry is None:
                continue
            glossary_entries.append(glossary_entry)
        return glossary_entries
