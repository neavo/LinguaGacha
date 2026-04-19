from __future__ import annotations

from datetime import datetime
from typing import Any

from base.Base import Base
from module.Data.Core.Item import Item
from module.Engine.TaskModeStrategy import TaskModeStrategy


class AnalysisProgressService:
    """承接分析检查点、覆盖率和进度快照口径。"""

    def normalize_state_value(
        self,
        raw_status: Base.ProjectStatus | str | object,
    ) -> Base.ProjectStatus | None:
        """把状态值规整成合法的项目状态枚举。"""

        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return None
        return None

    def normalize_item_checkpoint(
        self,
        raw_checkpoint: object,
    ) -> dict[str, Any] | None:
        """把条目级检查点规整成固定结构。"""

        if not isinstance(raw_checkpoint, dict):
            return None

        item_id = raw_checkpoint.get("item_id")
        if not isinstance(item_id, int) or item_id <= 0:
            return None

        status = self.normalize_state_value(raw_checkpoint.get("status"))
        if status not in (
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.ERROR,
        ):
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
            "status": status,
            "updated_at": updated_at,
            "error_count": max(0, error_count),
        }

    def normalize_item_checkpoint_rows(
        self,
        raw_rows: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        """把批量 checkpoint 行规整成以 item_id 为键的映射。"""

        normalized: dict[int, dict[str, Any]] = {}
        for raw_row in raw_rows:
            checkpoint = self.normalize_item_checkpoint(raw_row)
            if checkpoint is None:
                continue
            normalized[checkpoint["item_id"]] = checkpoint
        return normalized

    def normalize_progress_snapshot(
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
        }

    def normalize_item_checkpoint_upsert_rows(
        self,
        checkpoints: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """把 checkpoint 输入规整成可直接写库的行。"""

        normalized_rows: list[dict[str, Any]] = []
        for raw_checkpoint in checkpoints:
            checkpoint = self.normalize_item_checkpoint(raw_checkpoint)
            if checkpoint is None:
                continue
            normalized_rows.append(
                {
                    "item_id": checkpoint["item_id"],
                    "status": checkpoint["status"].value,
                    "updated_at": checkpoint["updated_at"],
                    "error_count": checkpoint["error_count"],
                }
            )
        return normalized_rows

    def build_error_checkpoint_rows(
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
            checkpoint = self.normalize_item_checkpoint(
                {
                    "item_id": raw_checkpoint.get("item_id"),
                    "status": Base.ProjectStatus.ERROR.value,
                    "updated_at": updated_at,
                    "error_count": raw_checkpoint.get("error_count", 0),
                }
            )
            if checkpoint is None:
                continue

            previous = existing.get(checkpoint["item_id"])
            error_count = 1
            if previous is not None and previous["status"] == Base.ProjectStatus.ERROR:
                error_count = int(previous.get("error_count", 0)) + 1

            row = {
                "item_id": checkpoint["item_id"],
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": checkpoint["updated_at"],
                "error_count": error_count,
            }
            error_rows.append(row)
            updated_checkpoints[checkpoint["item_id"]] = {
                "item_id": checkpoint["item_id"],
                "status": Base.ProjectStatus.ERROR,
                "updated_at": checkpoint["updated_at"],
                "error_count": error_count,
            }

        return error_rows, updated_checkpoints

    def build_status_summary(
        self,
        items: list[Item],
        checkpoints: dict[int, dict[str, Any]],
        *,
        skipped_statuses: tuple[Base.ProjectStatus, ...],
    ) -> dict[str, Any]:
        """按当前条目文本重新计算分析覆盖率。"""

        total_line = 0
        processed_line = 0
        error_line = 0

        for item in items:
            if item.get_status() in skipped_statuses:
                continue

            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            if item.get_src().strip() == "":
                continue

            total_line += 1
            checkpoint = checkpoints.get(item_id)
            status = (
                checkpoint["status"]
                if checkpoint is not None
                else Base.ProjectStatus.NONE
            )
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
            elif status == Base.ProjectStatus.ERROR:
                error_line += 1

        return {
            "total_line": total_line,
            "processed_line": processed_line,
            "error_line": error_line,
            "line": processed_line + error_line,
        }

    def build_progress_snapshot(
        self,
        extras: dict[str, Any],
        status_summary: dict[str, Any],
    ) -> dict[str, Any]:
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
        }
        snapshot.update(extras)
        return self.normalize_progress_snapshot(
            {
                **snapshot,
                "total_line": status_summary["total_line"],
                "line": status_summary["line"],
                "processed_line": status_summary["processed_line"],
                "error_line": status_summary["error_line"],
            }
        )

    def collect_pending_items(
        self,
        items: list[Item],
        checkpoints: dict[int, dict[str, Any]],
        *,
        skipped_statuses: tuple[Base.ProjectStatus, ...] = (),
    ) -> list[Item]:
        """找出当前仍需进入分析任务的条目。"""

        pending_items: list[Item] = []
        for item in items:
            if item.get_status() in skipped_statuses:
                continue

            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            if item.get_src().strip() == "":
                continue

            checkpoint = checkpoints.get(item_id)
            status = checkpoint["status"] if checkpoint is not None else None
            if not TaskModeStrategy.should_schedule_continue(status):
                continue

            pending_items.append(item)

        return pending_items
