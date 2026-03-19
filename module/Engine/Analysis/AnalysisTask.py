from __future__ import annotations

import time
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Any

import rich
from rich import box
from rich import markup
from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from module.Engine.Analysis.AnalysisFakeNameInjector import AnalysisFakeNameInjector
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.Engine import Engine
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestExecutor import TaskRequestExecutor
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.Response.ResponseCleaner import ResponseCleaner
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor

if TYPE_CHECKING:
    from module.Engine.Analysis.Analysis import Analysis


class AnalysisTask:
    """分析单任务执行器统一负责请求、解码和日志输出。"""

    def __init__(self, analysis: Analysis, context: AnalysisTaskContext) -> None:
        self.analysis = analysis
        self.context = context

    def start(self) -> AnalysisTaskResult:
        """单个分析任务的全部执行语义只保留在这里，避免 hook 混入请求细节。"""
        if self.analysis.model is None or self.analysis.quality_snapshot is None:
            return AnalysisTaskResult(
                context=self.context,
                success=False,
                stopped=False,
            )

        prompt_srcs = self.build_prompt_source_texts(self.context.items)
        if not prompt_srcs:
            return AnalysisTaskResult(
                context=self.context,
                success=True,
                stopped=False,
            )

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
            return AnalysisTaskResult(
                context=self.context,
                success=False,
                stopped=True,
            )
        if self.analysis.should_stop():
            return AnalysisTaskResult(
                context=self.context,
                success=False,
                stopped=True,
            )

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
                context=self.context,
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
                context=self.context,
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
                context=self.context,
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
            context=self.context,
            success=True,
            stopped=False,
            input_tokens=request_response.input_tokens,
            output_tokens=request_response.output_tokens,
            glossary_entries=tuple(normalized_entries),
        )

    @staticmethod
    def log_run_start(analysis: Analysis) -> None:
        """任务启动日志统一放在 Task 类，方便控制器与 hook 共享同一口径。"""
        if analysis.model is None or analysis.quality_snapshot is None:
            return

        LogManager.get().print("")
        LogManager.get().info(
            f"{Localizer.get().engine_api_name} - {analysis.model.get('name', '')}"
        )
        LogManager.get().info(
            f"{Localizer.get().api_url} - {analysis.model.get('api_url', '')}"
        )
        LogManager.get().info(
            f"{Localizer.get().engine_api_model} - {analysis.model.get('model_id', '')}"
        )
        LogManager.get().print("")

        if analysis.model.get("api_format") == Base.APIFormat.SAKURALLM:
            return

        prompt_builder = PromptBuilder(
            analysis.config,
            quality_snapshot=analysis.quality_snapshot,
        )
        LogManager.get().info(prompt_builder.build_glossary_analysis_main())
        LogManager.get().print("")

    @staticmethod
    def log_run_finish(final_status: str) -> None:
        """成功、停止、失败三种分析终态日志统一收口在这里。"""
        LogManager.get().print("")
        if final_status == "SUCCESS":
            LogManager.get().info(Localizer.get().engine_task_done)
        elif final_status == "STOPPED":
            LogManager.get().info(Localizer.get().engine_task_stop)
        else:
            LogManager.get().warning(Localizer.get().engine_task_fail)
        LogManager.get().print("")

    def build_prompt_source_texts(
        self,
        items: tuple[AnalysisItemContext, ...],
    ) -> list[str]:
        """分析请求前统一按翻译口径注入说话人前缀，但不改上下文快照。"""
        prompt_srcs: list[str] = []
        for item in items:
            src_text = item.src_text.strip()
            if src_text == "":
                continue
            prompt_srcs.extend(
                TextProcessor.inject_name([src_text], item.first_name_src)
            )
        return prompt_srcs

    def build_request_source_texts(
        self,
        srcs: list[str],
    ) -> tuple[list[str], AnalysisFakeNameInjector]:
        """伪名注入只在模型请求前生效，避免污染 checkpoint 和日志口径。"""
        fake_name_injector = AnalysisFakeNameInjector(srcs)
        return fake_name_injector.inject_texts(srcs), fake_name_injector

    def split_glossary_entry_pairs(self, src: str, dst: str) -> list[tuple[str, str]]:
        """复合术语统一按共享分词拆开，减少候选池中的整句脏数据。"""
        src_parts = TextHelper.split_by_punctuation(src, split_by_space=True)
        dst_parts = TextHelper.split_by_punctuation(dst, split_by_space=True)
        if len(src_parts) != len(dst_parts):
            return [(src, dst)]
        return list(zip(src_parts, dst_parts))

    @staticmethod
    def build_glossary_entry(src: str, dst: str, info: str) -> dict[str, Any]:
        """候选术语结构统一在这里生成，避免多个分支手写同一份字典。"""
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
        """模型术语输出统一规整成固定结构，后续提交和日志都只认这一种。"""
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
        """任务块日志统一格式，方便并发时快速定位哪个批次出了问题。"""
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
        """先组装成纯文本行，让文件日志和控制台日志能共用同一套内容。"""
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
        """术语展示文本统一收口，避免文件日志和控制台展示内容跑偏。"""
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

    @staticmethod
    def generate_log_table(rows: list[str], style: str) -> Table:
        """rich 表格样式统一由 Task 维护，方便以后整体改展示。"""
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
