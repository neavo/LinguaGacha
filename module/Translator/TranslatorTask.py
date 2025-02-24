import time
import itertools
import threading

import opencc
import rapidjson as json
from rich import box
from rich.table import Table
from rich.console import Console

from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheManager import CacheManager
from module.Response.ResponseChecker import ResponseChecker
from module.Response.ResponseDecoder import ResponseDecoder
from module.Localizer.Localizer import Localizer
from module.LogHelper import LogHelper
from module.CodeSaver import CodeSaver
from module.Normalizer import Normalizer
from module.Translator.TranslatorRequester import TranslatorRequester
from module.PromptBuilder import PromptBuilder
from module.PunctuationHelper import PunctuationHelper

class TranslatorTask(Base):

    # 类变量
    OPENCC = opencc.OpenCC("s2t")
    CONSOLE = Console(highlight = True, tab_size = 4)

    # 类线程锁
    LOCK = threading.Lock()

    def __init__(self, config: dict, platform: dict, items: list[CacheItem], cache_manager: CacheManager, prompt_builder: PromptBuilder) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.config = config
        self.platform = platform
        self.code_saver = CodeSaver()
        self.cache_manager = cache_manager
        self.prompt_builder = prompt_builder
        self.response_checker = ResponseChecker(self.config, items)

        # 生成原文文本字典
        self.src_dict = {}
        self.type_dict = {}
        for item in items:
            for sub_line in item.split_sub_lines():
                self.src_dict[str(len(self.src_dict))] = sub_line
                self.type_dict[str(len(self.src_dict))] = item.get_file_type()

        # 正规化
        self.src_dict = self.normalize(self.src_dict)

        # 译前替换
        self.src_dict = self.replace_before_translation(self.src_dict)

        # 代码救星预处理
        self.src_dict = self.code_saver.pre_process(self.src_dict, self.type_dict)

    # 启动任务
    def start(self, current_round: int) -> dict:
        return self.request(self.src_dict, self.type_dict, current_round)

    # 请求
    def request(self, src_dict: dict[str, str], type_dict: dict[str, str], current_round: int) -> dict:
        # 任务开始的时间
        start_time = time.time()

        # 检测是否需要停止任务
        if Base.WORK_STATUS == Base.Status.STOPING:
            return {}

        # 检查是否超时，超时则直接跳过当前任务，以避免死循环
        if time.time() - start_time >= self.config.get("request_timeout"):
            return {}

        # 生成请求提示词
        if self.platform.get("api_format") != Base.APIFormat.SAKURALLM:
            self.messages, extra_console_log = self.generate_prompt(self.src_dict)
        else:
            self.messages, extra_console_log = self.generate_prompt_sakura(self.src_dict)

        # 发起请求
        requester = TranslatorRequester(self.config, self.platform, current_round)
        skip, response_think, response_result, prompt_tokens, completion_tokens = requester.request(self.messages)

        # 如果请求结果标记为 skip，即有错误发生，则跳过本次循环
        if skip == True:
            return {
                "check_flag": ResponseChecker.Error.UNKNOWN,
                "row_count": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
            }

        # 提取回复内容
        if self.config.get("auto_glossary_enable") == False:
            dst_dict, glossary_auto, response_decode_log = ResponseDecoder().decode(response_result)
        else:
            dst_dict, glossary_auto, response_decode_log = ResponseDecoder().decode_mix(response_result)

        # 确保 kv 都为字符串
        dst_dict = {str(k): str(v) for k, v in dst_dict.items()}

        # 检查回复内容
        check_flag, check_result = self.response_checker.check(src_dict, dst_dict)

        # 当任务失败且是单条目任务时，更新重试次数
        if check_flag != None and len(self.items) == 1:
            self.items[0].set_retry_count(self.items[0].get_retry_count() + 1)

        # 模型回复日志
        # 在这里将日志分成打印在控制台和写入文件的两份，按不同逻辑处理
        extra_file_log = extra_console_log.copy()
        if response_think != "":
            extra_file_log.append(Localizer.get().translator_task_response_think + response_think)
            extra_console_log.append(Localizer.get().translator_task_response_think + response_think)
        if response_result != "":
            extra_file_log.append(Localizer.get().translator_task_response_result + response_result)
            extra_console_log.append(Localizer.get().translator_task_response_result + response_result) if LogHelper.is_debug() else None
        if response_decode_log != "":
            extra_file_log.append(response_decode_log)
            extra_console_log.append(response_decode_log) if LogHelper.is_debug() else None

        # 检查译文
        if check_flag == None or check_flag == ResponseChecker.Error.UNTRANSLATED:
            # 标点修复
            dst_dict: dict[str, str] = self.punctuation_fix(src_dict, dst_dict)

            # 代码救星后处理
            dst_dict = self.code_saver.post_process(dst_dict, type_dict)

            # 译后替换
            dst_dict = self.replace_after_translation(dst_dict)

            # 繁体输出
            dst_dict = self.convert_to_traditional_chinese(dst_dict)

            # 更新术语表
            with TranslatorTask.LOCK:
                self.merge_glossary(glossary_auto)

            # 更新缓存数据
            updated_count = 0
            dst_sub_lines = list(dst_dict.values())
            for item in self.items:
                dst, dst_sub_lines, check_result = item.merge_sub_lines(dst_sub_lines, check_result)
                if dst != None:
                    updated_count = updated_count + 1
                    item.set_dst(dst)
                    item.set_status(Base.TranslationStatus.TRANSLATED)

        # 打印任务结果
        self.print_log_table(
            check_flag,
            start_time,
            prompt_tokens,
            completion_tokens,
            [line.strip() for line in src_dict.values()],
            [line.strip() for line in dst_dict.values()],
            extra_file_log,
            extra_console_log
        )

        # 返回任务结果
        if check_flag == None or check_flag == ResponseChecker.Error.UNTRANSLATED:
            return {
                "check_flag": None,
                "row_count": updated_count,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            }
        else:
            return {
                "check_flag": check_flag,
                "row_count": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
            }

    # 正规化
    def normalize(self, data: dict[str, str]) -> dict:
        for k in data.keys():
            data[k] = Normalizer.normalize(data.get(k, ""))

        return data

    # 合并术语表
    def merge_glossary(self, glossary_auto: list[dict]) -> list[dict]:
        data: list[dict] = self.config.get("glossary_data")
        if self.config.get("glossary_enable") == False or self.config.get("auto_glossary_enable") == False:
            return data

        # 提取现有术语表的原文列表
        keys = {item.get("src", "") for item in data}

        # 合并去重后的术语表
        for item in glossary_auto:
            src = item.get("src", "").strip()
            dst = item.get("dst", "").strip()
            info = item.get("info", "").strip()

            # 有效性校验
            if not any(x in info.lower() for x in ("男", "女", "male", "female")):
                continue

            # 将原文和译文都按标点切分
            srcs = TextHelper.split_by_punctuation(src, split_by_space = False)
            dsts = TextHelper.split_by_punctuation(dst, split_by_space = False)
            if len(srcs) != len(dsts):
                if src == dst:
                    continue
                if src == "" or dst == "":
                    continue
                if not any(key in src or src in key for key in keys):
                    keys.add(src)
                    data.append({
                        "src": src,
                        "dst": dst,
                        "info": info,
                    })
            else:
                for src, dst in zip(srcs, dsts):
                    src = src.strip()
                    dst = dst.strip()
                    if src == dst:
                        continue
                    if src == "" or dst == "":
                        continue
                    if not any(key in src or src in key for key in keys):
                        keys.add(src)
                        data.append({
                            "src": src,
                            "dst": dst,
                            "info": info,
                        })

        return data

    # 译前替换
    def replace_before_translation(self, data: dict[str, str]) -> dict:
        if self.config.get("pre_translation_replacement_enable") == False:
            return data

        replace_dict: list[dict] = self.config.get("pre_translation_replacement_data")
        for k in data:
            for v in replace_dict:
                if v.get("src", "") in data[k]:
                    data[k] = data[k].replace(v.get("src", ""), v.get("dst", ""))

        return data

    # 译后替换
    def replace_after_translation(self, data: dict[str, str]) -> dict:
        if self.config.get("post_translation_replacement_enable") == False:
            return data

        replace_dict: list[dict] = self.config.get("post_translation_replacement_data")
        for k in data:
            for v in replace_dict:
                if v.get("src", "") in data[k]:
                    data[k] = data[k].replace(v.get("src", ""), v.get("dst", ""))

        return data

    # 繁体输出
    def convert_to_traditional_chinese(self, data: dict[str, str]) -> dict:
        if self.config.get("traditional_chinese_enable") == False:
            return data

        for k in data:
            data[k] = TranslatorTask.OPENCC.convert(data.get(k))

        return data

    # 标点修复
    def punctuation_fix(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> dict:
        for k in dst_dict:
            if k in src_dict:
                dst_dict[k] = PunctuationHelper.check_and_replace(src_dict[k], dst_dict[k])

        return dst_dict

    # 生成提示词
    def generate_prompt(self, src_dict: dict) -> tuple[list[dict], list[str]]:
        # 初始化
        messages = []
        extra_log = []

        # 基础提示词
        main = self.prompt_builder.build_main(renpy = not self.cache_manager.any_rpgmaker())

        # 术语表
        if self.config.get("glossary_enable") == True:
            result = self.prompt_builder.build_glossary(src_dict)
            if result != "":
                main = main + "\n" + result
                extra_log.append(result)

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": (
                f"{main}"
                + "\n" + "原文文本："
                + "\n" + json.dumps(src_dict, indent = None, ensure_ascii = False)
            ),
        })

        # 伪造预回复，DeepSeek R1 不兼容此方法
        model = self.platform.get("model")
        if "deepseek" in model.lower() and ("r1" in model.lower() or "reasoner" in model.lower()):
            pass
        else:
            messages.append({
                "role": "assistant",
                "content": self.prompt_builder.build_fake_reply(),
            })

        # 当目标为 google 系列接口时，转换 messages 的格式
        if self.platform.get("api_format") == Base.APIFormat.GOOGLE:
            new = []
            for m in messages:
                new.append({
                    "role": "model" if m.get("role") == "assistant" else m.get("role"),
                    "parts": m.get("content", ""),
                })
            messages = new

        return messages, extra_log

    # 生成提示词 - Sakura
    def generate_prompt_sakura(self, src_dict: dict) -> tuple[list[dict], list[str]]:
        # 初始化
        messages = []
        extra_log = []

        # 构建系统提示词
        messages.append({
            "role": "system",
            "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。"
        })

        # 术语表
        base = ""
        if self.config.get("glossary_enable") == True:
            result = self.prompt_builder.build_glossary_sakura(src_dict)
            if result == "":
                base = "将下面的日文文本翻译成中文：\n" + "\n".join(src_dict.values())
            else:
                base = (
                    "根据以下术语表（可以为空）：\n" + result
                    + "\n" + "将下面的日文文本根据对应关系和备注翻译成中文：\n" + "\n".join(src_dict.values())
                )
                extra_log.append(result)

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": base,
        })

        return messages, extra_log

    # 打印日志表格
    def print_log_table(self, flag: str, start: int, pt: int, ct: int, srcs: list[str], dsts: list[str], extra_file: list[str], extra_console: list[str]) -> None:
        if flag == ResponseChecker.Error.UNKNOWN:
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} - {Localizer.get().response_checker_unknown}"
            log_func = self.error
        elif flag == ResponseChecker.Error.FAIL_DATA:
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} - {Localizer.get().response_checker_fail_data}"
            log_func = self.warning
        elif flag == ResponseChecker.Error.FAIL_LINE:
            style = "red"
            message = f"{Localizer.get().translator_response_check_fail} - {Localizer.get().response_checker_fail_line}"
            log_func = self.warning
        elif flag == ResponseChecker.Error.UNTRANSLATED:
            style = "yellow"
            message = f"{Localizer.get().translator_response_check_fail_part} - {Localizer.get().response_checker_untranslated}"
            log_func = self.warning
        else:
            style = "green"
            message = (
                Localizer.get().translator_task_success.replace("{TIME}", f"{(time.time() - start):.2f}")
                                                       .replace("{LINES}", f"{len(srcs)}")
                                                       .replace("{PT}", f"{pt}")
                                                       .replace("{CT}", f"{ct}")
            )
            log_func = self.info

        # 写入日志到文件
        file_rows = self.generate_log_rows(message, srcs, dsts, extra_file, highlight = False)
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
            console_rows = self.generate_log_rows(message, srcs, dsts, extra_console, highlight = True)
            TranslatorTask.CONSOLE.print(self.generate_log_table(console_rows, style))

    # 生成日志行
    def generate_log_rows(self, message: str, srcs: list[str], dsts: list[str], extra: list[str], highlight: bool) -> tuple[list[str], str]:
        rows = []

        if message != "":
            rows.append(message)

        # 添加额外日志
        for v in extra:
            rows.append(v.strip())

        # 原文译文对比
        pair = ""
        for src, dst in itertools.zip_longest(srcs, dsts, fillvalue = ""):
            if highlight == False:
                pair = pair + "\n" + f"{src} --> {dst}"
            else:
                pair = pair + "\n" + f"{src} [bright_blue]-->[/] {dst}"
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