import itertools
import re
import threading
import time
from functools import lru_cache
from typing import Callable

import rich
from rich import box
from rich import markup
from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.Data.QualityRuleSnapshot import QualityRuleSnapshot
from module.Response.ResponseChecker import ResponseChecker
from module.Response.ResponseDecoder import ResponseDecoder
from module.TextProcessor import TextProcessor


class TranslatorTask(Base):
    def __init__(
        self,
        config: Config,
        model: dict,
        local_flag: bool,
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
        self.local_flag = local_flag
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

    # 启动任务
    def start(self) -> dict:
        try:
            return self.request(
                self.items, self.processors, self.precedings, self.local_flag
            )
        except Exception as e:
            # 最终兜底，确保任务不会由于未捕获异常而彻底丢失回调
            self.error(f"{Localizer.get().task_failed}", e)
            return {
                "row_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "glossaries": [],
            }

    # 请求
    def request(
        self,
        items: list[Item],
        processors: list[TextProcessor],
        precedings: list[Item],
        local_flag: bool,
    ) -> dict:
        # 任务开始的时间
        start_time = time.time()

        # 文本预处理
        srcs: list[str] = []
        samples: list[str] = []
        for processor in processors:
            processor.pre_process()

            # 获取预处理后的数据
            srcs.extend(processor.srcs)
            samples.extend(processor.samples)

        # 如果没有任何有效原文文本，则直接完成当前任务
        if len(srcs) == 0:
            for item, processor in zip(items, processors):
                item.set_dst(item.get_src())
                item.set_status(Base.ProjectStatus.PROCESSED)

            return {
                "row_count": len(items),
                "input_tokens": 0,
                "output_tokens": 0,
                "glossaries": [],
            }

        # 生成请求提示词
        api_format = self.model.get("api_format", "OpenAI")
        if api_format != Base.APIFormat.SAKURALLM:
            self.messages, console_log = self.prompt_builder.generate_prompt(
                srcs, samples, precedings, local_flag
            )
        else:
            self.messages, console_log = self.prompt_builder.generate_prompt_sakura(
                srcs
            )

        # 发起请求
        requester = TaskRequester(self.config, self.model)
        exception, response_think, response_result, input_tokens, output_tokens = (
            requester.request(self.messages)
        )

        # 如果请求发生异常，则记录日志并跳过本次循环
        if exception:
            msg = (
                Localizer.get()
                .translator_task_status_info.replace("{SPLIT}", str(self.split_count))
                .replace("{RETRY}", str(self.retry_count))
                .replace("{THRESHOLD}", str(self.token_threshold))
            )
            self.error(f"{Localizer.get().task_failed}\n{msg}", exception)
            return {
                "row_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "glossaries": [],
            }

        # 提取回复内容
        dsts, glossarys = ResponseDecoder().decode(response_result)

        # 检查回复内容（跳过响应校验时，直接将所有结果视为有效）
        if self.skip_response_check or self.response_checker is None:
            checks: list[ResponseChecker.Error] = [ResponseChecker.Error.NONE] * len(
                dsts
            )
        else:
            checks = self.response_checker.check(
                srcs, dsts, self.items[0].get_text_type()
            )

            # 当任务失败且是单条目任务时，更新重试次数
            if (
                any(v != ResponseChecker.Error.NONE for v in checks)
                and len(self.items) == 1
            ):
                self.items[0].set_retry_count(self.items[0].get_retry_count() + 1)

        # 模型回复日志
        # 在这里将日志分成打印在控制台和写入文件的两份，按不同逻辑处理
        file_log = console_log.copy()
        if response_think != "":
            file_log.append(
                Localizer.get().engine_response_think + "\n" + response_think
            )
            console_log.append(
                Localizer.get().engine_response_think + "\n" + response_think
            )
        if response_result != "":
            file_log.append(
                Localizer.get().engine_response_result + "\n" + response_result
            )
            console_log.append(
                Localizer.get().engine_response_result + "\n" + response_result
            ) if LogManager.get().is_expert_mode() else None

        # 如果有任何正确的条目，则处理结果
        updated_count = 0
        if any(v == ResponseChecker.Error.NONE for v in checks):
            # 更新缓存数据
            dsts_cp = dsts.copy()
            checks_cp = checks.copy()
            if len(srcs) > len(dsts_cp):
                dsts_cp.extend([""] * (len(srcs) - len(dsts_cp)))
            if len(srcs) > len(checks_cp):
                checks_cp.extend(
                    [ResponseChecker.Error.NONE] * (len(srcs) - len(checks_cp))
                )
            for item, processor in zip(items, processors):
                length = len(processor.srcs)
                dsts_ex = [dsts_cp.pop(0) for _ in range(length)]
                checks_ex = [checks_cp.pop(0) for _ in range(length)]

                if all(v == ResponseChecker.Error.NONE for v in checks_ex):
                    name, dst = processor.post_process(dsts_ex)
                    item.set_dst(dst)
                    item.set_first_name_dst(name) if name is not None else None
                    item.set_status(Base.ProjectStatus.PROCESSED)
                    updated_count = updated_count + 1

        # 打印任务结果
        self.print_log_table(
            checks,
            start_time,
            input_tokens,
            output_tokens,
            [line.strip() for line in srcs],
            [line.strip() for line in dsts],
            file_log,
            console_log,
        )

        # 返回任务结果
        if updated_count > 0:
            return {
                "row_count": updated_count,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "glossaries": glossarys,
            }
        else:
            return {
                "row_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "glossaries": [],
            }

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
            sub_info = (
                Localizer.get()
                .translator_task_status_info.replace("{SPLIT}", str(self.split_count))
                .replace("{RETRY}", str(self.retry_count))
                .replace("{THRESHOLD}", str(self.token_threshold))
            )

            # 检查是否为强制接受（重试达到上限）
            if len(srcs) == 1 and self.retry_count >= 3:
                is_force_accept = True
                sub_info += Localizer.get().translator_task_force_accept_info.replace(
                    "{REASON}", reason if reason else "未知原因"
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
            message = Localizer.get().translator_response_check_fail_force
            log_func = self.warning
        elif all(v == ResponseChecker.Error.UNKNOWN for v in checks):
            style = "red"
            message = Localizer.get().translator_response_check_fail.replace(
                "{REASON}", reason
            )
            log_func = self.error
        elif all(v == ResponseChecker.Error.FAIL_DATA for v in checks):
            style = "red"
            message = Localizer.get().translator_response_check_fail.replace(
                "{REASON}", reason
            )
            log_func = self.error
        elif all(v == ResponseChecker.Error.FAIL_LINE_COUNT for v in checks):
            style = "red"
            message = Localizer.get().translator_response_check_fail.replace(
                "{REASON}", reason
            )
            log_func = self.error
        elif all(v in ResponseChecker.LINE_ERROR for v in checks):
            style = "red"
            message = Localizer.get().translator_response_check_fail_all.replace(
                "{REASON}", reason
            )
            log_func = self.error
        elif any(v in ResponseChecker.LINE_ERROR for v in checks):
            style = "yellow"
            message = Localizer.get().translator_response_check_fail_part.replace(
                "{REASON}", reason
            )
            log_func = self.warning
        else:
            style = "green"
            message = stats_info
            log_func = self.info

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
                f"[{style}][{Localizer.get().translator_simple_log_prefix}][/{style}]"
            )
            line1 = f"{prefix} {status_text}"

            # 第二行：统计信息
            line2 = stats_info

            # 组合日志
            display_msg = line1 + "\n" + line2
            if sub_info:
                # 第三行：子任务信息
                display_msg += "\n" + sub_info

            rich.get_console().print("\n" + display_msg + "\n")
        else:
            rich.get_console().print(
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
        elif error == ResponseChecker.Error.LINE_ERROR_KANA:
            return Localizer.get().issue_kana_residue
        elif error == ResponseChecker.Error.LINE_ERROR_HANGEUL:
            return Localizer.get().issue_hangeul_residue
        elif error == ResponseChecker.Error.LINE_ERROR_EMPTY_LINE:
            return Localizer.get().response_checker_line_error_empty_line
        elif error == ResponseChecker.Error.LINE_ERROR_SIMILARITY:
            return Localizer.get().response_checker_line_error_similarity
        elif error == ResponseChecker.Error.LINE_ERROR_DEGRADATION:
            return Localizer.get().response_checker_line_error_degradation
        else:
            return ""

    @staticmethod
    def translate_single(
        item: Item, config: Config, callback: Callable[[Item, bool], None]
    ) -> None:
        """
        单条翻译的简化入口，复用 TranslatorTask 的完整翻译流程。

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

                # 判断是否为本地模型
                api_url = model.get("api_url", "")
                local_flag = (
                    re.search(
                        r"^http[s]*://localhost|^http[s]*://\d+\.\d+\.\d+\.\d+",
                        api_url,
                        flags=re.IGNORECASE,
                    )
                    is not None
                )

                # 创建翻译任务（跳过术语表合并和响应校验）
                translator_task = TranslatorTask(
                    config=config,
                    model=model,
                    local_flag=local_flag,
                    items=[item],
                    precedings=[],
                    skip_response_check=True,
                )

                # 执行翻译
                result = translator_task.start()
                success = result.get("row_count", 0) > 0
            except Exception:
                success = False
            finally:
                # 回调通知
                if callback:
                    callback(item, success)

        # 启动后台线程
        thread = threading.Thread(target=task, name=f"{Engine.TASK_PREFIX}SINGLE")
        thread.start()
