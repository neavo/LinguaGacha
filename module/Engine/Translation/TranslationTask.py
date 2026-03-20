import itertools
import threading
import time
from functools import lru_cache
from typing import Callable

from rich import box
from rich import markup
from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskRequestExecutor import TaskRequestExecutor
from module.Engine.TaskRequestExecutor import TaskRequestResult
from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestErrors import StreamDegradationError
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.Response.ResponseChecker import ResponseChecker
from module.TextProcessor import TextProcessor


class TranslationTask(Base):
    def __init__(
        self,
        config: Config,
        model: dict,
        items: list[Item],
        precedings: list[Item],
        is_sub_task: bool = False,
        skip_response_check: bool = False,
        quality_snapshot: QualityRuleSnapshot | None = None,
    ) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.precedings = precedings
        self.quality_snapshot: QualityRuleSnapshot | None = quality_snapshot
        self.processors = [
            TextProcessor(config, item, quality_snapshot=quality_snapshot)
            for item in items
        ]
        self.config = config
        self.model = model  # 新模型数据结构
        self.is_sub_task = is_sub_task  # 是否为拆分后的子任务或重试任务
        self.split_count = 0
        self.token_threshold = 0
        self.retry_count = 0

        self.skip_response_check = skip_response_check

        self.prompt_builder = PromptBuilder(
            self.config,
            quality_snapshot=quality_snapshot,
        )

        # 跳过响应校验时不需要初始化 ResponseChecker
        self.response_checker = (
            None
            if skip_response_check
            else ResponseChecker(
                self.config,
                items,
                quality_snapshot=quality_snapshot,
            )
        )

    @staticmethod
    def build_empty_result() -> dict[str, int]:
        """统一返回空结果，避免不同分支各写一套零值字典。"""
        return {
            "row_count": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    @staticmethod
    def build_result(
        *,
        row_count: int,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> dict[str, int]:
        """统一构造任务结果，保证字段口径始终一致。"""
        return {
            "row_count": row_count,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    @staticmethod
    def build_recoverable_request_response(
        request_response: TaskRequestResult,
    ) -> TaskRequestResult:
        """将可恢复异常归一成空响应，后续仍复用同一套落盘和校验流程。"""
        return TaskRequestResult(
            start_time=request_response.start_time,
            exception=request_response.exception,
            response_think="",
            response_result="",
            input_tokens=0,
            output_tokens=0,
            normalized_think="",
            cleaned_response_result="",
            has_why_block=False,
            decoded_translations=tuple(),
            decoded_glossary_entries=tuple(),
        )

    def build_task_status_info(self) -> str:
        """统一拼装拆分/重试状态，避免日志和异常分支各自拼字符串。"""
        return (
            Localizer.get()
            .translation_task_status_info.replace("{SPLIT}", str(self.split_count))
            .replace("{RETRY}", str(self.retry_count))
            .replace("{THRESHOLD}", str(self.token_threshold))
        )

    def start(self) -> dict:
        try:
            return self.request(
                self.items,
                self.processors,
                self.precedings,
            )
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            return self.build_empty_result()

    def prepare_request_data(
        self,
        items: list[Item],
        processors: list[TextProcessor],
        precedings: list[Item],
    ) -> dict:
        srcs: list[str] = []
        samples: list[str] = []
        for processor in processors:
            processor.pre_process()
            srcs.extend(processor.srcs)
            samples.extend(processor.samples)

        if len(srcs) == 0:
            for item, processor in zip(items, processors):
                item.set_dst(item.get_src())
                item.set_status(Base.ProjectStatus.PROCESSED)

            return {
                "done": True,
                "result": self.build_result(row_count=len(items)),
            }

        api_format = self.model.get("api_format", "OpenAI")
        if api_format != Base.APIFormat.SAKURALLM:
            messages, console_log = self.prompt_builder.generate_prompt(
                srcs, samples, precedings
            )
        else:
            messages, console_log = self.prompt_builder.generate_prompt_sakura(srcs)

        return {
            "done": False,
            "srcs": srcs,
            "messages": messages,
            "console_log": console_log,
        }

    def apply_response_data(
        self,
        prepared: dict,
        request_response: TaskRequestResult,
    ) -> dict:
        srcs: list[str] = prepared.get("srcs", [])
        console_log: list[str] = prepared.get("console_log", [])
        stream_degraded = bool(prepared.get("stream_degraded", False))
        request_timeout = bool(prepared.get("request_timeout", False))
        response_think = request_response.normalized_think
        response_result = request_response.cleaned_response_result

        if stream_degraded or request_timeout:
            dsts = [""] * len(srcs)
        else:
            dsts = list(request_response.decoded_translations)

        if request_timeout:
            checks = [ResponseChecker.Error.FAIL_TIMEOUT] * len(srcs)
        elif stream_degraded:
            if self.response_checker is None:
                checks = [ResponseChecker.Error.FAIL_DEGRADATION] * len(srcs)
            else:
                checks = self.response_checker.check(
                    srcs,
                    dsts,
                    self.items[0].get_text_type(),
                    stream_degraded=True,
                )
            if len(self.items) == 1:
                self.items[0].set_retry_count(self.items[0].get_retry_count() + 1)
        elif self.skip_response_check or self.response_checker is None:
            checks = [ResponseChecker.Error.NONE] * len(dsts)
        else:
            checks = self.response_checker.check(
                srcs,
                dsts,
                self.items[0].get_text_type(),
                stream_degraded=False,
            )
            if (
                any(v != ResponseChecker.Error.NONE for v in checks)
                and len(self.items) == 1
            ):
                self.items[0].set_retry_count(self.items[0].get_retry_count() + 1)

        file_log = console_log.copy()
        response_think_log = response_think.strip("\n")
        response_result_log = response_result.strip("\n")
        if response_think_log != "":
            file_log.append(
                Localizer.get().engine_task_response_think + "\n" + response_think_log
            )
            console_log.append(
                Localizer.get().engine_task_response_think + "\n" + response_think_log
            )
        if response_result_log != "":
            file_log.append(
                Localizer.get().engine_task_response_result + "\n" + response_result_log
            )
            if LogManager.get().is_expert_mode():
                console_log.append(
                    Localizer.get().engine_task_response_result
                    + "\n"
                    + response_result_log
                )

        updated_count = 0
        if any(v == ResponseChecker.Error.NONE for v in checks):
            dsts_cp = dsts.copy()
            checks_cp = checks.copy()
            if len(srcs) > len(dsts_cp):
                dsts_cp.extend([""] * (len(srcs) - len(dsts_cp)))
            if len(srcs) > len(checks_cp):
                checks_cp.extend(
                    [ResponseChecker.Error.NONE] * (len(srcs) - len(checks_cp))
                )
            for item, processor in zip(self.items, self.processors):
                length = len(processor.srcs)
                dsts_ex = [dsts_cp.pop(0) for _ in range(length)]
                checks_ex = [checks_cp.pop(0) for _ in range(length)]

                if all(v == ResponseChecker.Error.NONE for v in checks_ex):
                    name, dst = processor.post_process(dsts_ex)
                    item.set_dst(dst)
                    item.set_first_name_dst(name) if name is not None else None
                    item.set_status(Base.ProjectStatus.PROCESSED)
                    updated_count = updated_count + 1

        self.print_log_table(
            checks,
            request_response.start_time,
            request_response.input_tokens,
            request_response.output_tokens,
            [line.strip() for line in srcs],
            [line.strip() for line in dsts],
            file_log,
            console_log,
        )

        if updated_count > 0:
            return self.build_result(
                row_count=updated_count,
                input_tokens=request_response.input_tokens,
                output_tokens=request_response.output_tokens,
            )
        return self.build_empty_result()

    def request(
        self,
        items: list[Item],
        processors: list[TextProcessor],
        precedings: list[Item],
    ) -> dict:
        prepared = self.prepare_request_data(items, processors, precedings)

        if prepared.get("done"):
            result = prepared.get("result")
            if isinstance(result, dict):
                return result
            return self.build_empty_result()

        messages = prepared.get("messages")
        if not isinstance(messages, list):
            return self.build_empty_result()

        def stop_checker() -> bool:
            return Engine.get().get_status() == Base.TaskStatus.STOPPING

        request_response = TaskRequestExecutor.execute(
            config=self.config,
            model=self.model,
            messages=messages,
            requester_factory=TaskRequester,
            stop_checker=stop_checker,
        )

        if request_response.exception:
            if isinstance(request_response.exception, RequestCancelledError):
                return self.build_empty_result()

            if stop_checker():
                return self.build_empty_result()

            msg = self.build_task_status_info()

            if isinstance(request_response.exception, RequestHardTimeoutError):
                prepared["request_timeout"] = True
                request_response = self.build_recoverable_request_response(
                    request_response
                )
            elif isinstance(request_response.exception, StreamDegradationError):
                prepared["stream_degraded"] = True
                request_response = self.build_recoverable_request_response(
                    request_response
                )
            else:
                LogManager.get().error(
                    f"{Localizer.get().task_failed}\n{msg}",
                    request_response.exception,
                )
                return self.build_empty_result()

        return self.apply_response_data(prepared, request_response)

    # 打印日志表格
    def print_log_table(
        self,
        checks: list[ResponseChecker.Error],
        start: float,
        pt: int,
        ct: int,
        srcs: list[str],
        dsts: list[str],
        file_log: list[str],
        console_log: list[str],
    ) -> None:
        # 拼接错误原因文本
        reason: str = ""
        if any(v != ResponseChecker.Error.NONE for v in checks):
            reason = "、".join(
                {
                    __class__.get_error_text(v)
                    for v in checks
                    if v != ResponseChecker.Error.NONE
                }
            )

        # 检查是否为子任务，构建状态信息
        sub_info = ""
        is_force_accept = False
        if self.is_sub_task:
            sub_info = self.build_task_status_info()

            # 检查是否为强制接受（重试达到上限）
            if len(srcs) == 1 and self.retry_count >= 3:
                is_force_accept = True
                sub_info += Localizer.get().translation_task_force_accept_info.replace(
                    "{REASON}", reason if reason else Localizer.get().log_unknown_reason
                )

        # 统计信息
        stats_info = (
            Localizer.get()
            .engine_task_success.replace("{TIME}", f"{(time.time() - start):.2f}")
            .replace("{LINES}", f"{len(srcs)}")
            .replace("{PT}", f"{pt}")
            .replace("{CT}", f"{ct}")
        )

        # 确定日志样式和消息
        if is_force_accept:
            style = "#9ACD32"
            message = Localizer.get().translation_response_check_fail_force
            log_func = LogManager.get().warning
        elif all(v == ResponseChecker.Error.UNKNOWN for v in checks):
            style = "red"
            message = Localizer.get().translation_response_check_fail.replace(
                "{REASON}", reason
            )
            log_func = LogManager.get().error
        elif all(v == ResponseChecker.Error.FAIL_TIMEOUT for v in checks):
            style = "red"
            message = Localizer.get().translation_response_check_fail_all.replace(
                "{REASON}", Localizer.get().response_checker_fail_timeout
            )
            log_func = LogManager.get().error
        elif all(v == ResponseChecker.Error.FAIL_DEGRADATION for v in checks):
            style = "red"
            message = Localizer.get().translation_response_check_fail_all.replace(
                "{REASON}", reason
            )
            log_func = LogManager.get().error
        elif all(v == ResponseChecker.Error.FAIL_DATA for v in checks):
            style = "red"
            message = Localizer.get().translation_response_check_fail.replace(
                "{REASON}", reason
            )
            log_func = LogManager.get().error
        elif all(v == ResponseChecker.Error.FAIL_LINE_COUNT for v in checks):
            style = "red"
            message = Localizer.get().translation_response_check_fail.replace(
                "{REASON}", reason
            )
            log_func = LogManager.get().error
        elif all(v in ResponseChecker.LINE_ERROR for v in checks):
            style = "red"
            message = Localizer.get().translation_response_check_fail_all.replace(
                "{REASON}", reason
            )
            log_func = LogManager.get().error
        elif any(v in ResponseChecker.LINE_ERROR for v in checks):
            style = "yellow"
            message = Localizer.get().translation_response_check_fail_part.replace(
                "{REASON}", reason
            )
            log_func = LogManager.get().warning
        else:
            style = "green"
            message = stats_info
            log_func = LogManager.get().info

        # 添加日志 (按顺序：统计信息 -> 状态消息 -> 子任务信息)
        header_logs = [stats_info]
        if message != stats_info:
            header_logs.append(message)
        if sub_info:
            header_logs.append(sub_info)

        for i, log in enumerate(header_logs):
            file_log.insert(i, log)
            console_log.insert(i, log)

        # 写入日志到文件
        file_rows = self.generate_log_rows(srcs, dsts, file_log, console=False)
        log_func("\n" + "\n\n".join(file_rows) + "\n", file=True, console=False)

        # 根据线程数判断是否需要打印表格
        if Engine.get().get_running_task_count() > 32:
            # 简略模式下的状态文本
            status_text = (
                message if message != stats_info else Localizer.get().task_success
            )

            # 构建三行简略日志
            # 第一行：染色前缀 + 状态
            prefix = (
                f"[{style}][{Localizer.get().engine_task_simple_log_prefix}][/{style}]"
            )
            line1 = f"{prefix} {status_text}"

            # 第二行：统计信息
            line2 = stats_info

            # 组合日志
            display_msg = line1 + "\n" + line2
            if sub_info:
                # 第三行：子任务信息
                display_msg += "\n" + sub_info

            LogManager.get().print_rich("\n" + display_msg + "\n")
        else:
            LogManager.get().print_rich(
                self.generate_log_table(
                    self.generate_log_rows(srcs, dsts, console_log, console=True),
                    style,
                )
            )

    # 生成日志行
    def generate_log_rows(
        self, srcs: list[str], dsts: list[str], extra: list[str], console: bool
    ) -> list[str]:
        rows = []

        # 添加额外日志
        for v in extra:
            rows.append(markup.escape(v.strip()))

        # 原文译文对比
        pair = ""
        for src, dst in itertools.zip_longest(srcs, dsts, fillvalue=""):
            if not console:
                pair = pair + "\n" + f"{src} --> {dst}"
            else:
                pair = (
                    pair
                    + "\n"
                    + f"{markup.escape(src)} [bright_blue]-->[/] {markup.escape(dst)}"
                )
        rows.append(pair.strip())

        return rows

    # 生成日志表格
    def generate_log_table(self, rows: list, style: str) -> Table:
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

    @classmethod
    @lru_cache(maxsize=None)
    def get_error_text(cls, error: ResponseChecker.Error) -> str:
        if error == ResponseChecker.Error.FAIL_DATA:
            return Localizer.get().response_checker_fail_data
        elif error == ResponseChecker.Error.FAIL_LINE_COUNT:
            return Localizer.get().response_checker_fail_line_count
        elif error == ResponseChecker.Error.FAIL_TIMEOUT:
            return Localizer.get().response_checker_fail_timeout
        elif error == ResponseChecker.Error.LINE_ERROR_KANA:
            return Localizer.get().issue_kana_residue
        elif error == ResponseChecker.Error.LINE_ERROR_HANGEUL:
            return Localizer.get().issue_hangeul_residue
        elif error == ResponseChecker.Error.LINE_ERROR_EMPTY_LINE:
            return Localizer.get().response_checker_line_error_empty_line
        elif error == ResponseChecker.Error.LINE_ERROR_SIMILARITY:
            return Localizer.get().response_checker_line_error_similarity
        elif error == ResponseChecker.Error.FAIL_DEGRADATION:
            return Localizer.get().response_checker_fail_degradation
        else:
            return ""

    @staticmethod
    def translate_single(
        item: Item, config: Config, callback: Callable[[Item, bool], None]
    ) -> None:
        """
        单条翻译的简化入口，复用 TranslationTask 的完整翻译流程。

        注意：此方法为低频调用场景设计（用户手动触发单条重新翻译），
        使用后台线程执行同步请求路径；SDK client 由 TaskRequester 按参数组合全局缓存复用。

        Args:
            item: 待翻译的 Item 对象
            config: 翻译配置
            callback: 翻译完成后的回调函数，签名为 (item, success) -> None
        """

        def task() -> None:
            success = False
            try:
                # 获取激活的模型配置
                model = config.get_active_model()
                if not model:
                    return

                # 创建翻译任务（跳过术语表合并和响应校验）
                translation_task = TranslationTask(
                    config=config,
                    model=model,
                    items=[item],
                    precedings=[],
                    skip_response_check=True,
                )

                # 执行翻译（同步请求路径）
                result = translation_task.start()
                success = bool(result.get("row_count", 0) > 0)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                success = False
            finally:
                # 回调通知
                if callback:
                    callback(item, success)

        # 启动后台线程
        thread = threading.Thread(target=task, name=f"{Engine.TASK_PREFIX}SINGLE")
        thread.start()
