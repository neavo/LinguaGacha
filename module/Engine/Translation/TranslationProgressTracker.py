from __future__ import annotations

import time
from typing import TYPE_CHECKING
from typing import Any

from base.Base import Base
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot

if TYPE_CHECKING:
    from module.Engine.Translation.Translation import Translation


class TranslationProgressTracker:
    """翻译进度追踪器统一维护运行态快照、落库和 UI 刷新。"""

    def __init__(self, translation: "Translation") -> None:
        self.translation = translation

    def get_progress_snapshot(self) -> TaskProgressSnapshot:
        """控制器内部统一从 extras 读共享快照，避免字段口径漂移。"""
        return TaskProgressSnapshot.from_dict(self.translation.extras)

    def set_progress_snapshot(self, snapshot: TaskProgressSnapshot) -> dict[str, Any]:
        """控制器内部统一只通过共享快照回写 extras。"""
        self.translation.extras = snapshot.to_dict()
        return dict(self.translation.extras)

    def build_counted_snapshot(
        self,
        *,
        processed_line: int,
        error_line: int,
        total_line: int | None = None,
    ) -> TaskProgressSnapshot:
        """行数统计统一经由这里回写，避免不同路径自己拼 snapshot。"""
        snapshot = self.get_progress_snapshot().with_counts(
            processed_line=processed_line,
            error_line=error_line,
            total_line=total_line,
        )
        return snapshot.with_elapsed(now=time.time())

    def update_extras_snapshot(
        self,
        *,
        processed_count: int,
        error_count: int,
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, Any]:
        """提交阶段统一累加行数和 token，保证所有入口都走同一口径。"""
        snapshot = self.get_progress_snapshot()
        snapshot = snapshot.with_counts(
            processed_line=snapshot.processed_line + processed_count,
            error_line=snapshot.error_line + error_count,
        )
        snapshot = snapshot.add_tokens(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        snapshot = snapshot.with_elapsed(now=time.time())
        return self.set_progress_snapshot(snapshot)

    def sync_extras_line_stats(self) -> None:
        """任务结束时用 items_cache 回填，避免并发重试造成轻微计数漂移。"""
        if self.translation.items_cache is None:
            return

        processed_line = 0
        error_line = 0
        remaining_line = 0
        for item in self.translation.items_cache:
            status = item.get_status()
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
            elif status == Base.ProjectStatus.ERROR:
                error_line += 1
            elif status == Base.ProjectStatus.NONE:
                remaining_line += 1

        snapshot = self.build_counted_snapshot(
            processed_line=processed_line,
            error_line=error_line,
            total_line=processed_line + error_line + remaining_line,
        )
        self.set_progress_snapshot(snapshot)

    def persist_progress_snapshot(self, save_state: bool) -> dict[str, Any]:
        """共享生命周期骨架通过这里统一触发翻译快照持久化。"""
        if save_state and self.translation.items_cache is not None:
            self.translation.save_translation_state(Base.ProjectStatus.PROCESSING)
        return dict(self.translation.extras)

    def update_pipeline_progress(self, extras_snapshot: dict[str, Any]) -> None:
        """提交后统一发出翻译进度事件，保持 UI 和持久化口径一致。"""
        self.translation.emit(Base.Event.TRANSLATION_PROGRESS, extras_snapshot)

    def build_plan_snapshot(self, *, continue_mode: bool) -> TaskProgressSnapshot:
        """计划阶段统一构造初始快照，避免控制器拼接统计细节。"""
        if continue_mode:
            dm_snapshot = self.translation.dm.get_translation_extras()
            snapshot = TaskProgressSnapshot.from_dict(dm_snapshot)
            return TaskProgressSnapshot(
                start_time=time.time() - snapshot.time,
                time=snapshot.time,
                total_line=snapshot.total_line,
                line=snapshot.line,
                processed_line=self.translation.get_item_count_by_status(
                    Base.ProjectStatus.PROCESSED
                ),
                error_line=self.translation.get_item_count_by_status(
                    Base.ProjectStatus.ERROR
                ),
                total_tokens=snapshot.total_tokens,
                total_input_tokens=snapshot.total_input_tokens,
                total_output_tokens=snapshot.total_output_tokens,
            ).with_counts()

        return TaskProgressSnapshot.empty(start_time=time.time())
