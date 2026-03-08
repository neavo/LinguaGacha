from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait
import time
from typing import TYPE_CHECKING
from typing import Any

import rich
from rich import box
from rich import markup
from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.ChunkGenerator import ChunkGenerator
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskRequesterErrors import RequestCancelledError
from module.Engine.TaskRequesterErrors import RequestHardTimeoutError
from module.Engine.TaskRequesterErrors import StreamDegradationError
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.Response.ResponseCleaner import ResponseCleaner
from module.Response.ResponseDecoder import ResponseDecoder

from module.Engine.Analyzer.AnalysisModels import AnalysisChunkResult
from module.Engine.Analyzer.AnalysisModels import AnalysisFilePlan

if TYPE_CHECKING:
    from module.Engine.Analyzer.Analyzer import Analyzer


# 流水线类专门承接“分析怎么做”的细节，让主控制器只处理事件和任务生命周期。
class AnalysisPipeline:
    def __init__(self, analyzer: Analyzer) -> None:
        self.analyzer = analyzer

    # 计划阶段只负责把工程条目稳定地整理成“按文件续跑、按 chunk 并发”的结构。
    def build_analysis_file_plans(self, config: Config) -> list[AnalysisFilePlan]:
        del config

        grouped_items: dict[str, list[Item]] = {}
        for item in DataManager.get().get_all_items():
            if self.is_skipped_analysis_status(item.get_status()):
                continue

            text = self.build_analysis_source_text(item)
            if text == "":
                continue

            analysis_item = Item.from_dict(item.to_dict())
            analysis_item.set_src(text)
            analysis_item.set_dst("")
            analysis_item.set_status(Base.ProjectStatus.NONE)
            grouped_items.setdefault(analysis_item.get_file_path(), []).append(
                analysis_item
            )

        input_token_threshold = self.get_input_token_threshold()
        plans: list[AnalysisFilePlan] = []
        for file_path, items in grouped_items.items():
            chunks, _precedings = ChunkGenerator.generate_item_chunks(
                items=items,
                input_token_threshold=input_token_threshold,
                preceding_lines_threshold=0,
            )
            if not chunks:
                continue

            plans.append(
                AnalysisFilePlan(
                    file_path=file_path,
                    chunks=tuple(tuple(chunk) for chunk in chunks),
                )
            )

        return plans

    def is_skipped_analysis_status(self, status: Base.ProjectStatus) -> bool:
        """统一维护分析链路的跳过状态，避免多处手写同一组状态。"""
        return status in (
            Base.ProjectStatus.EXCLUDED,
            Base.ProjectStatus.RULE_SKIPPED,
            Base.ProjectStatus.LANGUAGE_SKIPPED,
            Base.ProjectStatus.DUPLICATED,
        )

    # 这里提前统一过滤规则，后面所有分析步骤都只处理真正可能产出术语的条目。
    def should_include_item(self, item: Item) -> bool:
        if self.is_skipped_analysis_status(item.get_status()):
            return False

        return self.build_analysis_source_text(item) != ""

    # 术语分析同时依赖姓名和正文，所以这里统一拼出唯一的分析输入口径。
    def build_analysis_source_text(self, item: Item) -> str:
        src = item.get_src().strip()

        names_raw = item.get_name_src()
        names: list[str] = []
        if isinstance(names_raw, str):
            name = names_raw.strip()
            if name != "":
                names.append(name)
        elif isinstance(names_raw, list):
            for value in names_raw:
                if not isinstance(value, str):
                    continue

                name = value.strip()
                if name == "":
                    continue
                if name in names:
                    continue
                names.append(name)

        parts: list[str] = []
        if names:
            parts.append("\n".join(names))
        if src != "":
            parts.append(src)
        return "\n".join(parts).strip()

    # token 上限统一从模型阈值推导，保证切块策略和当前模型能力一致。
    def get_input_token_threshold(self) -> int:
        if self.analyzer.model is None:
            return 512

        threshold = self.analyzer.model.get("threshold", {})
        return max(16, int(threshold.get("input_token_limit", 512)))

    # extras 统一由文件计划和状态表推导，避免新建、续跑、重置三套口径各算各的。
    def build_extras_from_state(
        self,
        *,
        file_plans: list[AnalysisFilePlan],
        state: dict[str, Base.ProjectStatus],
        previous_extras: dict[str, Any],
        continue_mode: bool,
    ) -> dict[str, Any]:
        processed_line = 0
        error_line = 0
        total_line = 0

        for plan in file_plans:
            item_count = plan.item_count
            total_line += item_count

            status = state.get(plan.file_path)
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += item_count
            elif status == Base.ProjectStatus.ERROR:
                error_line += item_count

        if continue_mode:
            elapsed_time = float(previous_extras.get("time", 0))
            start_time = time.time() - elapsed_time
            total_tokens = int(previous_extras.get("total_tokens", 0))
            total_input_tokens = int(previous_extras.get("total_input_tokens", 0))
            total_output_tokens = int(previous_extras.get("total_output_tokens", 0))
            added_glossary = int(previous_extras.get("added_glossary", 0))
        else:
            elapsed_time = 0.0
            start_time = time.time()
            total_tokens = 0
            total_input_tokens = 0
            total_output_tokens = 0
            added_glossary = 0

        return {
            "start_time": start_time,
            "time": elapsed_time,
            "total_line": total_line,
            "line": processed_line + error_line,
            "processed_line": processed_line,
            "error_line": error_line,
            "total_tokens": total_tokens,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "added_glossary": added_glossary,
        }

    def rollback_file_progress(
        self,
        *,
        file_success_lines: int,
        file_error_lines: int,
        line_total: int | None = None,
    ) -> None:
        """文件失败或中断时回滚当前文件的临时统计，避免半文件进度残留。"""
        self.analyzer.extras["processed_line"] = max(
            0, self.analyzer.extras.get("processed_line", 0) - file_success_lines
        )
        self.analyzer.extras["error_line"] = max(
            0, self.analyzer.extras.get("error_line", 0) - file_error_lines
        )

        if line_total is not None:
            self.analyzer.extras["error_line"] = (
                self.analyzer.extras.get("error_line", 0) + line_total
            )

    # 文件级执行把“成功/失败/停止”的回滚规则关在一起，避免状态统计四处分叉。
    def run_file_plan(
        self, plan: AnalysisFilePlan, *, max_workers: int
    ) -> Base.ProjectStatus | None:
        file_success_lines = 0
        file_error_lines = 0
        chunk_total = plan.chunk_count
        line_total = plan.item_count
        chunk_index = 0
        pending: dict[Future[AnalysisChunkResult], int] = {}

        if chunk_total == 0:
            return Base.ProjectStatus.PROCESSED

        with ThreadPoolExecutor(
            max_workers=max(1, min(max_workers, chunk_total))
        ) as executor:
            while (
                chunk_index < chunk_total
                and len(pending) < max_workers
                and not self.analyzer.should_stop()
            ):
                future = executor.submit(
                    self.analyzer.run_chunk, list(plan.chunks[chunk_index])
                )
                pending[future] = chunk_index
                chunk_index += 1

            while pending:
                done, _ = wait(
                    list(pending.keys()),
                    timeout=0.1,
                    return_when=FIRST_COMPLETED,
                )
                if not done:
                    continue

                for future in done:
                    completed_chunk_index = pending.pop(future, None)
                    result = future.result()
                    chunk_line_count = 0
                    if completed_chunk_index is not None:
                        chunk_line_count = len(plan.chunks[completed_chunk_index])

                    self.analyzer.extras["total_input_tokens"] = (
                        self.analyzer.extras.get("total_input_tokens", 0)
                        + result.input_tokens
                    )
                    self.analyzer.extras["total_output_tokens"] = (
                        self.analyzer.extras.get("total_output_tokens", 0)
                        + result.output_tokens
                    )
                    self.analyzer.extras["total_tokens"] = self.analyzer.extras.get(
                        "total_input_tokens", 0
                    ) + self.analyzer.extras.get("total_output_tokens", 0)

                    if result.success:
                        changed_count = self.analyzer.merge_glossary_entries(
                            list(result.glossary_entries)
                        )
                        self.analyzer.extras["processed_line"] = (
                            self.analyzer.extras.get("processed_line", 0)
                            + chunk_line_count
                        )
                        self.analyzer.extras["added_glossary"] = (
                            self.analyzer.extras.get("added_glossary", 0)
                            + changed_count
                        )
                        file_success_lines += chunk_line_count
                    elif not result.stopped:
                        self.analyzer.extras["error_line"] = (
                            self.analyzer.extras.get("error_line", 0) + chunk_line_count
                        )
                        file_error_lines += chunk_line_count

                    self.persist_progress_snapshot(save_state=False)

                    if chunk_index >= chunk_total:
                        continue
                    if self.analyzer.should_stop():
                        continue

                    next_future = executor.submit(
                        self.analyzer.run_chunk, list(plan.chunks[chunk_index])
                    )
                    pending[next_future] = chunk_index
                    chunk_index += 1

        if self.analyzer.should_stop():
            self.rollback_file_progress(
                file_success_lines=file_success_lines,
                file_error_lines=file_error_lines,
            )
            self.persist_progress_snapshot(save_state=False)
            return None

        if file_error_lines > 0:
            self.rollback_file_progress(
                file_success_lines=file_success_lines,
                file_error_lines=file_error_lines,
                line_total=line_total,
            )
            self.persist_progress_snapshot(save_state=False)
            return Base.ProjectStatus.ERROR

        return Base.ProjectStatus.PROCESSED

    # 分片执行统一处理限流器交互，这样请求代码不用关心 acquire/wait/release 细节。
    def run_chunk(self, items: list[Item]) -> AnalysisChunkResult:
        if self.analyzer.should_stop():
            return AnalysisChunkResult(success=False, stopped=True)

        limiter = self.analyzer.task_limiter
        if limiter is None:
            return self.execute_chunk_request(items)

        if not limiter.acquire(stop_checker=self.analyzer.should_stop):
            return AnalysisChunkResult(success=False, stopped=True)

        try:
            if not limiter.wait(stop_checker=self.analyzer.should_stop):
                return AnalysisChunkResult(success=False, stopped=True)
            return self.execute_chunk_request(items)
        finally:
            limiter.release()

    # 这里把一次模型请求的完整输入输出收口，方便后面单独替换提示词或响应清洗规则。
    def execute_chunk_request(self, items: list[Item]) -> AnalysisChunkResult:
        if self.analyzer.model is None or self.analyzer.quality_snapshot is None:
            return AnalysisChunkResult(success=False, stopped=False)

        srcs = [item.get_src() for item in items if item.get_src().strip() != ""]
        if not srcs:
            return AnalysisChunkResult(success=True, stopped=False)

        start_time = time.time()
        prompt_builder = PromptBuilder(
            self.analyzer.config,
            quality_snapshot=self.analyzer.quality_snapshot,
        )
        messages, _console_log = prompt_builder.generate_glossary_prompt(srcs)

        requester = TaskRequester(self.analyzer.config, self.analyzer.model)
        (
            exception,
            response_think,
            response_result,
            input_tokens,
            output_tokens,
        ) = requester.request(messages, stop_checker=self.analyzer.should_stop)

        if isinstance(exception, RequestCancelledError):
            return AnalysisChunkResult(success=False, stopped=True)
        if self.analyzer.should_stop():
            return AnalysisChunkResult(success=False, stopped=True)

        if isinstance(exception, (RequestHardTimeoutError, StreamDegradationError)):
            if isinstance(exception, RequestHardTimeoutError):
                status_text = Localizer.get().response_checker_fail_timeout
            else:
                status_text = Localizer.get().response_checker_fail_degradation

            self.print_chunk_log(
                start=start_time,
                pt=input_tokens,
                ct=output_tokens,
                srcs=srcs,
                glossary_entries=[],
                response_think=response_think,
                response_result=response_result,
                status_text=status_text,
                log_func=LogManager.get().warning,
                style="yellow",
            )
            return AnalysisChunkResult(success=False, stopped=False)

        if exception is not None:
            LogManager.get().warning(Localizer.get().task_failed, exception)
            return AnalysisChunkResult(success=False, stopped=False)

        response_result, why_text = ResponseCleaner.extract_why_from_response(
            response_result
        )
        normalized_think = ResponseCleaner.normalize_blank_lines(response_think).strip()
        normalized_think = ResponseCleaner.merge_text_blocks(normalized_think, why_text)

        dsts, glossary_entries = ResponseDecoder().decode(response_result)
        del dsts
        normalized_entries = self.normalize_glossary_entries(glossary_entries)
        self.print_chunk_log(
            start=start_time,
            pt=input_tokens,
            ct=output_tokens,
            srcs=srcs,
            glossary_entries=normalized_entries,
            response_think=normalized_think,
            response_result=response_result,
            status_text="",
            log_func=LogManager.get().info,
            style="green",
        )

        return AnalysisChunkResult(
            success=True,
            stopped=False,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            glossary_entries=tuple(normalized_entries),
        )

    # 这里把模型输出归一成统一术语结构，后面的合并器和日志才能只处理一种数据形状。
    def normalize_glossary_entries(
        self, glossary_entries: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for raw in glossary_entries:
            if not isinstance(raw, dict):
                continue

            src = str(raw.get("src", "")).strip()
            dst = str(raw.get("dst", "")).strip()
            info = str(raw.get("info", "")).strip()
            if src == "" or dst == "" or src == dst:
                continue

            normalized.append(
                {
                    "src": src,
                    "dst": dst,
                    "info": info,
                    "case_sensitive": False,
                }
            )

        return normalized

    # 运行期快照和工程落库都走这里，保证术语增量只从一个入口写回。
    def merge_glossary_entries(self, glossary_entries: list[dict[str, Any]]) -> int:
        if not glossary_entries or self.analyzer.quality_snapshot is None:
            return 0

        changed_entries = self.analyzer.quality_snapshot.merge_glossary_entries(
            glossary_entries
        )
        dm = DataManager.get()
        merged, report = dm.merge_glossary_incoming(
            glossary_entries,
            merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
            save=False,
        )
        if merged is not None:
            dm.update_batch(rules={DataManager.RuleType.GLOSSARY: merged})

        if report.added or report.filled:
            return report.added + report.filled
        return len(changed_entries)

    # 文件级续跑语义由这里统一计算，避免主流程里到处重复判断状态表。
    def get_remaining_chunk_count(
        self,
        file_plans: list[AnalysisFilePlan],
        state: dict[str, Base.ProjectStatus],
    ) -> int:
        remaining = 0
        for plan in file_plans:
            if state.get(plan.file_path) in (
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.ERROR,
            ):
                continue
            remaining += plan.chunk_count
        return remaining

    # 进度快照统一在这里写库和发事件，保证 UI 与持久化看到的是同一份统计。
    def persist_progress_snapshot(self, *, save_state: bool) -> dict[str, Any]:
        self.analyzer.extras["line"] = self.analyzer.extras.get(
            "processed_line", 0
        ) + self.analyzer.extras.get("error_line", 0)
        start_time = float(self.analyzer.extras.get("start_time", time.time()))
        self.analyzer.extras["time"] = max(0.0, time.time() - start_time)

        snapshot = dict(self.analyzer.extras)
        dm = DataManager.get()
        if dm.is_loaded():
            dm.set_analysis_extras(snapshot)
            if save_state:
                dm.set_analysis_state(self.analyzer.analysis_state)

        self.analyzer.emit(Base.Event.ANALYSIS_PROGRESS, snapshot)
        return snapshot

    # 启动日志单独集中，后面调整展示内容时不用再翻任务主流程。
    def log_analysis_start(self) -> None:
        if self.analyzer.model is None or self.analyzer.quality_snapshot is None:
            return

        LogManager.get().print("")
        LogManager.get().info(
            f"{Localizer.get().engine_api_name} - {self.analyzer.model.get('name', '')}"
        )
        LogManager.get().info(
            f"{Localizer.get().api_url} - {self.analyzer.model.get('api_url', '')}"
        )
        LogManager.get().info(
            f"{Localizer.get().engine_api_model} - {self.analyzer.model.get('model_id', '')}"
        )
        LogManager.get().print("")

        if self.analyzer.model.get("api_format") == Base.APIFormat.SAKURALLM:
            return

        prompt_builder = PromptBuilder(
            self.analyzer.config,
            quality_snapshot=self.analyzer.quality_snapshot,
        )
        LogManager.get().info(prompt_builder.build_glossary_analysis_main())
        LogManager.get().print("")

    # 收尾日志也集中到这里，这样成功、失败、停止三种文案只维护一处。
    def log_analysis_finish(self, final_status: str) -> None:
        elapsed = float(self.analyzer.extras.get("time", 0))
        lines = int(self.analyzer.extras.get("line", 0))
        pt = int(self.analyzer.extras.get("total_input_tokens", 0))
        ct = int(self.analyzer.extras.get("total_output_tokens", 0))
        stats_info = (
            Localizer.get()
            .engine_task_success.replace("{TIME}", f"{elapsed:.2f}")
            .replace("{LINES}", str(lines))
            .replace("{PT}", str(pt))
            .replace("{CT}", str(ct))
        )
        terms_info = Localizer.get().analysis_task_terms_added.replace(
            "{COUNT}", str(int(self.analyzer.extras.get("added_glossary", 0)))
        )

        LogManager.get().print("")
        LogManager.get().info(stats_info)
        LogManager.get().info(terms_info)
        if final_status == "SUCCESS":
            LogManager.get().info(Localizer.get().engine_task_done)
        elif final_status == "STOPPED":
            LogManager.get().info(Localizer.get().engine_task_stop)
        else:
            LogManager.get().warning(Localizer.get().engine_task_fail)
        LogManager.get().print("")

    # 单块日志保持统一格式，方便并发多时快速定位是哪段文本产出了哪些术语。
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
        stats_info = (
            Localizer.get()
            .engine_task_success.replace("{TIME}", f"{(time.time() - start):.2f}")
            .replace("{LINES}", f"{len(srcs)}")
            .replace("{PT}", f"{pt}")
            .replace("{CT}", f"{ct}")
        )
        terms_info = Localizer.get().analysis_task_terms_added.replace(
            "{COUNT}", str(len(glossary_entries))
        )

        file_logs = [stats_info, terms_info]
        console_logs = [stats_info, terms_info]
        if status_text != "":
            file_logs.append(status_text)
            console_logs.append(status_text)

        normalized_think = ResponseCleaner.normalize_blank_lines(response_think).strip()
        normalized_result = response_result.strip()
        if normalized_think != "":
            think_log = Localizer.get().engine_response_think + "\n" + normalized_think
            file_logs.append(think_log)
            console_logs.append(think_log)
        if normalized_result != "":
            result_log = (
                Localizer.get().engine_response_result + "\n" + normalized_result
            )
            file_logs.append(result_log)
            if LogManager.get().is_expert_mode():
                console_logs.append(result_log)

        file_rows = self.generate_log_rows(
            srcs, glossary_entries, file_logs, console=False
        )
        log_func("\n" + "\n\n".join(file_rows) + "\n", file=True, console=False)

        if Engine.get().get_running_task_count() > 32:
            if status_text != "":
                summary_text = status_text
            else:
                summary_text = Localizer.get().task_success
            prefix = (
                f"[{style}][{Localizer.get().translator_simple_log_prefix}][/{style}]"
            )
            display_msg = "\n".join(
                [prefix + " " + summary_text, stats_info, terms_info]
            )
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

    # 日志行先组装成纯文本数组，文件日志和控制台日志才能共享同一套内容逻辑。
    def generate_log_rows(
        self,
        srcs: list[str],
        glossary_entries: list[dict[str, Any]],
        extra: list[str],
        *,
        console: bool,
    ) -> list[str]:
        rows: list[str] = []
        for text in extra:
            stripped = text.strip()
            if console:
                rows.append(markup.escape(stripped))
            else:
                rows.append(stripped)

        source_lines = [
            markup.escape(text.strip()) if console else text.strip()
            for text in srcs
            if text.strip() != ""
        ]
        if source_lines:
            source_block = (
                Localizer.get().analysis_task_source_texts
                + "\n"
                + "\n".join(source_lines)
            )
            rows.append(source_block)

        term_lines = self.build_glossary_log_lines(glossary_entries, console=console)
        if term_lines:
            terms_body = "\n".join(term_lines)
        else:
            terms_body = Localizer.get().analysis_task_no_terms
        rows.append(Localizer.get().analysis_task_extracted_terms + "\n" + terms_body)
        return rows

    # 术语行单独组装后，文件输出和 rich 表格都能保证展示内容完全一致。
    def build_glossary_log_lines(
        self,
        glossary_entries: list[dict[str, Any]],
        *,
        console: bool,
    ) -> list[str]:
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

            if console:
                rows.append(markup.escape(text))
            else:
                rows.append(text)
        return rows

    # 表格样式集中在这里，后续要和翻译日志继续对齐时只改这一处。
    def generate_log_table(self, rows: list[str], style: str) -> Table:
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
