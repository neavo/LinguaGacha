from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait
from dataclasses import replace
from typing import TYPE_CHECKING
from typing import Any

import rich
from rich import box
from rich import markup
from rich.progress import TaskID
from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Analysis.AnalysisFakeNameInjector import AnalysisFakeNameInjector
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.Engine import Engine
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot
from module.Engine.TaskScheduler import TaskScheduler
from module.Engine.TaskModeStrategy import TaskModeStrategy
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestExecutor import TaskRequestExecutor
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar
from module.PromptBuilder import PromptBuilder
from module.Response.ResponseCleaner import ResponseCleaner
from module.TextProcessor import TextProcessor
from module.Text.TextHelper import TextHelper

if TYPE_CHECKING:
    from module.Engine.Analysis.Analysis import Analysis


# 流水线类只负责“分析怎么跑”，主控制器只保留事件和生命周期管理。
class AnalysisPipeline:
    RETRY_LIMIT: int = 2  # 分析任务最多自动重试 2 次，避免同类失败无限空转。

    def __init__(self, analysis: Analysis) -> None:
        self.analysis = analysis
        self.console_progress: ProgressBar | None = None
        self.console_progress_task_id: TaskID | None = None

    def bind_console_progress(self, progress: ProgressBar, task_id: TaskID) -> None:
        """把控制台进度条绑定到流水线，后续统一跟着快照更新。"""
        self.console_progress = progress
        self.console_progress_task_id = task_id

    def clear_console_progress(self) -> None:
        """结束主任务后立刻解绑，避免收尾持久化再碰已关闭的进度条。"""
        self.console_progress = None
        self.console_progress_task_id = None

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

    def is_skipped_analysis_status(self, status: Base.ProjectStatus) -> bool:
        """统一维护分析链路的跳过状态，避免不同入口各写一套判断。"""
        return DataManager.is_skipped_analysis_status(status)

    def should_include_item(self, item: Item) -> bool:
        """分析只处理真正可能产出候选术语的条目。"""
        if self.is_skipped_analysis_status(item.get_status()):
            return False
        return item.get_src().strip() != ""

    def get_input_token_threshold(self) -> int:
        """切块阈值跟当前模型能力走，避免任务计划和请求能力脱节。"""
        if self.analysis.model is None:
            return 512

        threshold = self.analysis.model.get("threshold", {})
        return max(16, int(threshold.get("input_token_limit", 512) or 512))

    def normalize_checkpoint_status(
        self, raw_status: object
    ) -> Base.ProjectStatus | None:
        """把脏 checkpoint 状态收敛成统一枚举，避免后续判断分叉。"""
        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return None
        return None

    def get_checkpoint_map(self) -> dict[int, dict[str, Any]]:
        """读取并规整 checkpoint，后续所有续跑逻辑都只看这份快照。"""
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
        """把 Item 收成不可变快照，避免并发任务共享可变对象引用。"""
        item_id = item.get_id()
        if not isinstance(item_id, int):
            return None

        src_text = item.get_src().strip()
        if src_text == "":
            return None

        previous_status: Base.ProjectStatus | None = None
        if checkpoint_map is not None:
            checkpoint = checkpoint_map.get(item_id)
            if checkpoint is not None:
                status = checkpoint.get("status")
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
        """一次遍历同时拿到总量、待分析和现有覆盖率，避免口径漂移。"""
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
            if TaskModeStrategy.should_schedule_continue(status):
                pending_items.append(context)
                continue

            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
                continue
            if status == Base.ProjectStatus.ERROR:
                error_line += 1
                continue

            pending_items.append(context)

        return all_items, pending_items, processed_line, error_line

    def create_retry_task_context(
        self, task_context: AnalysisTaskContext
    ) -> AnalysisTaskContext | None:
        """失败后复用同一任务边界重试，避免拆分把同类失败重复放大。"""
        if task_context.retry_count >= __class__.RETRY_LIMIT:
            return None

        return replace(task_context, retry_count=task_context.retry_count + 1)

    def build_analysis_task_contexts(self, config: Config) -> list[AnalysisTaskContext]:
        """把待分析条目切成任务块，后续重试和提交都沿用这份切块边界。"""
        del config
        dm = DataManager.get()
        checkpoint_map = self.get_checkpoint_map()
        pending_items: list[AnalysisItemContext] = []

        for item in dm.get_pending_analysis_items():
            context = self.build_item_context(item, checkpoint_map)
            if context is not None:
                pending_items.append(context)
        return TaskScheduler.build_initial_analysis_contexts(
            items=pending_items,
            input_token_threshold=self.get_input_token_threshold(),
        )

    def build_progress_snapshot(
        self,
        *,
        previous_extras: dict[str, Any],
        continue_mode: bool,
    ) -> TaskProgressSnapshot:
        """把覆盖率和累计统计合成当前快照，UI 和持久化都吃同一口径。"""
        all_items, _pending_items, processed_line, error_line = (
            self.collect_analysis_state()
        )
        total_line = len(all_items)
        if continue_mode:
            elapsed_time = float(previous_extras.get("time", 0) or 0.0)
            start_time = time.time() - elapsed_time
            total_tokens = int(previous_extras.get("total_tokens", 0) or 0)
            total_input_tokens = int(previous_extras.get("total_input_tokens", 0) or 0)
            total_output_tokens = int(
                previous_extras.get("total_output_tokens", 0) or 0
            )
        else:
            elapsed_time = 0.0
            start_time = time.time()
            total_tokens = 0
            total_input_tokens = 0
            total_output_tokens = 0

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

    def update_extras_after_result(self, result: AnalysisTaskResult) -> None:
        """token 统计统一在这里累加，避免成功和失败两条分支各写一遍。"""
        self.analysis.extras["total_input_tokens"] = (
            int(self.analysis.extras.get("total_input_tokens", 0)) + result.input_tokens
        )
        self.analysis.extras["total_output_tokens"] = (
            int(self.analysis.extras.get("total_output_tokens", 0))
            + result.output_tokens
        )
        self.analysis.extras["total_tokens"] = int(
            self.analysis.extras.get("total_input_tokens", 0)
        ) + int(self.analysis.extras.get("total_output_tokens", 0))

    def sync_runtime_line_stats(self) -> None:
        """运行中只维护轻量计数，避免每个结果都回库全量重算覆盖率。"""
        self.analysis.extras["line"] = int(
            self.analysis.extras.get("processed_line", 0)
        ) + int(self.analysis.extras.get("error_line", 0))

    def build_runtime_progress_snapshot(self) -> TaskProgressSnapshot:
        """运行态快照直接取内存累计值，对齐翻译链路的热路径做法。"""
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

    def reconcile_progress_snapshot(
        self, snapshot: TaskProgressSnapshot
    ) -> TaskProgressSnapshot:
        """只在边界阶段回库校准一次，保证最终快照和 checkpoint 口径一致。"""
        dm = DataManager.get()
        if not dm.is_loaded():
            return snapshot

        status_summary = dm.get_analysis_status_summary()
        reconciled = snapshot.with_counts(
            total_line=int(status_summary.get("total_line", 0) or 0),
            processed_line=int(
                status_summary.get("processed_line", snapshot.processed_line) or 0
            ),
            error_line=int(status_summary.get("error_line", snapshot.error_line) or 0),
            line=int(status_summary.get("line", 0) or 0),
        )
        normalized = dm.normalize_analysis_progress_snapshot(reconciled.to_dict())
        return TaskProgressSnapshot.from_dict(normalized)

    def build_processed_checkpoints(
        self, context: AnalysisTaskContext
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

    def build_error_checkpoints(
        self, context: AnalysisTaskContext
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

    def update_runtime_counts_after_success(self, result: AnalysisTaskResult) -> None:
        """成功后先更新内存计数，再把一致快照交给数据层提交。"""
        recovered_error_count = sum(
            1
            for item in result.context.items
            if item.previous_status == Base.ProjectStatus.ERROR
        )
        if recovered_error_count > 0:
            self.analysis.extras["error_line"] = max(
                0,
                int(self.analysis.extras.get("error_line", 0)) - recovered_error_count,
            )

        self.analysis.extras["processed_line"] = (
            int(self.analysis.extras.get("processed_line", 0))
            + result.context.item_count
        )
        self.sync_runtime_line_stats()

    def update_runtime_counts_after_error(
        self, task_context: AnalysisTaskContext
    ) -> None:
        """失败后只补首次失败计数，避免重试路径把 error_line 越加越大。"""
        new_error_count = sum(
            1
            for item in task_context.items
            if item.previous_status != Base.ProjectStatus.ERROR
        )
        if new_error_count > 0:
            self.analysis.extras["error_line"] = (
                int(self.analysis.extras.get("error_line", 0)) + new_error_count
            )
        self.sync_runtime_line_stats()

    def apply_success_result(self, result: AnalysisTaskResult) -> None:
        """成功立即原子提交，并把失败重跑成功的条目从 error 统计里扣掉。"""
        dm = DataManager.get()
        self.update_runtime_counts_after_success(result)
        checkpoints = self.build_processed_checkpoints(result.context)
        progress_snapshot = self.build_runtime_progress_snapshot().to_dict()
        dm.commit_analysis_task_result(
            checkpoints=checkpoints,
            glossary_entries=list(result.glossary_entries),
            progress_snapshot=progress_snapshot,
        )

    def apply_error_result(self, task_context: AnalysisTaskContext) -> None:
        """失败只记录 checkpoint，并避免重复累加已经失败过的条目数。"""
        dm = DataManager.get()
        checkpoints = self.build_error_checkpoints(task_context)
        self.update_runtime_counts_after_error(task_context)
        dm.update_analysis_task_error(
            checkpoints,
            progress_snapshot=self.build_runtime_progress_snapshot().to_dict(),
        )

    def submit_pending_task_contexts(
        self,
        *,
        executor: ThreadPoolExecutor,
        pending_queue: deque[AnalysisTaskContext],
        running: dict[Future[AnalysisTaskResult], AnalysisTaskContext],
        concurrency: int,
    ) -> None:
        """把待执行队列补满到并发上限，避免调度循环把同一段提交逻辑写两遍。"""
        while (
            pending_queue
            and len(running) < concurrency
            and not self.analysis.should_stop()
        ):
            context = pending_queue.popleft()
            future = executor.submit(self.analysis.run_task_context, context)
            running[future] = context

    def execute_task_contexts(
        self, task_contexts: list[AnalysisTaskContext], *, max_workers: int
    ) -> str:
        """并发执行任务块，失败时按固定次数重试，成功则立即提交。"""
        if not task_contexts:
            return "SUCCESS"

        pending_queue: deque[AnalysisTaskContext] = deque(task_contexts)
        running: dict[Future[AnalysisTaskResult], AnalysisTaskContext] = {}
        has_error = False
        stopped = False
        concurrency = max(1, min(max_workers, len(task_contexts)))

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            self.submit_pending_task_contexts(
                executor=executor,
                pending_queue=pending_queue,
                running=running,
                concurrency=concurrency,
            )

            while running:
                done, _ = wait(
                    list(running.keys()),
                    timeout=0.1,
                    return_when=FIRST_COMPLETED,
                )
                if not done:
                    if self.analysis.should_stop():
                        stopped = True
                    continue

                for future in done:
                    context = running.pop(future)
                    try:
                        result = future.result()
                    except Exception as e:
                        LogManager.get().warning(Localizer.get().task_failed, e)
                        result = AnalysisTaskResult(
                            context=context,
                            success=False,
                            stopped=False,
                        )

                    self.update_extras_after_result(result)
                    if result.success:
                        self.apply_success_result(result)
                    elif result.stopped:
                        stopped = True
                    else:
                        retry_context = self.create_retry_task_context(context)
                        if retry_context is not None:
                            pending_queue.appendleft(retry_context)
                        else:
                            self.apply_error_result(context)
                            has_error = True

                    self.persist_progress_snapshot(save_state=False)

                    self.submit_pending_task_contexts(
                        executor=executor,
                        pending_queue=pending_queue,
                        running=running,
                        concurrency=concurrency,
                    )

                if self.analysis.should_stop():
                    stopped = True

        if stopped:
            return "STOPPED"
        if has_error:
            return "FAILED"
        return "SUCCESS"

    def run_task_context(self, context: AnalysisTaskContext) -> AnalysisTaskResult:
        """请求前统一经过限流器，避免请求层知道调度细节。"""
        if self.analysis.should_stop():
            return AnalysisTaskResult(context=context, success=False, stopped=True)

        limiter = self.analysis.task_limiter
        if limiter is None:
            return self.execute_task_request(context)

        if not limiter.acquire(stop_checker=self.analysis.should_stop):
            return AnalysisTaskResult(context=context, success=False, stopped=True)

        try:
            if not limiter.wait(stop_checker=self.analysis.should_stop):
                return AnalysisTaskResult(context=context, success=False, stopped=True)
            return self.execute_task_request(context)
        finally:
            limiter.release()

    def execute_task_request(self, context: AnalysisTaskContext) -> AnalysisTaskResult:
        """执行单个任务块的模型请求，并把响应解码成统一术语结构。"""
        if self.analysis.model is None or self.analysis.quality_snapshot is None:
            return AnalysisTaskResult(context=context, success=False, stopped=False)

        prompt_srcs = self.build_prompt_source_texts(context.items)
        if not prompt_srcs:
            return AnalysisTaskResult(context=context, success=True, stopped=False)

        request_srcs, fake_name_injector = self.build_request_source_texts(prompt_srcs)
        prompt_builder = PromptBuilder(
            self.analysis.config,
            quality_snapshot=self.analysis.quality_snapshot,
        )
        messages, _console_log = prompt_builder.generate_glossary_prompt(request_srcs)

        request_response = TaskRequestExecutor.execute(
            config=self.analysis.config,
            model=self.analysis.model,
            messages=messages,
            requester_factory=TaskRequester,
            stop_checker=self.analysis.should_stop,
        )

        if request_response.is_cancelled():
            return AnalysisTaskResult(context=context, success=False, stopped=True)
        if self.analysis.should_stop():
            return AnalysisTaskResult(context=context, success=False, stopped=True)

        if request_response.is_recoverable_exception():
            status_text = (
                Localizer.get().response_checker_fail_timeout
                if isinstance(request_response.exception, RequestHardTimeoutError)
                else Localizer.get().response_checker_fail_degradation
            )
            self.print_chunk_log(
                start=request_response.start_time,
                pt=request_response.input_tokens,
                ct=request_response.output_tokens,
                srcs=prompt_srcs,
                glossary_entries=[],
                response_think=request_response.normalized_think,
                response_result=request_response.cleaned_response_result,
                status_text=status_text,
                log_func=LogManager.get().warning,
                style="yellow",
            )
            return AnalysisTaskResult(
                context=context,
                success=False,
                stopped=False,
                input_tokens=request_response.input_tokens,
                output_tokens=request_response.output_tokens,
            )

        if request_response.exception is not None:
            LogManager.get().warning(
                Localizer.get().task_failed,
                request_response.exception,
            )
            return AnalysisTaskResult(
                context=context,
                success=False,
                stopped=False,
                input_tokens=request_response.input_tokens,
                output_tokens=request_response.output_tokens,
            )

        normalized_entries = self.normalize_glossary_entries(
            list(request_response.decoded_glossary_entries),
            fake_name_injector=fake_name_injector,
        )
        if not normalized_entries and not request_response.has_why_block:
            self.print_chunk_log(
                start=request_response.start_time,
                pt=request_response.input_tokens,
                ct=request_response.output_tokens,
                srcs=prompt_srcs,
                glossary_entries=[],
                response_think=request_response.normalized_think,
                response_result=request_response.cleaned_response_result,
                status_text=Localizer.get().response_checker_fail_data,
                log_func=LogManager.get().warning,
                style="yellow",
            )
            return AnalysisTaskResult(
                context=context,
                success=False,
                stopped=False,
                input_tokens=request_response.input_tokens,
                output_tokens=request_response.output_tokens,
            )

        self.print_chunk_log(
            start=request_response.start_time,
            pt=request_response.input_tokens,
            ct=request_response.output_tokens,
            srcs=prompt_srcs,
            glossary_entries=normalized_entries,
            response_think=request_response.normalized_think,
            response_result=request_response.cleaned_response_result,
            status_text="",
            log_func=LogManager.get().info,
            style="green",
        )

        return AnalysisTaskResult(
            context=context,
            success=True,
            stopped=False,
            input_tokens=request_response.input_tokens,
            output_tokens=request_response.output_tokens,
            glossary_entries=tuple(normalized_entries),
        )

    def build_prompt_source_texts(
        self, items: tuple[AnalysisItemContext, ...]
    ) -> list[str]:
        """分析请求前按翻译同口径注入说话人前缀，但不污染上下文快照。"""
        prompt_srcs: list[str] = []
        for item in items:
            src_text = item.src_text.strip()
            if src_text == "":
                continue

            prompt_srcs.extend(TextProcessor.inject_name([src_text], item.first_name_src))
        return prompt_srcs

    def build_request_source_texts(
        self, srcs: list[str]
    ) -> tuple[list[str], AnalysisFakeNameInjector]:
        """分析请求只在这里注入伪名，避免外部状态和 checkpoint 口径被污染。"""
        fake_name_injector = AnalysisFakeNameInjector(srcs)
        return fake_name_injector.inject_texts(srcs), fake_name_injector

    def split_glossary_entry_pairs(self, src: str, dst: str) -> list[tuple[str, str]]:
        """复合术语按统一分词结果拆分，避免候选池重复混入整句条目。"""
        src_parts = TextHelper.split_by_punctuation(src, split_by_space=True)
        dst_parts = TextHelper.split_by_punctuation(dst, split_by_space=True)
        if len(src_parts) != len(dst_parts):
            return [(src, dst)]
        return list(zip(src_parts, dst_parts))

    @staticmethod
    def build_glossary_entry(src: str, dst: str, info: str) -> dict[str, Any]:
        """术语条目统一从这里落盘，避免各个分支手写同一份结构。"""
        return {
            "src": src,
            "dst": dst,
            "info": info,
            "case_sensitive": False,
        }

    def normalize_glossary_entries(
        self,
        glossary_entries: list[dict[str, Any]],
        *,
        fake_name_injector: AnalysisFakeNameInjector | None = None,
    ) -> list[dict[str, Any]]:
        """把模型输出规整成固定术语结构，后面日志和提交都只认这一种。"""
        normalized: list[dict[str, Any]] = []
        for raw in glossary_entries:
            if not isinstance(raw, dict):
                continue

            src = str(raw.get("src", "")).strip()
            dst = str(raw.get("dst", "")).strip()
            if fake_name_injector is not None:
                restored_entry = fake_name_injector.restore_glossary_entry(src, dst)
                if restored_entry is None:
                    continue
                src, dst = restored_entry

            info = str(raw.get("info", "")).strip()
            if AnalysisFakeNameInjector.is_control_code_self_mapping(src, dst):
                normalized.append(self.build_glossary_entry(src, dst, info))
                continue

            for src_part, dst_part in self.split_glossary_entry_pairs(src, dst):
                normalized_src = src_part.strip()
                normalized_dst = dst_part.strip()
                if normalized_src == "" or normalized_dst == "":
                    continue
                if (
                    normalized_src == normalized_dst
                    and not AnalysisFakeNameInjector.is_control_code_self_mapping(
                        normalized_src,
                        normalized_dst,
                    )
                ):
                    continue
                normalized.append(
                    self.build_glossary_entry(normalized_src, normalized_dst, info)
                )

        return normalized

    def persist_progress_snapshot(self, *, save_state: bool) -> dict[str, Any]:
        """进度统一经由这个入口发事件；只有终态或边界阶段才回库校准并持久化。"""
        snapshot = self.build_runtime_progress_snapshot()

        if save_state:
            dm = DataManager.get()
            snapshot = self.reconcile_progress_snapshot(snapshot)
            if dm.is_loaded():
                snapshot = TaskProgressSnapshot.from_dict(
                    dm.update_analysis_progress_snapshot(snapshot.to_dict())
                )

        snapshot_dict = self.analysis.set_progress_snapshot(snapshot)
        self.update_console_progress(snapshot_dict)
        self.analysis.emit(Base.Event.ANALYSIS_PROGRESS, snapshot_dict)
        return snapshot_dict

    def log_analysis_start(self) -> None:
        """启动日志集中到这里，方便后面继续收口展示内容。"""
        if self.analysis.model is None or self.analysis.quality_snapshot is None:
            return

        LogManager.get().print("")
        LogManager.get().info(
            f"{Localizer.get().engine_api_name} - {self.analysis.model.get('name', '')}"
        )
        LogManager.get().info(
            f"{Localizer.get().api_url} - {self.analysis.model.get('api_url', '')}"
        )
        LogManager.get().info(
            f"{Localizer.get().engine_api_model} - {self.analysis.model.get('model_id', '')}"
        )
        LogManager.get().print("")

        if self.analysis.model.get("api_format") == Base.APIFormat.SAKURALLM:
            return

        prompt_builder = PromptBuilder(
            self.analysis.config,
            quality_snapshot=self.analysis.quality_snapshot,
        )
        LogManager.get().info(prompt_builder.build_glossary_analysis_main())
        LogManager.get().print("")

    def log_analysis_finish(self, final_status: str) -> None:
        """收尾日志只维护一处，成功失败停止三种终态共用。"""
        LogManager.get().print("")
        if final_status == "SUCCESS":
            LogManager.get().info(Localizer.get().engine_task_done)
        elif final_status == "STOPPED":
            LogManager.get().info(Localizer.get().engine_task_stop)
        else:
            LogManager.get().warning(Localizer.get().engine_task_fail)
        LogManager.get().print("")

    def print_chunk_log(
        self,
        *,
        start: float,
        pt: int,
        ct: int,
        srcs: list[str],
        glossary_entries: list[dict[str, Any]],
        response_think: str,
        response_result: str,
        status_text: str,
        log_func: Callable[..., None],
        style: str,
    ) -> None:
        """任务块日志统一格式，方便并发时定位是哪个批次出的问题。"""
        stats_info = (
            Localizer.get()
            .engine_task_success.replace("{TIME}", f"{(time.time() - start):.2f}")
            .replace("{LINES}", f"{len(srcs)}")
            .replace("{PT}", f"{pt}")
            .replace("{CT}", f"{ct}")
        )

        file_logs = [stats_info]
        console_logs = [stats_info]
        if status_text != "":
            file_logs.append(status_text)
            console_logs.append(status_text)

        normalized_think = ResponseCleaner.normalize_blank_lines(response_think).strip()
        normalized_result = response_result.strip()
        if normalized_think != "":
            think_log = (
                Localizer.get().engine_task_response_think + "\n" + normalized_think
            )
            file_logs.append(think_log)
            console_logs.append(think_log)
        if normalized_result != "":
            result_log = (
                Localizer.get().engine_task_response_result + "\n" + normalized_result
            )
            file_logs.append(result_log)
            if LogManager.get().is_expert_mode():
                console_logs.append(result_log)

        file_rows = self.generate_log_rows(
            srcs,
            glossary_entries,
            file_logs,
            console=False,
        )
        log_func("\n" + "\n\n".join(file_rows) + "\n", file=True, console=False)

        if Engine.get().get_running_task_count() > 32:
            summary_text = status_text or Localizer.get().task_success
            prefix = (
                f"[{style}][{Localizer.get().engine_task_simple_log_prefix}][/{style}]"
            )
            display_msg = "\n".join([prefix + " " + summary_text, stats_info])
            rich.get_console().print("\n" + display_msg + "\n")
            return

        table = self.generate_log_table(
            self.generate_log_rows(
                srcs,
                glossary_entries,
                console_logs,
                console=True,
            ),
            style,
        )
        rich.get_console().print(table)

    def generate_log_rows(
        self,
        srcs: list[str],
        glossary_entries: list[dict[str, Any]],
        extra: list[str],
        *,
        console: bool,
    ) -> list[str]:
        """先组装成纯文本行，文件日志和控制台日志就能共用一套内容。"""
        rows: list[str] = []
        for text in extra:
            stripped = text.strip()
            rows.append(markup.escape(stripped) if console else stripped)

        source_lines = [
            markup.escape(text.strip()) if console else text.strip()
            for text in srcs
            if text.strip() != ""
        ]
        if source_lines:
            rows.append(
                Localizer.get().analysis_task_source_texts
                + "\n"
                + "\n".join(source_lines)
            )

        term_lines = self.build_glossary_log_lines(glossary_entries, console=console)
        terms_body = (
            "\n".join(term_lines)
            if term_lines
            else Localizer.get().analysis_task_no_terms
        )
        rows.append(Localizer.get().analysis_task_extracted_terms + "\n" + terms_body)
        return rows

    def build_glossary_log_lines(
        self,
        glossary_entries: list[dict[str, Any]],
        *,
        console: bool,
    ) -> list[str]:
        """术语展示行也集中在这里，避免文件日志和表格日志内容不一致。"""
        rows: list[str] = []
        for entry in glossary_entries:
            src = str(entry.get("src", "")).strip()
            dst = str(entry.get("dst", "")).strip()
            info = str(entry.get("info", "")).strip()
            if src == "" or dst == "":
                continue

            text = f"{src} -> {dst}"
            if info != "":
                text += f" #{info}"
            rows.append(markup.escape(text) if console else text)
        return rows

    def generate_log_table(self, rows: list[str], style: str) -> Table:
        """rich 表格样式统一收口，后续改展示只动这一处。"""
        table = Table(
            box=box.ASCII2,
            expand=True,
            title=" ",
            caption=" ",
            highlight=True,
            show_lines=True,
            show_header=False,
            show_footer=False,
            collapse_padding=True,
            border_style=style,
        )
        table.add_column("", style="white", ratio=1, overflow="fold")
        for row in rows:
            table.add_row(row)
        return table
