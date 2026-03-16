from types import SimpleNamespace

import pytest

from base.Base import Base
from module.Engine.Engine import Engine
from module.Engine.TaskModeStrategy import TaskModeStrategy


class FakeDataManager:
    """最小假数据管理器，用来隔离分析器测试的数据库副作用。"""

    def __init__(self) -> None:
        self.loaded = True
        self.lg_path = "/workspace/demo/project.lg"
        self.analysis_extras: dict[str, object] = {}
        self.analysis_item_checkpoints: dict[int, dict[str, object]] = {}
        self.analysis_candidate_count = 0
        self.updated_rules: list[dict] = []
        self.clear_calls = 0
        self.open_calls = 0
        self.close_calls = 0
        self.import_count = 0
        self.import_expected_paths: list[str | None] = []
        self.items = []

    def is_loaded(self) -> bool:
        return self.loaded

    def open_db(self) -> None:
        self.open_calls += 1

    def close_db(self) -> None:
        self.close_calls += 1

    def get_lg_path(self) -> str | None:
        if not self.loaded:
            return None
        return self.lg_path

    def clear_analysis_progress(self) -> None:
        self.clear_calls += 1
        self.analysis_extras = {}
        self.analysis_item_checkpoints = {}
        self.analysis_candidate_count = 0

    def clear_analysis_candidates_and_progress(self) -> None:
        self.clear_analysis_progress()

    def reset_failed_analysis_checkpoints(self) -> None:
        kept: dict[int, dict[str, object]] = {}
        for item_id, checkpoint in self.analysis_item_checkpoints.items():
            if checkpoint.get("status") == Base.ProjectStatus.ERROR:
                continue
            kept[item_id] = dict(checkpoint)
        self.analysis_item_checkpoints = kept

    def get_analysis_item_checkpoints(self) -> dict[int, dict[str, object]]:
        return {
            item_id: dict(checkpoint)
            for item_id, checkpoint in self.analysis_item_checkpoints.items()
        }

    def set_analysis_extras(self, extras: dict[str, object]) -> None:
        self.analysis_extras = dict(extras)

    def get_analysis_extras(self) -> dict[str, object]:
        return dict(self.analysis_extras)

    def get_analysis_progress_snapshot(self) -> dict[str, object]:
        return dict(self.analysis_extras)

    def normalize_analysis_progress_snapshot(
        self, snapshot: dict[str, object]
    ) -> dict[str, object]:
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

    def update_analysis_progress_snapshot(
        self, snapshot: dict[str, object]
    ) -> dict[str, object]:
        self.analysis_extras = self.normalize_analysis_progress_snapshot(snapshot)
        return dict(self.analysis_extras)

    def get_analysis_status_summary(self) -> dict[str, object]:
        total_line = sum(1 for item in self.items if item.get_src().strip() != "")
        processed_line = 0
        error_line = 0

        for checkpoint in self.analysis_item_checkpoints.values():
            if checkpoint.get("status") == Base.ProjectStatus.PROCESSED:
                processed_line += 1
            elif checkpoint.get("status") == Base.ProjectStatus.ERROR:
                error_line += 1

        line = processed_line + error_line
        return {
            "total_line": total_line,
            "processed_line": processed_line,
            "error_line": error_line,
            "line": line,
        }

    def get_pending_analysis_items(self):
        pending_items = []
        for item in self.items:
            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            if item.get_src().strip() == "":
                continue

            checkpoint = self.analysis_item_checkpoints.get(item_id)
            status = checkpoint.get("status") if isinstance(checkpoint, dict) else None
            if not TaskModeStrategy.should_schedule_continue(status):
                continue

            pending_items.append(item)

        return pending_items

    def commit_analysis_task_result(
        self,
        *,
        checkpoints: list[dict[str, object]] | None = None,
        glossary_entries: list[dict[str, object]] | None = None,
        progress_snapshot: dict[str, object] | None = None,
    ) -> int:
        if checkpoints is None:
            checkpoints = []
        if glossary_entries is None:
            glossary_entries = []
        if progress_snapshot is not None:
            self.analysis_extras = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        changed_count = len(glossary_entries)
        self.analysis_candidate_count += changed_count
        for checkpoint in checkpoints:
            item_id = int(checkpoint.get("item_id", 0) or 0)
            if item_id <= 0:
                continue
            self.analysis_item_checkpoints[item_id] = {
                "status": Base.ProjectStatus.PROCESSED,
                "error_count": 0,
            }
        return changed_count

    def update_analysis_task_error(
        self,
        checkpoints: list[dict[str, object]],
        progress_snapshot: dict[str, object] | None = None,
    ) -> dict[int, dict[str, object]]:
        if progress_snapshot is not None:
            self.analysis_extras = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )
        for raw_checkpoint in checkpoints:
            item_id = int(raw_checkpoint.get("item_id", 0) or 0)
            if item_id <= 0:
                continue

            old_error_count = 0
            checkpoint = self.analysis_item_checkpoints.get(item_id)
            if checkpoint is not None:
                old_error_count = int(checkpoint.get("error_count", 0) or 0)

            self.analysis_item_checkpoints[item_id] = {
                "status": Base.ProjectStatus.ERROR,
                "error_count": old_error_count + 1,
            }
        return self.get_analysis_item_checkpoints()

    def import_analysis_candidates(
        self, expected_lg_path: str | None = None
    ) -> int | None:
        self.import_expected_paths.append(expected_lg_path)
        if not self.loaded:
            return None
        if expected_lg_path is not None and expected_lg_path != self.lg_path:
            return None
        self.import_count += 1
        return self.analysis_candidate_count

    def get_analysis_candidate_count(self) -> int:
        return self.analysis_candidate_count

    def get_all_items(self):
        return list(self.items)

    def update_batch(
        self,
        items: list[dict[str, object]] | None = None,
        rules: dict[object, object] | None = None,
        meta: dict[str, object] | None = None,
    ) -> None:
        del items, meta
        if rules is not None:
            self.updated_rules.append(rules)


@pytest.fixture(autouse=True)
def reset_engine_singleton() -> None:
    if hasattr(Engine, "__instance__"):
        delattr(Engine, "__instance__")
    yield
    if hasattr(Engine, "__instance__"):
        delattr(Engine, "__instance__")


@pytest.fixture
def fake_data_manager() -> FakeDataManager:
    return FakeDataManager()


@pytest.fixture
def quality_snapshot() -> SimpleNamespace:
    return SimpleNamespace(
        translation_prompt_enable=False,
        translation_prompt="",
        analysis_prompt_enable=False,
        analysis_prompt="",
    )
