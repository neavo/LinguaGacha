import re
import threading
from enum import StrEnum
from functools import lru_cache
from typing import Any

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Fixer.CodeFixer import CodeFixer
from module.Fixer.EscapeFixer import EscapeFixer
from module.Fixer.HangeulFixer import HangeulFixer
from module.Fixer.KanaFixer import KanaFixer
from module.Fixer.NumberFixer import NumberFixer
from module.Fixer.PunctuationFixer import PunctuationFixer
from module.Localizer.Localizer import Localizer
from module.Normalizer import Normalizer
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.RubyCleaner import RubyCleaner
from module.Utils.JSONTool import JSONTool


class TextProcessor(Base):
    # 对文本进行处理的流程为：
    # - 正规化
    # - 清理注音
    # - 文本保护
    # - 译前替换
    # - 注入姓名
    # ---- 翻译 ----
    # - 提取姓名
    # - 自动修复
    # - 译后替换
    # - 文本保护
    # 注意预处理和后处理的顺序应该镜像颠倒

    class RuleType(StrEnum):
        CHECK = "CHECK"
        SAMPLE = "SAMPLE"
        PREFIX = "PREFIX"
        SUFFIX = "SUFFIX"

    # 正则表达式
    RE_NAME = re.compile(r"^[\[【](.*?)[\]】]\s*", flags=re.IGNORECASE)
    RE_BLANK: re.Pattern = re.compile(r"\s+", re.IGNORECASE)

    # 类线程锁
    LOCK: threading.Lock = threading.Lock()

    def __init__(
        self,
        config: Config,
        item: Item | None,
        quality_snapshot: QualityRuleSnapshot | None = None,
    ) -> None:
        super().__init__()

        # 初始化
        self.config: Config = config
        self.item: Item | None = item
        self.quality_snapshot: QualityRuleSnapshot | None = quality_snapshot

        self.srcs: list[str] = []
        self.samples: list[str] = []
        self.vaild_index: set[int] = set()
        self.prefix_codes: dict[int, list[str]] = {}
        self.suffix_codes: dict[int, list[str]] = {}
        # 始终保留每行的头尾空白（与文本保护规则及其开关解耦）。
        self.leading_whitespace_by_line: dict[int, str] = {}
        self.trailing_whitespace_by_line: dict[int, str] = {}

    def extract_line_edge_whitespace(self, i: int, src: str) -> str:
        leading_len = len(src) - len(src.lstrip())
        trailing_len = len(src) - len(src.rstrip())

        leading = src[:leading_len] if leading_len > 0 else ""
        trailing = src[len(src) - trailing_len :] if trailing_len > 0 else ""

        self.leading_whitespace_by_line[i] = leading
        self.trailing_whitespace_by_line[i] = trailing

        if trailing_len > 0:
            return src[leading_len:-trailing_len]
        return src[leading_len:]

    @classmethod
    def reset(cls) -> None:
        cls.get_rule.cache_clear()

    @classmethod
    @lru_cache(maxsize=None)
    def get_rule(
        cls,
        custom: bool,
        custom_data: tuple[str, ...] | None,
        rule_type: RuleType,
        text_type: Item.TextType,
        language: BaseLanguage.Enum,
    ) -> re.Pattern[str] | None:
        data: list[str] = []
        if custom:
            if custom_data:
                data = [v for v in custom_data if isinstance(v, str) and v.strip()]
        else:
            path: str = f"resource/preset/text_preserve/{language.lower()}/{text_type.lower()}.json"
            try:
                raw = JSONTool.load_file(path)
                if isinstance(raw, list):
                    for entry in raw:
                        if not isinstance(entry, dict):
                            continue
                        src = entry.get("src", "")
                        if isinstance(src, str) and src.strip():
                            data.append(src)
            except Exception:
                # 不是每个格式都有对应的预置保护规则，找不到时静默跳过
                pass

        if len(data) == 0:
            return None
        elif rule_type == __class__.RuleType.CHECK:
            return re.compile(rf"(?:{'|'.join(data)})+", re.IGNORECASE)
        elif rule_type == __class__.RuleType.SAMPLE:
            return re.compile(rf"{'|'.join(data)}", re.IGNORECASE)
        elif rule_type == __class__.RuleType.PREFIX:
            return re.compile(rf"^(?:{'|'.join(data)})+", re.IGNORECASE)
        elif rule_type == __class__.RuleType.SUFFIX:
            return re.compile(rf"(?:{'|'.join(data)})+$", re.IGNORECASE)

    def build_custom_preserve_data(self) -> tuple[str, ...]:
        data: list[str] = []

        preserve_entries: tuple[dict[str, Any], ...] | list[dict[str, Any]]
        if self.quality_snapshot is not None:
            preserve_entries = self.quality_snapshot.text_preserve_entries
        else:
            preserve_entries = DataManager.get().get_text_preserve()

        for v in preserve_entries:
            if not isinstance(v, dict):
                continue
            src = v.get("src", "")
            if not isinstance(src, str):
                continue
            src = src.strip()
            if not src:
                continue
            data.append(src)
        return tuple(data)

    def get_text_preserve_mode(self) -> DataManager.TextPreserveMode:
        if self.quality_snapshot is not None:
            return self.quality_snapshot.text_preserve_mode
        return DataManager.get().get_text_preserve_mode()

    def get_text_preserve_custom_enabled(self) -> bool:
        mode = self.get_text_preserve_mode()
        return mode == DataManager.TextPreserveMode.CUSTOM

    def get_re_check(self, custom: bool, text_type: Item.TextType) -> re.Pattern | None:
        del custom
        with __class__.LOCK:
            mode = self.get_text_preserve_mode()
            if mode == DataManager.TextPreserveMode.OFF:
                return None

            use_custom = mode == DataManager.TextPreserveMode.CUSTOM
            return __class__.get_rule(
                custom=use_custom,
                custom_data=self.build_custom_preserve_data() if use_custom else None,
                rule_type=__class__.RuleType.CHECK,
                text_type=text_type,
                language=Localizer.get_app_language(),
            )

    def get_re_sample(
        self, custom: bool, text_type: Item.TextType
    ) -> re.Pattern | None:
        del custom
        with __class__.LOCK:
            mode = self.get_text_preserve_mode()
            if mode == DataManager.TextPreserveMode.OFF:
                return None

            use_custom = mode == DataManager.TextPreserveMode.CUSTOM
            return __class__.get_rule(
                custom=use_custom,
                custom_data=self.build_custom_preserve_data() if use_custom else None,
                rule_type=__class__.RuleType.SAMPLE,
                text_type=text_type,
                language=Localizer.get_app_language(),
            )

    def get_re_prefix(
        self, custom: bool, text_type: Item.TextType
    ) -> re.Pattern | None:
        del custom
        with __class__.LOCK:
            mode = self.get_text_preserve_mode()
            if mode == DataManager.TextPreserveMode.OFF:
                return None

            use_custom = mode == DataManager.TextPreserveMode.CUSTOM
            return __class__.get_rule(
                custom=use_custom,
                custom_data=self.build_custom_preserve_data() if use_custom else None,
                rule_type=__class__.RuleType.PREFIX,
                text_type=text_type,
                language=Localizer.get_app_language(),
            )

    def get_re_suffix(
        self, custom: bool, text_type: Item.TextType
    ) -> re.Pattern | None:
        del custom
        with __class__.LOCK:
            mode = self.get_text_preserve_mode()
            if mode == DataManager.TextPreserveMode.OFF:
                return None

            use_custom = mode == DataManager.TextPreserveMode.CUSTOM
            return __class__.get_rule(
                custom=use_custom,
                custom_data=self.build_custom_preserve_data() if use_custom else None,
                rule_type=__class__.RuleType.SUFFIX,
                text_type=text_type,
                language=Localizer.get_app_language(),
            )

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

    # 清理注音
    def clean_ruby(self, src: str) -> str:
        if not self.config.clean_ruby:
            return src

        item = self.item
        if item is None:
            return src

        assert item is not None

        return RubyCleaner.clean(src, item.get_text_type())

    # 自动修复
    def auto_fix(self, src: str, dst: str) -> str:
        item = self.item
        if item is None:
            return dst

        assert item is not None

        source_language = self.config.source_language
        target_language = self.config.target_language

        # 假名修复
        if source_language == BaseLanguage.Enum.JA:
            dst = KanaFixer.fix(dst)
        # 谚文修复
        elif source_language == BaseLanguage.Enum.KO:
            dst = HangeulFixer.fix(dst)

        # 代码修复
        dst = CodeFixer.fix(
            src,
            dst,
            item.get_text_type(),
            self.config,
            quality_snapshot=self.quality_snapshot,
        )

        # 转义修复
        dst = EscapeFixer.fix(src, dst)

        # 数字修复
        dst = NumberFixer.fix(src, dst)

        # 标点符号修复
        dst = PunctuationFixer.fix(src, dst, source_language, target_language)

        return dst

    # 注入姓名
    def inject_name(self, srcs: list[str], item: Item | None) -> list[str]:
        if item is None:
            return srcs

        name: str | None = item.get_first_name_src()
        if name is not None and len(srcs) > 0:
            srcs[0] = f"【{name}】{srcs[0]}"

        return srcs

    # 提取姓名
    def extract_name(
        self, srcs: list[str], dsts: list[str], item: Item | None
    ) -> tuple[str | None, list[str], list[str]]:
        name: str | None = None
        if item is None:
            return name, srcs, dsts

        if item.get_first_name_src() is not None and len(srcs) > 0:
            result: re.Match[str] | None = __class__.RE_NAME.search(dsts[0])
            if result is None:
                pass
            elif result.group(1) is not None:
                name = result.group(1)

            # 清理一下
            if name is not None:
                srcs[0] = __class__.RE_NAME.sub("", srcs[0])
                dsts[0] = __class__.RE_NAME.sub("", dsts[0])

        return name, srcs, dsts

    # 译前替换
    def replace_pre_translation(self, src: str) -> str:
        if self.quality_snapshot is not None:
            if not self.quality_snapshot.pre_replacement_enable:
                return src
            pre_replacement_data = self.quality_snapshot.pre_replacement_entries
        else:
            if not DataManager.get().get_pre_replacement_enable():
                return src
            pre_replacement_data = DataManager.get().get_pre_replacement()

        for v in pre_replacement_data:
            raw_pattern = v.get("src", "")
            raw_replacement = v.get("dst", "")
            is_regex = v.get("regex", False)
            is_case_sensitive = v.get("case_sensitive", False)

            if raw_pattern is None:
                continue
            if not isinstance(raw_pattern, str):
                raw_pattern = str(raw_pattern)
            pattern_text: str = raw_pattern
            if not pattern_text:
                continue

            if raw_replacement is None:
                raw_replacement = ""
            if not isinstance(raw_replacement, str):
                raw_replacement = str(raw_replacement)
            replacement_text: str = raw_replacement

            if is_regex:
                # 正则模式：根据 case_sensitive 决定是否传递 re.IGNORECASE 标志
                flags = 0 if is_case_sensitive else re.IGNORECASE
                src = re.sub(pattern_text, replacement_text, src, flags=flags)
            else:
                # 普通替换模式
                if is_case_sensitive:
                    # 大小写敏感：使用普通 replace
                    src = src.replace(pattern_text, replacement_text)
                else:
                    # 大小写不敏感：使用正则模式 + IGNORECASE
                    # 需要转义特殊字符以确保按字面意义匹配
                    pattern_escaped = re.escape(pattern_text)
                    src = re.sub(
                        pattern_escaped,
                        lambda _: replacement_text,
                        src,
                        flags=re.IGNORECASE,
                    )

        return src

    # 译后替换
    def replace_post_translation(self, dst: str) -> str:
        if self.quality_snapshot is not None:
            if not self.quality_snapshot.post_replacement_enable:
                return dst
            post_replacement_data = self.quality_snapshot.post_replacement_entries
        else:
            if not DataManager.get().get_post_replacement_enable():
                return dst
            post_replacement_data = DataManager.get().get_post_replacement()

        for v in post_replacement_data:
            raw_pattern = v.get("src", "")
            raw_replacement = v.get("dst", "")
            is_regex = v.get("regex", False)
            is_case_sensitive = v.get("case_sensitive", False)

            if raw_pattern is None:
                continue
            if not isinstance(raw_pattern, str):
                raw_pattern = str(raw_pattern)
            pattern_text: str = raw_pattern
            if not pattern_text:
                continue

            if raw_replacement is None:
                raw_replacement = ""
            if not isinstance(raw_replacement, str):
                raw_replacement = str(raw_replacement)
            replacement_text: str = raw_replacement

            if is_regex:
                # 正则模式：根据 case_sensitive 决定是否传递 re.IGNORECASE 标志
                flags = 0 if is_case_sensitive else re.IGNORECASE
                dst = re.sub(pattern_text, replacement_text, dst, flags=flags)
            else:
                # 普通替换模式
                if is_case_sensitive:
                    # 大小写敏感：使用普通 replace
                    dst = dst.replace(pattern_text, replacement_text)
                else:
                    # 大小写不敏感：使用正则模式 + IGNORECASE
                    # 需要转义特殊字符以确保按字面意义匹配
                    pattern_escaped = re.escape(pattern_text)
                    dst = re.sub(
                        pattern_escaped,
                        lambda _: replacement_text,
                        dst,
                        flags=re.IGNORECASE,
                    )

        return dst

    # 处理前后缀代码段
    def prefix_suffix_process(self, i: int, src: str, text_type: Item.TextType) -> str:
        # 如果未启用自动移除前后缀代码段，直接返回原始文本
        if not self.config.auto_process_prefix_suffix_preserved_text:
            return src

        rule: re.Pattern | None = self.get_re_prefix(
            custom=self.get_text_preserve_custom_enabled(),
            text_type=text_type,
        )
        if rule is not None:
            src, self.prefix_codes[i] = self.extract(rule, src)

        rule: re.Pattern | None = self.get_re_suffix(
            custom=self.get_text_preserve_custom_enabled(),
            text_type=text_type,
        )

        if rule is not None:
            src, self.suffix_codes[i] = self.extract(rule, src)

        return src

    # 预处理
    def pre_process(self) -> None:
        item = self.item
        if item is None:
            return

        assert item is not None

        # 依次处理每行，顺序为：
        text_type = item.get_text_type()
        for i, src in enumerate(item.get_src().split("\n")):
            # 正规化
            src = self.normalize(src)

            # 清理注音
            src = self.clean_ruby(src)

            if src == "":
                pass
            elif src.strip() == "":
                pass
            else:
                src = self.extract_line_edge_whitespace(i, src)

                # 处理前后缀代码段
                src = self.prefix_suffix_process(i, src, text_type)

                # 如果处理后的文本为空
                if src == "":
                    pass
                else:
                    # 译前替换
                    src = self.replace_pre_translation(src)

                    # 查找控制字符示例
                    rule: re.Pattern | None = self.get_re_sample(
                        custom=self.get_text_preserve_custom_enabled(),
                        text_type=text_type,
                    )

                    if rule is not None:
                        self.samples.extend([v.group(0) for v in rule.finditer(src)])

                    # 补充
                    if text_type == Item.TextType.MD:
                        self.samples.append("Markdown Code")

                    # 保存结果
                    self.srcs.append(src)
                    self.vaild_index.add(i)

        # 注入姓名
        self.srcs = self.inject_name(self.srcs, item)

    # 后处理
    def post_process(self, dsts: list[str]) -> tuple[str | None, str]:
        item = self.item
        if item is None:
            return None, ""

        assert item is not None

        results: list[str] = []

        # 提取姓名
        name, _, dsts = self.extract_name(self.srcs, dsts, item)

        # 依次处理每行
        for i, src in enumerate(item.get_src().split("\n")):
            if src == "":
                dst = ""
            elif src.strip() == "":
                dst = src
            elif i not in self.vaild_index:
                dst = src
            else:
                # 移除模型可能额外添加的头尾空白符
                dst = dsts.pop(0).strip()

                # 自动修复
                dst = self.auto_fix(src, dst)

                # 译后替换
                dst = self.replace_post_translation(dst)

                prefix_codes = self.prefix_codes.get(i) or []
                if prefix_codes:
                    dst = "".join(prefix_codes) + dst

                suffix_codes = self.suffix_codes.get(i) or []
                if suffix_codes:
                    dst = dst + "".join(suffix_codes)

                # 在所有处理（fixers、replacements、prefix/suffix codes）完成后，
                # 再恢复原始的头尾空白，确保空白始终位于最外层，避免被中间处理误修。
                leading = self.leading_whitespace_by_line.get(i, "")
                trailing = self.trailing_whitespace_by_line.get(i, "")
                dst = leading + dst + trailing

            # 添加结果
            results.append(dst)

        return name, "\n".join(results)

    # 检查代码段
    def check(self, src: str, dst: str, text_type: Item.TextType) -> bool:
        x: list[str] = []
        y: list[str] = []
        rule: re.Pattern | None = self.get_re_check(
            custom=self.get_text_preserve_custom_enabled(),
            text_type=text_type,
        )

        if rule is not None:
            x = [v.group(0) for v in rule.finditer(src)]
            y = [v.group(0) for v in rule.finditer(dst)]

        x = [
            __class__.RE_BLANK.sub("", v)
            for v in x
            if __class__.RE_BLANK.sub("", v) != ""
        ]
        y = [
            __class__.RE_BLANK.sub("", v)
            for v in y
            if __class__.RE_BLANK.sub("", v) != ""
        ]

        return x == y
