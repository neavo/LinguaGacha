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
from module.QualityRuleManager import QualityRuleManager
from module.Response.ResponseChecker import ResponseChecker
from module.Response.ResponseDecoder import ResponseDecoder
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor


class TranslatorTask(Base):
    # 自动术语表
    GLOSSARY_SAVE_LOCK: threading.Lock = threading.Lock()
    GLOSSARY_SAVE_TIME: float = time.time()
    GLOSSARY_SAVE_INTERVAL: int = 15

    def __init__(
        self,
        config: Config,
        model: dict,
        local_flag: bool,
        items: list[Item],
        precedings: list[Item],
        is_sub_task: bool = False,
        skip_glossary_merge: bool = False,
        skip_response_check: bool = False,
    ) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.precedings = precedings
        self.processors = [TextProcessor(config, item) for item in items]
        self.config = config
        self.model = model  # 新模型数据结构
        self.local_flag = local_flag
        self.is_sub_task = is_sub_task  # 是否为拆分后的子任务或重试任务
        self.split_count = 0
        self.token_threshold = 0
        self.retry_count = 0
        self.skip_glossary_merge = skip_glossary_merge

        self.skip_response_check = skip_response_check
        self.prompt_builder = PromptBuilder(self.config)

        # 跳过响应校验时不需要初始化 ResponseChecker
        self.response_checker = (
            None if skip_response_check else ResponseChecker(self.config, items)
        )

    # 启动任务
    def start(self) -> dict[str, int]:
        return self.request(
            self.items, self.processors, self.precedings, self.local_flag
        )

    # 请求
    def request(
        self,
        items: list[Item],
        processors: list[TextProcessor],
        precedings: list[Item],
        local_flag: bool,
    ) -> dict[str, int]:
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
        skip, response_think, response_result, input_tokens, output_tokens = (
            requester.request(self.messages)
        )

        # 如果请求结果标记为 skip，即有错误发生，则跳过本次循环
        if skip:
            if self.is_sub_task:
                msg = f"正在拆分重试，拆分次数: {self.split_count} | 当前阈值: {self.token_threshold}"
                if self.retry_count > 0:
                    msg += f" | 单条重试: {self.retry_count}"
                self.warning(f"{Localizer.get().log_task_fail}\n{msg}")
            return {
                "row_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
            }

        # 提取回复内容
        dsts, glossarys = ResponseDecoder().decode(response_result)

        # 检查回复内容（跳过响应校验时，直接将所有结果视为有效）
        if self.skip_response_check:
            checks = [ResponseChecker.Error.NONE] * len(dsts)
        else:
            # TODO - 当前逻辑下任务不会跨文件，所以一个任务的 TextType 都是一样的，有效，但是十分的 UGLY
            checks = self.response_checker.check(
                srcs, dsts, self.items[0].get_text_type()
            )

            # 当任务失败且是单条目任务时，更新重试次数
            if (
                any(v != ResponseChecker.Error.NONE for v in checks) is not None
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
            # 更新术语表（单条翻译场景跳过此步骤）
            if not self.skip_glossary_merge:
                with __class__.GLOSSARY_SAVE_LOCK:
                    __class__.GLOSSARY_SAVE_TIME = self.merge_glossary(
                        glossarys, __class__.GLOSSARY_SAVE_TIME
                    )

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
            }
        else:
            return {
                "row_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
            }

    # 合并术语表
    def merge_glossary(
        self, glossary_list: list[dict[str, str]], last_save_time: float
    ) -> float:
        # 有效性检查
        if not QualityRuleManager.get().get_glossary_enable():
            return last_save_time
        if not self.config.auto_glossary_enable:
            return last_save_time

        # 提取现有术语表的原文列表
        data: list[dict] = QualityRuleManager.get().get_glossary()
        keys = {item.get("src", "") for item in data}

        # 合并去重后的术语表
        changed: bool = False
        for item in glossary_list:
            src = item.get("src", "").strip()
            dst = item.get("dst", "").strip()
            info = item.get("info", "").strip()

            # 有效性校验
            if not any(x in info.lower() for x in ("男", "女", "male", "female")):
                continue

            # 将原文和译文都按标点切分
            srcs: list[str] = TextHelper.split_by_punctuation(src, split_by_space=True)
            dsts: list[str] = TextHelper.split_by_punctuation(dst, split_by_space=True)
            if len(srcs) != len(dsts):
                srcs = [src]
                dsts = [dst]

            for src, dst in zip(srcs, dsts):
                src = src.strip()
                dst = dst.strip()
                if src == dst or src == "" or dst == "":
                    continue
                if not any(key == src for key in keys):
                    changed = True
                    keys.add(src)
                    data.append(
                        {
                            "src": src,
                            "dst": dst,
                            "info": info,
                        }
                    )

        if changed:
            # 判断是否满足保存间隔
            save_to_db = time.time() - last_save_time > __class__.GLOSSARY_SAVE_INTERVAL

            # 更新术语表（更新缓存，根据 save_to_db 决定是否写库）
            QualityRuleManager.get().set_glossary(data, save=save_to_db)

            if save_to_db:
                # 术语表刷新事件
                self.emit(Base.Event.GLOSSARY_REFRESH, {})
                return time.time()

        # 返回原始值
        return last_save_time

    # 打印日志表格
    def print_log_table(
        self,
        checks: list[str],
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
            reason = f"（{
                '、'.join(
                    {
                        __class__.get_error_text(v)
                        for v in checks
                        if v != ResponseChecker.Error.NONE
                    }
                )
            }）"

        # 检查是否为拆分或重试的任务
        sub_info = ""
        if self.is_sub_task:
            sub_info = f"正在拆分重试，拆分次数: {self.split_count} | 当前阈值: {self.token_threshold}"
            if self.retry_count > 0:
                sub_info += f" | 单条重试: {self.retry_count}"

        if all(v == ResponseChecker.Error.UNKNOWN for v in checks):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} {reason}"
            log_func = self.error
        elif all(v == ResponseChecker.Error.FAIL_DATA for v in checks):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} {reason}"
            log_func = self.error
        elif all(v == ResponseChecker.Error.FAIL_LINE_COUNT for v in checks):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} {reason}"
            log_func = self.error
        elif all(v in ResponseChecker.LINE_ERROR for v in checks):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail_all} {reason}"
            log_func = self.error
        elif any(v in ResponseChecker.LINE_ERROR for v in checks):
            style = "yellow"
            message = f"{Localizer.get().translator_response_check_fail_part} {reason}"
            log_func = self.warning
        else:
            style = "green"
            message = Localizer.get().engine_task_success.replace(
                "{TIME}", f"{(time.time() - start):.2f}"
            )
            message = message.replace("{LINES}", f"{len(srcs)}")
            message = message.replace("{PT}", f"{pt}")
            message = message.replace("{CT}", f"{ct}")
            log_func = self.info

        # 添加日志
        file_log.insert(0, message)
        if sub_info:
            file_log.insert(1, sub_info)
        console_log.insert(0, message)
        if sub_info:
            console_log.insert(1, sub_info)

        # 写入日志到文件
        file_rows = self.generate_log_rows(srcs, dsts, file_log, console=False)
        log_func("\n" + "\n\n".join(file_rows) + "\n", file=True, console=False)

        # 根据线程数判断是否需要打印表格
        if Engine.get().get_running_task_count() > 32:
            display_msg = message
            if sub_info:
                display_msg += f"\n{sub_info}"
            rich.get_console().print(
                Localizer.get().engine_task_too_many + "\n" + display_msg + "\n"
            )
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
            return Localizer.get().response_checker_line_error_kana
        elif error == ResponseChecker.Error.LINE_ERROR_HANGEUL:
            return Localizer.get().response_checker_line_error_hangeul
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
                    skip_glossary_merge=True,
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
