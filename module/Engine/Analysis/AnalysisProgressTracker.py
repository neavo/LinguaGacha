from __future__ import annotations

import time
from typing import TYPE_CHECKING
from typing import Any

from rich.progress import TaskID

from base.Base import Base
from module.Data.DataManager import DataManager
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot
from module.ProgressBar import ProgressBar

if TYPE_CHECKING:
    from module.Engine.Analysis.Analysis import Analysis


class AnalysisProgressTracker:
    """分析进度追踪器统一管理运行态快照、节流持久化和进度展示。"""

    PROGRESS_PERSIST_BATCH_SIZE: int = 8
    PROGRESS_PERSIST_INTERVAL_SECONDS: float = 0.5

    def __init__(self, analysis: Analysis) -> None:
        self.analysis = analysis
        self.console_progress: ProgressBar | None = None
        self.console_progress_task_id: TaskID | None = None
        self.progress_dirty: bool = False
        self.pending_progress_commit_count: int = 0
        self.last_progress_persist_at: float = 0.0

    def reset_run_state(self) -> None:
        """每次新建流水线前先清掉节流状态，避免把上轮脏状态带进来。"""
        self.progress_dirty = False
        self.pending_progress_commit_count = 0
        self.last_progress_persist_at = 0.0

    def bind_console_progress(self, progress: ProgressBar, task_id: TaskID) -> None:
        """控制台进度条统一绑定在 tracker，后续所有更新都走同一入口。"""
        self.console_progress = progress
        self.console_progress_task_id = task_id

    def clear_console_progress(self) -> None:
        """任务结束后立刻解绑，避免收尾持久化碰到已关闭的进度条。"""
        self.console_progress = None
        self.console_progress_task_id = None

    def get_extra_int(self, key: str) -> int:
        """运行态计数统一按整数读取，避免每处都重复做同样的兜底转换。"""
        return int(self.analysis.extras.get(key, 0) or 0)

    def set_extra_int(self, key: str, value: int) -> None:
        """运行态计数统一按整数写回，保持 extras 字段口径稳定。"""
        self.analysis.extras[key] = int(value)

    def update_console_progress(self, snapshot: dict[str, Any]) -> None:
        """控制台进度和 UI 进度都吃同一份快照，避免两套口径越跑越偏。"""
        progress = self.console_progress
        task_id = self.console_progress_task_id
        if progress is None or task_id is None:
            return

        progress.update(
            task_id,
            completed=int(snapshot.get("line", 0) or 0),
            total=int(snapshot.get("total_line", 0) or 0),
        )

    def update_extras_after_result(self, result: AnalysisTaskResult) -> None:
        """token 统计统一在这里累加，避免成功和失败分支各写一遍。"""
        self.update_extras_after_batch(
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )

    def update_extras_after_batch(
        self,
        *,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        """批次提交时一次性累计 token，降低热路径重复读写 extras。"""
        total_input_tokens = self.get_extra_int("total_input_tokens") + int(
            input_tokens
        )
        total_output_tokens = self.get_extra_int("total_output_tokens") + int(
            output_tokens
        )
        self.set_extra_int("total_input_tokens", total_input_tokens)
        self.set_extra_int("total_output_tokens", total_output_tokens)
        self.set_extra_int("total_tokens", total_input_tokens + total_output_tokens)

    def sync_runtime_line_stats(self) -> None:
        """运行中只维护轻量计数，避免每个结果都回库全量重算覆盖率。"""
        self.set_extra_int(
            "line",
            self.get_extra_int("processed_line") + self.get_extra_int("error_line"),
        )

    def build_runtime_progress_snapshot(self) -> TaskProgressSnapshot:
        """运行态快照直接取内存累计值，让热路径只依赖本地状态。"""
        snapshot = TaskProgressSnapshot.from_dict(self.analysis.extras)
        start_time = snapshot.start_time if snapshot.start_time > 0 else time.time()
        snapshot = TaskProgressSnapshot(
            start_time=start_time,
            time=snapshot.time,
            total_line=snapshot.total_line,
            line=snapshot.line,
            processed_line=snapshot.processed_line,
            error_line=snapshot.error_line,
            total_tokens=snapshot.total_tokens,
            total_input_tokens=snapshot.total_input_tokens,
            total_output_tokens=snapshot.total_output_tokens,
        )
        snapshot = snapshot.with_counts()
        snapshot = snapshot.with_elapsed(now=time.time())
        normalized = DataManager.get().normalize_analysis_progress_snapshot(
            snapshot.to_dict()
        )
        return TaskProgressSnapshot.from_dict(normalized)

    def refresh_progress_snapshot_cache(self) -> TaskProgressSnapshot:
        """在低频边界显式全量校准，并把最新快照回收到控制器。"""
        dm = DataManager.get()
        if not dm.is_loaded():
            return self.build_runtime_progress_snapshot()

        refreshed_snapshot = TaskProgressSnapshot.from_dict(
            dm.refresh_analysis_progress_snapshot_cache()
        )
        self.analysis.set_progress_snapshot(refreshed_snapshot)
        return refreshed_snapshot

    def update_runtime_counts_after_success(self, result: AnalysisTaskResult) -> None:
        """成功后先更新内存计数，再把一致快照交给数据层提交。"""
        recovered_error_count = sum(
            1
            for item in result.context.items
            if item.previous_status == Base.ProjectStatus.ERROR
        )
        if recovered_error_count > 0:
            self.set_extra_int(
                "error_line",
                max(0, self.get_extra_int("error_line") - recovered_error_count),
            )

        self.set_extra_int(
            "processed_line",
            self.get_extra_int("processed_line") + result.context.item_count,
        )
        self.sync_runtime_line_stats()

    def update_runtime_counts_after_error(
        self,
        task_context: AnalysisTaskContext,
    ) -> None:
        """失败后只补首次失败计数，避免重试路径把 error_line 越加越大。"""
        new_error_count = sum(
            1
            for item in task_context.items
            if item.previous_status != Base.ProjectStatus.ERROR
        )
        if new_error_count > 0:
            self.set_extra_int(
                "error_line",
                self.get_extra_int("error_line") + new_error_count,
            )
        self.sync_runtime_line_stats()

    def mark_progress_dirty(self, *, commit_count: int = 1) -> None:
        """有新结果进入提交环节后标记脏状态，供节流持久化判断。"""
        self.progress_dirty = True
        self.pending_progress_commit_count += max(1, int(commit_count))

    def should_persist_progress_now(self) -> bool:
        """按批次或时间片持久化运行态快照，减少热路径写库频率。"""
        if not self.progress_dirty:
            return False

        if self.pending_progress_commit_count >= self.PROGRESS_PERSIST_BATCH_SIZE:
            return True

        return (
            time.time() - self.last_progress_persist_at
            >= self.PROGRESS_PERSIST_INTERVAL_SECONDS
        )

    def clear_progress_dirty_state(self) -> None:
        """真正写库后立刻清掉脏标记，避免重复持久化。"""
        self.progress_dirty = False
        self.pending_progress_commit_count = 0
        self.last_progress_persist_at = time.time()

    def sync_progress_snapshot_after_commit(self, *, force: bool) -> dict[str, Any]:
        """运行中默认只发事件，命中节流条件或收尾时再真正写库。"""
        save_state = force or self.should_persist_progress_now()
        snapshot = self.persist_progress_snapshot(
            save_state=save_state,
            refresh_cache=force,
        )
        if save_state:
            self.clear_progress_dirty_state()
        return snapshot

    def persist_progress_snapshot(
        self,
        save_state: bool,
        *,
        refresh_cache: bool = False,
    ) -> dict[str, Any]:
        """分析进度统一经由这个入口发事件；普通保存只写缓存，边界阶段再显式校准。"""
        snapshot = self.build_runtime_progress_snapshot()
        if save_state:
            dm = DataManager.get()
            if dm.is_loaded():
                snapshot = TaskProgressSnapshot.from_dict(
                    dm.update_analysis_progress_snapshot(snapshot.to_dict())
                )
        if refresh_cache:
            snapshot = self.refresh_progress_snapshot_cache()

        snapshot_dict = self.analysis.set_progress_snapshot(snapshot)
        self.update_console_progress(snapshot_dict)
        self.analysis.emit(Base.Event.ANALYSIS_PROGRESS, snapshot_dict)
        return snapshot_dict
