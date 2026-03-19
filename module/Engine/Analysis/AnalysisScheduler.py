from __future__ import annotations

import time
from dataclasses import replace
from typing import TYPE_CHECKING
from typing import Any

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisTask import AnalysisTask
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot
from module.Engine.TaskScheduler import TaskScheduler

if TYPE_CHECKING:
    from module.Engine.Analysis.Analysis import Analysis


class AnalysisScheduler:
    """分析调度器统一维护筛选、checkpoint 解释、切块和重试语义。"""

    RETRY_LIMIT: int = 2

    def __init__(self, analysis: Analysis) -> None:
        self.analysis = analysis

    def is_skipped_analysis_status(self, status: Base.ProjectStatus) -> bool:
        """分析跳过规则统一收口，避免入口和重试分支各写一套。"""
        return DataManager.is_skipped_analysis_status(status)

    def should_include_item(self, item: Item) -> bool:
        """分析只处理真正可能产出候选术语的条目。"""
        return (
            not self.is_skipped_analysis_status(item.get_status())
            and item.get_src().strip() != ""
        )

    def get_input_token_threshold(self) -> int:
        """分析切块阈值跟着当前模型能力走，避免规划和请求口径脱节。"""
        if self.analysis.model is None:
            return 512

        threshold = self.analysis.model.get("threshold", {})
        return max(16, int(threshold.get("input_token_limit", 512) or 512))

    def normalize_checkpoint_status(
        self,
        raw_status: object,
    ) -> Base.ProjectStatus | None:
        """脏 checkpoint 状态在进入调度前统一转成稳定枚举。"""
        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return None
        return None

    def get_checkpoint_map(self) -> dict[int, dict[str, Any]]:
        """分析续跑只看这份规整后的 checkpoint 快照。"""
        raw_map = DataManager.get().get_analysis_item_checkpoints()
        normalized: dict[int, dict[str, Any]] = {}

        for raw_item_id, raw_checkpoint in raw_map.items():
            if not isinstance(raw_item_id, int):
                continue
            if not isinstance(raw_checkpoint, dict):
                continue

            status = self.normalize_checkpoint_status(raw_checkpoint.get("status"))
            if status is None:
                continue

            normalized[raw_item_id] = {
                "status": status,
                "error_count": int(raw_checkpoint.get("error_count", 0) or 0),
            }

        return normalized

    def build_item_context(
        self,
        item: Item,
        checkpoint_map: dict[int, dict[str, Any]] | None = None,
    ) -> AnalysisItemContext | None:
        """分析任务只传不可变快照，避免并发线程共享可变 Item。"""
        item_id = item.get_id()
        if not isinstance(item_id, int):
            return None

        src_text = item.get_src().strip()
        if src_text == "":
            return None

        previous_status: Base.ProjectStatus | None = None
        if checkpoint_map is not None:
            checkpoint = checkpoint_map.get(item_id)
            status = checkpoint.get("status") if checkpoint is not None else None
            if isinstance(status, Base.ProjectStatus):
                previous_status = status

        return AnalysisItemContext(
            item_id=item_id,
            file_path=item.get_file_path(),
            src_text=src_text,
            first_name_src=item.get_first_name_src(),
            previous_status=previous_status,
        )

    def collect_analysis_state(
        self,
    ) -> tuple[list[AnalysisItemContext], list[AnalysisItemContext], int, int]:
        """一次遍历同时拿到总量、待分析条目和已完成覆盖率。"""
        checkpoint_map = self.get_checkpoint_map()
        all_items: list[AnalysisItemContext] = []
        pending_items: list[AnalysisItemContext] = []
        processed_line = 0
        error_line = 0

        for item in DataManager.get().get_all_items():
            if not self.should_include_item(item):
                continue

            context = self.build_item_context(item, checkpoint_map)
            if context is None:
                continue

            all_items.append(context)
            checkpoint = checkpoint_map.get(context.item_id)
            if checkpoint is None:
                pending_items.append(context)
                continue

            status = checkpoint["status"]
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
                continue
            if status == Base.ProjectStatus.ERROR:
                error_line += 1
                continue

            pending_items.append(context)

        return all_items, pending_items, processed_line, error_line

    def build_analysis_task_contexts(self, config: Config) -> list[AnalysisTaskContext]:
        """把待分析条目切成稳定任务块，后续重试沿用同一边界。"""
        del config
        checkpoint_map = self.get_checkpoint_map()
        pending_items: list[AnalysisItemContext] = []
        for item in DataManager.get().get_pending_analysis_items():
            context = self.build_item_context(item, checkpoint_map)
            if context is not None:
                pending_items.append(context)
        return self.build_initial_analysis_contexts(
            pending_items,
            input_token_threshold=self.get_input_token_threshold(),
        )

    def build_initial_analysis_contexts(
        self,
        items: list[AnalysisItemContext],
        *,
        input_token_threshold: int,
    ) -> list[AnalysisTaskContext]:
        """分析初次切片只复用共享边界，不引入翻译的 preceding 语义。"""
        if not items:
            return []

        context_by_id = {item.item_id: item for item in items}
        seed_items = [
            Item(
                id=item.item_id,
                src=item.src_text,
                file_path=item.file_path,
                status=Base.ProjectStatus.NONE,
            )
            for item in items
        ]

        task_contexts: list[AnalysisTaskContext] = []
        for chunk_items, _precedings in TaskScheduler.generate_item_chunks_iter(
            items=seed_items,
            input_token_threshold=input_token_threshold,
            preceding_lines_threshold=0,
        ):
            chunk_context_list: list[AnalysisItemContext] = []
            for item in chunk_items:
                item_id = item.get_id()
                if not isinstance(item_id, int):
                    continue

                context = context_by_id.get(item_id)
                if context is None:
                    continue
                chunk_context_list.append(context)

            chunk_contexts = tuple(chunk_context_list)
            if not chunk_contexts:
                continue

            task_contexts.append(
                AnalysisTaskContext(
                    file_path=chunk_contexts[0].file_path,
                    items=chunk_contexts,
                )
            )
        return task_contexts

    def build_progress_snapshot(
        self,
        *,
        previous_extras: dict[str, Any],
        continue_mode: bool,
    ) -> TaskProgressSnapshot:
        """计划阶段统一把分析覆盖率和累计 token 合成当前快照。"""
        all_items, _pending_items, processed_line, error_line = (
            self.collect_analysis_state()
        )
        total_line = len(all_items)
        elapsed_time = 0.0
        start_time = time.time()
        total_tokens = 0
        total_input_tokens = 0
        total_output_tokens = 0

        if continue_mode:
            elapsed_time = float(previous_extras.get("time", 0) or 0.0)
            start_time = time.time() - elapsed_time
            total_tokens = int(previous_extras.get("total_tokens", 0) or 0)
            total_input_tokens = int(previous_extras.get("total_input_tokens", 0) or 0)
            total_output_tokens = int(
                previous_extras.get("total_output_tokens", 0) or 0
            )

        return TaskProgressSnapshot(
            start_time=start_time,
            time=elapsed_time,
            total_line=total_line,
            line=processed_line + error_line,
            processed_line=processed_line,
            error_line=error_line,
            total_tokens=total_tokens,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
        )

    def create_retry_task_context(
        self,
        task_context: AnalysisTaskContext,
    ) -> AnalysisTaskContext | None:
        """分析失败后复用原任务边界重试，避免拆分把同类失败放大。"""
        if task_context.retry_count >= self.RETRY_LIMIT:
            return None
        return replace(task_context, retry_count=task_context.retry_count + 1)

    @staticmethod
    def build_processed_checkpoints(
        context: AnalysisTaskContext,
    ) -> list[dict[str, Any]]:
        """成功提交时统一生成 processed checkpoint 载荷。"""
        updated_at = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time()))
        return [
            {
                "item_id": item.item_id,
                "status": Base.ProjectStatus.PROCESSED,
                "updated_at": updated_at,
                "error_count": 0,
            }
            for item in context.items
        ]

    @staticmethod
    def build_error_checkpoints(
        context: AnalysisTaskContext,
    ) -> list[dict[str, Any]]:
        """失败记录只落当前任务条目，不触碰候选池。"""
        return [
            {
                "item_id": item.item_id,
                "status": Base.ProjectStatus.ERROR,
                "error_count": 0,
            }
            for item in context.items
        ]

    def create_task(self, context: AnalysisTaskContext) -> AnalysisTask:
        """分析执行器统一由调度器构造，保持和翻译侧相同入口。"""
        return AnalysisTask(self.analysis, context)
