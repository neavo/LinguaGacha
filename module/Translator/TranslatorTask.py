import time
import itertools
import threading

import opencc
import rapidjson as json
from rich import box
from rich.table import Table
from rich.console import Console

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheManager import CacheManager
from module.Fixer.KanaFixer import KanaFixer
from module.Fixer.EscapeFixer import EscapeFixer
from module.Fixer.NumberFixer import NumberFixer
from module.Fixer.HangeulFixer import HangeulFixer
from module.Fixer.PunctuationFixer import PunctuationFixer
from module.Response.ResponseChecker import ResponseChecker
from module.Response.ResponseDecoder import ResponseDecoder
from module.Localizer.Localizer import Localizer
from module.LogHelper import LogHelper
from module.CodeSaver import CodeSaver
from module.Normalizer import Normalizer
from module.Translator.TranslatorRequester import TranslatorRequester
from module.PromptBuilder import PromptBuilder

class TranslatorTask(Base):

    # 类变量
    OPENCCS2T = opencc.OpenCC("s2t")
    OPENCCT2S = opencc.OpenCC("t2s")
    CONSOLE = Console(highlight = True, tab_size = 4)

    # 类线程锁
    LOCK = threading.Lock()

    def __init__(self, config: dict, platform: dict, items: list[CacheItem], preceding_items: list[CacheItem], cache_manager: CacheManager) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.preceding_items = preceding_items
        self.config = config
        self.platform = platform
        self.code_saver = CodeSaver()
        self.cache_manager = cache_manager
        self.prompt_builder = PromptBuilder(self.config)
        self.response_checker = ResponseChecker(self.config, items)

        # 生成原文文本字典与文本类型字典
        self.src_dict: dict[str, str] = {}
        self.item_dict: dict[str, CacheItem] = {}
        for item in items:
            for sub_line in item.split_sub_lines():
                self.src_dict[str(len(self.src_dict))] = sub_line
                self.item_dict[str(len(self.item_dict))] = item

        # 正规化
        self.src_dict = self.normalize(self.src_dict)

        # 译前替换
        self.src_dict = self.replace_before_translation(self.src_dict)

        # 代码救星预处理
        self.src_dict, self.samples = self.code_saver.pre_process(self.src_dict, self.item_dict)

        # 初始化错误文本
        if not hasattr(TranslatorTask, "ERROR_TEXT_DICT"):
            TranslatorTask.ERROR_TEXT_DICT = {
                ResponseChecker.Error.UNKNOWN: Localizer.get().response_checker_unknown,
                ResponseChecker.Error.FAIL_DATA: Localizer.get().response_checker_fail_data,
                ResponseChecker.Error.FAIL_LINE_COUNT: Localizer.get().response_checker_fail_line_count,
                ResponseChecker.Error.LINE_ERROR_KANA: Localizer.get().response_checker_line_error_kana,
                ResponseChecker.Error.LINE_ERROR_HANGEUL: Localizer.get().response_checker_line_error_hangeul,
                ResponseChecker.Error.LINE_ERROR_FAKE_REPLY: Localizer.get().response_checker_line_error_fake_reply,
                ResponseChecker.Error.LINE_ERROR_SIMILARITY: Localizer.get().response_checker_line_error_similarity,
                ResponseChecker.Error.LINE_ERROR_DEGRADATION: Localizer.get().response_checker_line_error_degradation,
            }

    # 启动任务
    def start(self, current_round: int) -> dict:
        return self.request(self.src_dict, self.item_dict, self.preceding_items, self.samples, current_round)

    # 请求
    def request(self, src_dict: dict[str, str], item_dict: dict[str, CacheItem], preceding_items: list[CacheItem], samples: list[str], current_round: int) -> dict:
        # 任务开始的时间
        start_time = time.time()

        # 检测是否需要停止任务
        if Base.WORK_STATUS == Base.Status.STOPPING:
            return {}

        # 检查是否超时，超时则直接跳过当前任务，以避免死循环
        if time.time() - start_time >= self.config.get("request_timeout"):
            return {}

        # 生成请求提示词
        if self.platform.get("api_format") != Base.APIFormat.SAKURALLM:
            self.messages, console_log = self.generate_prompt(src_dict, preceding_items, samples)
        else:
            self.messages, console_log = self.generate_prompt_sakura(src_dict)

        # 发起请求
        requester = TranslatorRequester(self.config, self.platform, current_round)
        skip, response_think, response_result, prompt_tokens, completion_tokens = requester.request(self.messages)

        # 如果请求结果标记为 skip，即有错误发生，则跳过本次循环
        if skip == True:
            return {
                "check_result": [ResponseChecker.Error.UNKNOWN],
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
            console_log.append(Localizer.get().translator_task_response_result + response_result) if LogHelper.is_debug() else None
        if response_decode_log != "":
            file_log.append(response_decode_log)
            console_log.append(response_decode_log) if LogHelper.is_debug() else None

        # 如果有任何正确的条目，则处理结果
        if any(v == ResponseChecker.Error.NONE for v in check_result):
            # 自动修复
            dst_dict: dict[str, str] = self.auto_fix(src_dict, dst_dict, self.config)

            # 代码救星后处理
            dst_dict = self.code_saver.post_process(src_dict, dst_dict)

            # 译后替换
            dst_dict = self.replace_after_translation(dst_dict)

            # 繁体输出
            dst_dict = self.convert_chinese_character_form(dst_dict)

            # 更新术语表
            with TranslatorTask.LOCK:
                self.merge_glossary(glossary_auto)

            # 更新缓存数据
            updated_count = 0
            dst_sub_lines = list(dst_dict.values())
            check_result_lines = check_result.copy()
            for item in self.items:
                dst, dst_sub_lines, check_result_lines = item.merge_sub_lines(dst_sub_lines, check_result_lines)
                if dst != None:
                    updated_count = updated_count + 1
                    item.set_dst(dst)
                    item.set_status(Base.TranslationStatus.TRANSLATED)

        # 打印任务结果
        self.print_log_table(
            check_result,
            start_time,
            prompt_tokens,
            completion_tokens,
            [line.strip() for line in src_dict.values()],
            [line.strip() for line in dst_dict.values()],
            file_log,
            console_log
        )

        # 返回任务结果
        if any(v == ResponseChecker.Error.NONE for v in check_result):
            return {
                "check_result": None,
                "row_count": updated_count,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            }
        else:
            return {
                "check_result": check_result,
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

    # 中文字型转换
    def convert_chinese_character_form(self, data: dict[str, str]) -> dict:
        if self.config.get("target_language") != BaseLanguage.ZH:
            return data

        if self.config.get("traditional_chinese_enable") == True:
            return {k: TranslatorTask.OPENCCS2T.convert(v) for k, v in data.items()}
        else:
            return {k: TranslatorTask.OPENCCT2S.convert(v) for k, v in data.items()}

    # 自动修复
    def auto_fix(self, src_dict: dict[str, str], dst_dict: dict[str, str], config: dict) -> dict:
        source_language = self.config.get("source_language")
        target_language = self.config.get("target_language")

        for k in dst_dict:
            # 有效性检查
            if k not in src_dict:
                continue

            # 假名修复
            if source_language == BaseLanguage.JA:
                dst_dict[k] = KanaFixer.fix(dst_dict[k])
            # 谚文修复
            elif source_language == BaseLanguage.KO:
                dst_dict[k] = HangeulFixer.fix(dst_dict[k])

            # 转义修复
            dst_dict[k] = EscapeFixer.fix(src_dict[k], dst_dict[k])

            # 数字修复
            dst_dict[k] = NumberFixer.fix(src_dict[k], dst_dict[k])

            # 标点符号修复
            dst_dict[k] = PunctuationFixer.fix(src_dict[k], dst_dict[k], source_language, target_language)

        return dst_dict

    # 生成提示词
    def generate_prompt(self, src_dict: dict, preceding_items: list[CacheItem], samples: list[str]) -> tuple[list[dict], list[str]]:
        # 初始化
        messages = []
        extra_log = []

        # 基础提示词
        main = self.prompt_builder.build_main()

        # 参考上文
        if len(preceding_items) > 0:
            result = self.prompt_builder.build_preceding(preceding_items)
            if result != "":
                main = main + "\n" + result
                extra_log.append(result)

        # 术语表
        if self.config.get("glossary_enable") == True:
            result = self.prompt_builder.build_glossary(src_dict)
            if result != "":
                main = main + "\n" + result
                extra_log.append(result)

        # 控制字符示例
        result = self.prompt_builder.build_control_characters_samples(samples)
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

        # 伪造预回复，可以更好的回避模型的安全限制
        # DeepSeek R1、 Claude 思考模式 不兼容此方法
        model: str = self.platform.get("model").lower()
        thinking: str = self.platform.get("thinking")
        api_format: str = self.platform.get("api_format")
        if "deepseek" in model and ("r1" in model or "reasoner" in model):
            pass
        elif api_format == "Anthropic" and thinking == True:
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
        main = "将下面的日文文本翻译成中文：\n" + "\n".join(src_dict.values())
        if self.config.get("glossary_enable") == True:
            result = self.prompt_builder.build_glossary_sakura(src_dict)
            if result != "":
                main = (
                    "根据以下术语表（可以为空）：\n" + result
                    + "\n" + "将下面的日文文本根据对应关系和备注翻译成中文：\n" + "\n".join(src_dict.values())
                )
                extra_log.append(result)

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": main,
        })

        return messages, extra_log

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
        file_rows = self.generate_log_rows(srcs, dsts, file_log, highlight = False)
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
            console_rows = self.generate_log_rows(srcs, dsts, console_log, highlight = True)
            TranslatorTask.CONSOLE.print(self.generate_log_table(console_rows, style))

    # 生成日志行
    def generate_log_rows(self, srcs: list[str], dsts: list[str], extra: list[str], highlight: bool) -> tuple[list[str], str]:
        rows = []

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