import re
import json
from enum import StrEnum
from functools import lru_cache

import opencc

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Cache.CacheItem import CacheItem
from module.Fixer.CodeFixer import CodeFixer
from module.Fixer.KanaFixer import KanaFixer
from module.Fixer.NumberFixer import NumberFixer
from module.Fixer.EscapeFixer import EscapeFixer
from module.Fixer.HangeulFixer import HangeulFixer
from module.Fixer.PunctuationFixer import PunctuationFixer
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Normalizer import Normalizer

class TextProcessor(Base):

    # 对文本进行处理的流程为：
    # - 正规化
    # - 译前替换
    # - 文本保护
    # - 提取姓名
    # ---- 翻译 ----
    # - 注入姓名
    # - 繁体输出
    # - 自动修复
    # - 文本保护
    # - 译后替换
    # 注意预处理和后处理的顺序应该镜像颠倒

    class RuleType(StrEnum):

        CHECK = "CHECK"
        SAMPLE = "SAMPLE"
        PREFIX = "PREFIX"
        SUFFIX = "SUFFIX"

    # 类变量
    OPENCCS2T = opencc.OpenCC("s2t")
    OPENCCT2S = opencc.OpenCC("t2s")

    # 正则表达式
    RE_NAME = re.compile(r"^【(.*?)】\s*|\[(.*?)\]\s*", flags = re.IGNORECASE)
    RE_BLANK: re.Pattern = re.compile(r"\s+", re.IGNORECASE)

    def __init__(self, config: Config, item: CacheItem) -> None:
        super().__init__()

        # 初始化
        self.config: Config = config
        self.item: CacheItem = item

        self.srcs: list[str] = []
        self.vaild_index: set[int] = set()
        self.samples: list[str] = []
        self.prefix_codes: dict[int, list[str]] = {}
        self.suffix_codes: dict[int, list[str]] = {}

    @classmethod
    def reset(cls) -> None:
        cls.get_res.cache_clear()
        cls.get_rule.cache_clear()

    @classmethod
    @lru_cache(maxsize = None)
    def get_res(cls, text_type: CacheItem.TextType) -> list[str]:
        result: list[dict[str, str]] = []

        path: str = f"./resource/text_preserve_preset/{Localizer.get_app_language().lower()}/{text_type.lower()}.json"
        try:
            with open(path, "r", encoding = "utf-8-sig") as reader:
                result: list[dict[str, str]] = json.load(reader)
        except:
            pass

        return [v.get("src") for v in result if v.get("src") != ""]

    @classmethod
    @lru_cache(maxsize = None)
    def get_rule(cls, res: tuple[str], rule_type: RuleType) -> re.Pattern[str]:
        if len(res) == 0:
            return None
        elif rule_type == __class__.RuleType.CHECK:
            return re.compile(rf"(?:{"|".join(res)})+", re.IGNORECASE)
        elif rule_type == __class__.RuleType.SAMPLE:
            return re.compile(rf"{"|".join(res)}", re.IGNORECASE)
        elif rule_type == __class__.RuleType.PREFIX:
            return re.compile(rf"^(?:{"|".join(res)})+", re.IGNORECASE)
        elif rule_type == __class__.RuleType.SUFFIX:
            return re.compile(rf"(?:{"|".join(res)})+$", re.IGNORECASE)

    def get_re_check(self, custom: bool, text_type: CacheItem.TextType) -> re.Pattern:
        if custom == False:
            res = __class__.get_res(text_type)
        else:
            res = [
                v.get("src")
                for v in self.config.text_preserve_data if v.get("src") != ""
            ]

        return __class__.get_rule(tuple(res), __class__.RuleType.CHECK)

    def get_re_sample(self, custom: bool, text_type: CacheItem.TextType) -> re.Pattern:
        if custom == False:
            res = __class__.get_res(text_type)
        else:
            res = [
                v.get("src")
                for v in self.config.text_preserve_data if v.get("src") != ""
            ]

        return __class__.get_rule(tuple(res), __class__.RuleType.SAMPLE)

    def get_re_prefix(self, custom: bool, text_type: CacheItem.TextType) -> re.Pattern:
        if custom == False:
            res = __class__.get_res(text_type)
        else:
            res = [
                v.get("src")
                for v in self.config.text_preserve_data if v.get("src") != ""
            ]

        return __class__.get_rule(tuple(res), __class__.RuleType.PREFIX)

    def get_re_suffix(self, custom: bool, text_type: CacheItem.TextType) -> re.Pattern:
        if custom == False:
            res = __class__.get_res(text_type)
        else:
            res = [
                v.get("src")
                for v in self.config.text_preserve_data if v.get("src") != ""
            ]

        return __class__.get_rule(tuple(res), __class__.RuleType.SUFFIX)

    # 按规则提取文本
    def extract(self, rule: re.Pattern, line: str) -> tuple[str, list[str]]:
        codes: list[str] = []

        def repl(match: re.Match) -> str:
            codes.append(match.group(0))
            return ""
        line = rule.sub(repl, line)

        return line, codes

    # 正规化
    def normalize(self, src: str) -> str:
        return Normalizer.normalize(src)

    # 自动修复
    def auto_fix(self, src: str, dst: str) -> str:
        source_language = self.config.source_language
        target_language = self.config.target_language

        # 假名修复
        if source_language == BaseLanguage.Enum.JA:
            dst = KanaFixer.fix(dst)
        # 谚文修复
        elif source_language == BaseLanguage.Enum.KO:
            dst = HangeulFixer.fix(dst)

        # 代码修复
        dst = CodeFixer.fix(src, dst, self.item.get_text_type(), self.config)

        # 转义修复
        dst = EscapeFixer.fix(src, dst)

        # 数字修复
        dst = NumberFixer.fix(src, dst)

        # 标点符号修复
        dst = PunctuationFixer.fix(src, dst, source_language, target_language)

        return dst

    # 注入姓名
    def inject_name(self, srcs: list[str], item: CacheItem) -> list[str]:
        name: str = item.get_first_name_src()
        if name is not None and len(srcs) > 0:
            srcs[0] = f"【{name}】{srcs[0]}"

        return srcs

    # 提取姓名
    def extract_name(self, srcs: list[str], dsts: list[str], item: CacheItem) -> str:
        name: str = None
        if item.get_first_name_src() is not None and len(srcs) > 0:
            result: re.Match[str] = __class__.RE_NAME.search(dsts[0])
            if result is None:
                pass
            elif result.group(1) is not None:
                name = result.group(1)
            elif result.group(2) is not None:
                name = result.group(2)

            # 清理一下
            srcs[0] = __class__.RE_NAME.sub("", srcs[0])
            dsts[0] = __class__.RE_NAME.sub("", dsts[0])

        return name, srcs, dsts

    # 译前替换
    def replace_pre_translation(self, src: str) -> str:
        if self.config.pre_translation_replacement_enable == False:
            return src

        for v in self.config.pre_translation_replacement_data:
            if v.get("regex", False) != True:
                src = src.replace(v.get("src"), v.get("dst"))
            else:
                src = re.sub(rf"{v.get("src")}", rf"{v.get("dst")}", src)

        return src

    # 译后替换
    def replace_post_translation(self, dst: str) -> str:
        if self.config.post_translation_replacement_enable == False:
            return dst

        for v in self.config.post_translation_replacement_data:
            if v.get("regex", False) != True:
                dst = dst.replace(v.get("src"), v.get("dst"))
            else:
                dst = re.sub(rf"{v.get("src")}", rf"{v.get("dst")}", dst)

        return dst

    # 中文字型转换
    def convert_chinese_character_form(self, dst: str) -> str:
        if self.config.target_language != BaseLanguage.Enum.ZH:
            return dst

        if self.config.traditional_chinese_enable == True:
            return __class__.OPENCCS2T.convert(dst)
        else:
            return __class__.OPENCCT2S.convert(dst)

    # 处理前后缀代码段
    def prefix_suffix_process(self, i: int, src: str, text_type: CacheItem.TextType) -> None:
        rule: re.Pattern = self.get_re_prefix(
            custom = self.config.text_preserve_enable,
            text_type = text_type,
        )
        if rule is not None:
            src, self.prefix_codes[i] = self.extract(rule, src)

        rule: re.Pattern = self.get_re_suffix(
            custom = self.config.text_preserve_enable,
            text_type = text_type,
        )
        if rule is not None:
            src, self.suffix_codes[i] = self.extract(rule, src)

        return src

    # 预处理
    def pre_process(self) -> None:
        # 依次处理每行，顺序为：
        text_type = self.item.get_text_type()
        for i, src in enumerate(self.item.get_src().split("\n")):
            if src == "":
                pass
            elif src.strip() == "":
                pass
            else:
                # 正规化
                src = self.normalize(src)

                # 译前替换
                src = self.replace_pre_translation(src)

                # 处理前后缀代码段
                src = self.prefix_suffix_process(i, src, text_type)

                # 如果处理后的文本为空
                if src == "":
                    pass
                else:
                    # 查找控制字符示例
                    rule: re.Pattern = self.get_re_sample(
                        custom = self.config.text_preserve_enable,
                        text_type = text_type,
                    )
                    if rule is not None:
                        self.samples.extend([v.group(0) for v in rule.finditer(src)])

                    # 补充
                    if text_type == CacheItem.TextType.MD:
                        self.samples.append("Markdown Code")

                    # 保存结果
                    self.srcs.append(src)
                    self.vaild_index.add(i)

        # 注入姓名
        self.srcs = self.inject_name(self.srcs, self.item)

    # 后处理
    def post_process(self, dsts: list[str]) -> tuple[str, str]:
        results: list[str] = []

        # 提取姓名
        name, _, dsts = self.extract_name(self.srcs, dsts, self.item)

        # 依次处理每行
        for i, src in enumerate(self.item.get_src().split("\n")):
            if src == "":
                dst = ""
            elif src.strip() == "":
                dst = src
            elif i not in self.vaild_index:
                dst = src
            else:
                # 移除模型可能额外添加的头尾空白符
                dst = dsts.pop(0).strip()

                # 繁体输出
                dst = self.convert_chinese_character_form(dst)

                # 自动修复
                dst = self.auto_fix(src, dst)

                if i in self.prefix_codes:
                    dst = "".join(self.prefix_codes.get(i)) + dst
                if i in self.suffix_codes:
                    dst = dst + "".join(self.suffix_codes.get(i))

                # 译后替换
                dst = self.replace_post_translation(dst)

            # 添加结果
            results.append(dst)

        return name, "\n".join(results)

    # 检查代码段
    def check(self, src: str, dst: str, text_type: CacheItem.TextType) -> bool:
        x: list[str] = []
        y: list[str] = []
        rule: re.Pattern = self.get_re_check(
            custom = self.config.text_preserve_enable,
            text_type = text_type,
        )
        if rule is not None:
            x = [v.group(0) for v in rule.finditer(src)]
            y = [v.group(0) for v in rule.finditer(dst)]

        x = [__class__.RE_BLANK.sub("", v) for v in x if __class__.RE_BLANK.sub("", v) != ""]
        y = [__class__.RE_BLANK.sub("", v) for v in y if __class__.RE_BLANK.sub("", v) != ""]

        return x == y