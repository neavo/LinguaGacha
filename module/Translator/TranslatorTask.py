import re
import time
import itertools
import threading

import opencc
from rich import box
from rich import markup
from rich.table import Table
from rich.console import Console

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from base.EventManager import EventManager
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Fixer.CodeFixer import CodeFixer
from module.Fixer.KanaFixer import KanaFixer
from module.Fixer.EscapeFixer import EscapeFixer
from module.Fixer.NumberFixer import NumberFixer
from module.Fixer.HangeulFixer import HangeulFixer
from module.Fixer.PunctuationFixer import PunctuationFixer
from module.Response.ResponseChecker import ResponseChecker
from module.Response.ResponseDecoder import ResponseDecoder
from module.Localizer.Localizer import Localizer
from base.LogManager import LogManager
from module.CodeSaver import CodeSaver
from module.Normalizer import Normalizer
from module.Translator.TranslatorRequester import TranslatorRequester
from module.PromptBuilder import PromptBuilder

class TranslatorTask(Base):

    # 类变量
    CONSOLE = Console(highlight = True, tab_size = 4)
    OPENCCS2T = opencc.OpenCC("s2t")
    OPENCCT2S = opencc.OpenCC("t2s")

    # 自动术语表相关
    GLOSSARY_SAVE_TIME: float = time.time()
    GLOSSARY_SAVE_INTERVAL: int = 15

    # 正则规则
    REGEX_NAME = re.compile(r"^【(.*?)】\s*|\[(.*?)\]\s*", flags = re.IGNORECASE)

    # 类线程锁
    LOCK = threading.Lock()

    def __init__(self, config: dict, platform: dict, local_flag: bool, items: list[CacheItem], preceding_items: list[CacheItem]) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.preceding_items = preceding_items
        self.config = config
        self.platform = platform
        self.local_flag = local_flag
        self.code_saver = CodeSaver()
        self.prompt_builder = PromptBuilder(self.config)
        self.response_checker = ResponseChecker(self.config, items)

        # 生成原文文本字典与文本类型字典
        self.src_dict: dict[str, str] = {}
        self.item_dict: dict[str, CacheItem] = {}
        self.start_key_set: set[str] = set()
        for item in items:
            self.start_key_set.add(str(len(self.src_dict)))
            for line in item.split_sub_lines():
                self.src_dict[str(len(self.src_dict))] = line
                self.item_dict[str(len(self.item_dict))] = item

        # 正规化
        self.src_dict = self.normalize(self.src_dict)

        # 译前替换
        self.src_dict = self.replace_before_translation(self.src_dict)

        # 代码救星预处理
        self.src_dict, self.samples = self.code_saver.pre_process(self.src_dict, self.item_dict)

        # 注入姓名
        self.name_key_set = self.inject_name(self.src_dict, self.item_dict, self.start_key_set)

        # 初始化错误文本
        if not hasattr(TranslatorTask, "ERROR_TEXT_DICT"):
            TranslatorTask.ERROR_TEXT_DICT = {
                ResponseChecker.Error.UNKNOWN: Localizer.get().response_checker_unknown,
                ResponseChecker.Error.FAIL_DATA: Localizer.get().response_checker_fail_data,
                ResponseChecker.Error.FAIL_LINE_COUNT: Localizer.get().response_checker_fail_line_count,
                ResponseChecker.Error.LINE_ERROR_KANA: Localizer.get().response_checker_line_error_kana,
                ResponseChecker.Error.LINE_ERROR_HANGEUL: Localizer.get().response_checker_line_error_hangeul,
                ResponseChecker.Error.LINE_ERROR_FAKE_REPLY: Localizer.get().response_checker_line_error_fake_reply,
                ResponseChecker.Error.LINE_ERROR_EMPTY_LINE: Localizer.get().response_checker_line_error_empty_line,
                ResponseChecker.Error.LINE_ERROR_SIMILARITY: Localizer.get().response_checker_line_error_similarity,
                ResponseChecker.Error.LINE_ERROR_DEGRADATION: Localizer.get().response_checker_line_error_degradation,
            }

    # 启动任务
    def start(self, current_round: int) -> dict[str, str]:
        return self.request(self.src_dict, self.item_dict, self.preceding_items, self.samples, self.local_flag, current_round)

    # 请求
    def request(self, src_dict: dict[str, str], item_dict: dict[str, CacheItem], preceding_items: list[CacheItem], samples: list[str], local_flag: bool, current_round: int) -> dict[str, str]:
        # 任务开始的时间
        start_time = time.time()

        # 检测是否需要停止任务
        if Base.WORK_STATUS == Base.TaskStatus.STOPPING:
            return {}

        # 检查是否超时，超时则直接跳过当前任务，以避免死循环
        if time.time() - start_time >= self.config.get("request_timeout"):
            return {}

        # 生成请求提示词
        if self.platform.get("api_format") != Base.APIFormat.SAKURALLM:
            self.messages, console_log = self.prompt_builder.generate_prompt(src_dict, preceding_items, samples, local_flag)
        else:
            self.messages, console_log = self.prompt_builder.generate_prompt_sakura(src_dict)

        # 发起请求
        requester = TranslatorRequester(self.config, self.platform, current_round)
        skip, response_think, response_result, input_tokens, output_tokens = requester.request(self.messages)

        # 如果请求结果标记为 skip，即有错误发生，则跳过本次循环
        if skip == True:
            return {
                "row_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
            }

        # 提取回复内容
        dst_dict, glossary_list = ResponseDecoder().decode(response_result)

        # 确保 kv 都为字符串
        dst_dict = {str(k): str(v) for k, v in dst_dict.items()}

        # 检查回复内容
        check_result = self.response_checker.check(src_dict, dst_dict, item_dict, self.config.get("source_language"))

        # 当任务失败且是单条目任务时，更新重试次数
        if any(v != ResponseChecker.Error.NONE for v in check_result) != None and len(self.items) == 1:
            self.items[0].set_retry_count(self.items[0].get_retry_count() + 1)

        # 模型回复日志
        # 在这里将日志分成打印在控制台和写入文件的两份，按不同逻辑处理
        file_log = console_log.copy()
        if response_think != "":
            file_log.append(Localizer.get().translator_task_response_think + response_think)
            console_log.append(Localizer.get().translator_task_response_think + response_think)
        if response_result != "":
            file_log.append(Localizer.get().translator_task_response_result + response_result)
            console_log.append(Localizer.get().translator_task_response_result + response_result) if LogManager.is_debug() else None

        # 如果有任何正确的条目，则处理结果
        updated_count = 0
        if any(v == ResponseChecker.Error.NONE for v in check_result):
            # 提取姓名
            name_list: list[str] = self.extract_name(src_dict, dst_dict)

            # 自动修复
            dst_dict = self.auto_fix(src_dict, dst_dict, item_dict)

            # 代码救星后处理
            dst_dict = self.code_saver.post_process(src_dict, dst_dict)

            # 译后替换
            dst_dict = self.replace_after_translation(dst_dict)

            # 繁体输出
            dst_dict = self.convert_chinese_character_form(dst_dict)

            # 更新术语表
            with TranslatorTask.LOCK:
                TranslatorTask.GLOSSARY_SAVE_TIME = self.merge_glossary(glossary_list, TranslatorTask.GLOSSARY_SAVE_TIME)

            # 更新缓存数据
            dst_list = list(dst_dict.values())
            check_list = check_result.copy()
            for item, name in zip(self.items, name_list):
                dsts, _ = item.merge_sub_lines(dst_list, check_list)
                if isinstance(dsts, list):
                    if name is not None:
                        item.set_first_name_dst(name)

                    item.set_dst("\n".join(dsts))
                    item.set_status(Base.TranslationStatus.TRANSLATED)
                    updated_count = updated_count + 1

        # 打印任务结果
        self.print_log_table(
            check_result,
            start_time,
            input_tokens,
            output_tokens,
            [line.strip() for line in src_dict.values()],
            [line.strip() for line in dst_dict.values()],
            file_log,
            console_log
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

    # 正规化
    def normalize(self, data: dict[str, str]) -> dict[str, str]:
        for k in data.keys():
            data[k] = Normalizer.normalize(data.get(k, ""))

        return data

    # 合并术语表
    def merge_glossary(self, glossary_list: list[dict[str, str]], last_save_time: float) -> float:
        # 有效性检查
        if self.config.get("glossary_enable") == False:
            return last_save_time
        if self.config.get("auto_glossary_enable") == False:
            return last_save_time

        # 提取现有术语表的原文列表
        data: list[dict] = self.config.get("glossary_data")
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
            srcs: list[str] = TextHelper.split_by_punctuation(src, split_by_space = True)
            dsts: list[str] = TextHelper.split_by_punctuation(dst, split_by_space = True)
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
                    data.append({
                        "src": src,
                        "dst": dst,
                        "info": info,
                    })

        if changed == True and time.time() - last_save_time > __class__.GLOSSARY_SAVE_INTERVAL:
            # 更新配置文件
            config = self.load_config()
            config["glossary_data"] = data
            self.save_config(config)

            # 术语表刷新事件
            self.emit(Base.Event.GLOSSARY_REFRESH, {})

            return time.time()

        # 返回原始值
        return last_save_time

    # 译前替换
    def replace_before_translation(self, data: dict[str, str]) -> dict[str, str]:
        if self.config.get("pre_translation_replacement_enable") == False:
            return data

        replace_dict: list[dict] = self.config.get("pre_translation_replacement_data")
        for k in data:
            for v in replace_dict:
                if v.get("regex", False) != True:
                    data[k] = data.get(k).replace(v.get("src"), v.get("dst"))
                else:
                    data[k] = re.sub(rf"{v.get("src")}", rf"{v.get("dst")}", data.get(k))

        return data

    # 译后替换
    def replace_after_translation(self, data: dict[str, str]) -> dict[str, str]:
        if self.config.get("post_translation_replacement_enable") == False:
            return data

        replace_dict: list[dict] = self.config.get("post_translation_replacement_data")
        for k in data:
            for v in replace_dict:
                if v.get("regex", False) != True:
                    data[k] = data.get(k).replace(v.get("src"), v.get("dst"))
                else:
                    data[k] = re.sub(rf"{v.get("src")}", rf"{v.get("dst")}", data.get(k))

        return data

    # 中文字型转换
    def convert_chinese_character_form(self, data: dict[str, str]) -> dict[str, str]:
        if self.config.get("target_language") != BaseLanguage.Enum.ZH:
            return data

        if self.config.get("traditional_chinese_enable") == True:
            return {k: TranslatorTask.OPENCCS2T.convert(v) for k, v in data.items()}
        else:
            return {k: TranslatorTask.OPENCCT2S.convert(v) for k, v in data.items()}

    # 自动修复
    def auto_fix(self, src_dict: dict[str, str], dst_dict: dict[str, str], item_dict: dict[str, CacheItem]) -> dict[str, str]:
        source_language = self.config.get("source_language")
        target_language = self.config.get("target_language")

        for k in dst_dict:
            # 有效性检查
            if k not in src_dict:
                continue

            # 假名修复
            if source_language == BaseLanguage.Enum.JA:
                dst_dict[k] = KanaFixer.fix(dst_dict[k])
            # 谚文修复
            elif source_language == BaseLanguage.Enum.KO:
                dst_dict[k] = HangeulFixer.fix(dst_dict[k])

            # 代码修复
            dst_dict[k] = CodeFixer.fix(src_dict[k], dst_dict[k], item_dict.get(k).get_text_type())

            # 转义修复
            dst_dict[k] = EscapeFixer.fix(src_dict[k], dst_dict[k])

            # 数字修复
            dst_dict[k] = NumberFixer.fix(src_dict[k], dst_dict[k])

            # 标点符号修复
            dst_dict[k] = PunctuationFixer.fix(src_dict[k], dst_dict[k], source_language, target_language)

        return dst_dict

    # 注入姓名
    def inject_name(self, src_dict: dict[str, str], item_dict: dict[str, CacheItem], start_key_set: set[str]) -> dict[str, str]:
        name_key_set: set[str] = set()

        for k in src_dict:
            # 有效性检查
            if k not in start_key_set:
                continue

            # 注入姓名
            item = item_dict.get(k)
            name: str = item.get_first_name_src()
            if name is not None:
                src_dict[k] = f"【{name}】{src_dict.get(k, "")}"
                name_key_set.add(k)

        return name_key_set

    # 提取姓名
    def extract_name(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> dict[str, str]:
        name_dsts: list[str] = []

        for k in dst_dict:
            if k in self.start_key_set:
                result: re.Match[str] = __class__.REGEX_NAME.search(dst_dict.get(k, ""))
                if result is None:
                    name_dsts.append(None)
                elif k not in self.name_key_set:
                    name_dsts.append(None)
                elif result.group(1) is not None:
                    name_dsts.append(result.group(1))
                    dst_dict[k] = __class__.REGEX_NAME.sub("", dst_dict.get(k, ""))
                    src_dict[k] = __class__.REGEX_NAME.sub("", src_dict.get(k, ""))
                else:
                    name_dsts.append(result.group(2))
                    dst_dict[k] = __class__.REGEX_NAME.sub("", dst_dict.get(k, ""))
                    src_dict[k] = __class__.REGEX_NAME.sub("", src_dict.get(k, ""))

        return name_dsts

    # 打印日志表格
    def print_log_table(self, result: list[str], start: int, pt: int, ct: int, srcs: list[str], dsts: list[str], file_log: list[str], console_log: list[str]) -> None:
        # 拼接错误原因文本
        reason: str = ""
        if any(v != ResponseChecker.Error.NONE for v in result):
            reason = f"（{"、".join(
                {
                    TranslatorTask.ERROR_TEXT_DICT.get(v, "") for v in result
                    if v != ResponseChecker.Error.NONE
                }
            )}）"

        if all(v == ResponseChecker.Error.UNKNOWN for v in result):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} {reason}"
            log_func = self.error
        elif all(v == ResponseChecker.Error.FAIL_DATA for v in result):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} {reason}"
            log_func = self.error
        elif all(v == ResponseChecker.Error.FAIL_LINE_COUNT for v in result):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} {reason}"
            log_func = self.error
        elif all(v in ResponseChecker.Error.LINE_ERROR for v in result):
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail_all} {reason}"
            log_func = self.error
        elif any(v in ResponseChecker.Error.LINE_ERROR for v in result):
            style = "yellow"
            message = f"{Localizer.get().translator_response_check_fail_part} {reason}"
            log_func = self.warning
        else:
            style = "green"
            message = Localizer.get().translator_task_success.replace("{TIME}", f"{(time.time() - start):.2f}")
            message = message.replace("{LINES}", f"{len(srcs)}")
            message = message.replace("{PT}", f"{pt}")
            message = message.replace("{CT}", f"{ct}")
            log_func = self.info

        # 添加日志
        file_log.insert(0, message)
        console_log.insert(0, message)

        # 写入日志到文件
        file_rows = self.generate_log_rows(srcs, dsts, file_log, console = False)
        log_func("\n" + "\n\n".join(file_rows) + "\n", file = True, console = False)

        # 根据线程数判断是否需要打印表格
        task_num = sum(1 for t in threading.enumerate() if "translator" in t.name)
        if task_num > 32:
            log_func(
                Localizer.get().translator_too_many_task + "\n" + message + "\n",
                file = False,
                console = True,
            )
        else:
            console_rows = self.generate_log_rows(srcs, dsts, console_log, console = True)
            TranslatorTask.CONSOLE.print(self.generate_log_table(console_rows, style))

    # 生成日志行
    def generate_log_rows(self, srcs: list[str], dsts: list[str], extra: list[str], console: bool) -> tuple[list[str], str]:
        rows = []

        # 添加额外日志
        for v in extra:
            rows.append(markup.escape(v.strip()))

        # 原文译文对比
        pair = ""
        for src, dst in itertools.zip_longest(srcs, dsts, fillvalue = ""):
            if console == False:
                pair = pair + "\n" + f"{src} --> {dst}"
            else:
                pair = pair + "\n" + f"{markup.escape(src)} [bright_blue]-->[/] {markup.escape(dst)}"
        rows.append(pair.strip())

        return rows

    # 生成日志表格
    def generate_log_table(self, rows: list, style: str) -> Table:
        table = Table(
            box = box.ASCII2,
            expand = True,
            title = " ",
            caption = " ",
            highlight = True,
            show_lines = True,
            show_header = False,
            show_footer = False,
            collapse_padding = True,
            border_style = style,
        )
        table.add_column("", style = "white", ratio = 1, overflow = "fold")

        for row in rows:
            if isinstance(row, str):
                table.add_row(row)
            else:
                table.add_row(*row)

        return table