import re
from enum import StrEnum

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.QualityRuleSnapshot import QualityRuleSnapshot
from module.Filter.LanguageFilter import LanguageFilter
from module.Filter.RuleFilter import RuleFilter
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor


class ResponseChecker(Base):
    class Error(StrEnum):
        NONE = "NONE"
        UNKNOWN = "UNKNOWN"
        FAIL_DATA = "FAIL_DATA"
        FAIL_TIMEOUT = "FAIL_TIMEOUT"
        FAIL_LINE_COUNT = "FAIL_LINE_COUNT"
        FAIL_DEGRADATION = "FAIL_DEGRADATION"
        LINE_ERROR_KANA = "LINE_ERROR_KANA"
        LINE_ERROR_HANGEUL = "LINE_ERROR_HANGEUL"
        LINE_ERROR_EMPTY_LINE = "LINE_ERROR_EMPTY_LINE"
        LINE_ERROR_SIMILARITY = "LINE_ERROR_SIMILARITY"

    LINE_ERROR: tuple[Error, ...] = (
        Error.LINE_ERROR_KANA,
        Error.LINE_ERROR_HANGEUL,
        Error.LINE_ERROR_EMPTY_LINE,
        Error.LINE_ERROR_SIMILARITY,
    )

    # 重试次数阈值
    RETRY_COUNT_THRESHOLD: int = 2

    def __init__(
        self,
        config: Config,
        items: list[Item],
        quality_snapshot: QualityRuleSnapshot | None = None,
    ) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.config = config
        self.quality_snapshot: QualityRuleSnapshot | None = quality_snapshot

    # 检查
    def check(
        self,
        srcs: list[str],
        dsts: list[str],
        text_type: Item.TextType,
        *,
        stream_degraded: bool = False,
    ) -> list[Error]:
        if stream_degraded:
            # 退化检测来自流式输出整体行为，不对应具体某一行的质量问题。
            return [__class__.Error.FAIL_DEGRADATION] * len(srcs)

        # 数据解析失败
        if len(dsts) == 0 or all(v == "" or v is None for v in dsts):
            return [__class__.Error.FAIL_DATA] * len(srcs)

        # 当翻译任务为单条目任务，且此条目已经是第二次单独重试时，直接返回，不进行后续判断
        if (
            len(self.items) == 1
            and self.items[0].get_retry_count() >= __class__.RETRY_COUNT_THRESHOLD
        ):
            return [__class__.Error.NONE] * len(srcs)

        # 行数检查
        if len(srcs) != len(dsts):
            return [__class__.Error.FAIL_LINE_COUNT] * len(srcs)

        # 逐行检查
        checks = self.check_lines(srcs, dsts, text_type)
        if any(v != __class__.Error.NONE for v in checks):
            return checks

        # 默认无错误
        return [__class__.Error.NONE] * len(srcs)

    # 逐行检查错误
    def check_lines(
        self, srcs: list[str], dsts: list[str], text_type: Item.TextType
    ) -> list[Error]:
        checks: list[__class__.Error] = []
        for src, dst in zip(srcs, dsts):
            src = src.strip()
            dst = dst.strip()

            # 原文不为空而译文为空时，判断为错误翻译
            if src != "" and dst == "":
                checks.append(__class__.Error.LINE_ERROR_EMPTY_LINE)
                continue

            # 原文内容符合规则过滤条件时，判断为正确翻译
            if RuleFilter.filter(src):
                checks.append(__class__.Error.NONE)
                continue

            # 原文内容符合语言过滤条件时，判断为正确翻译
            if LanguageFilter.filter(src, self.config.source_language):
                checks.append(__class__.Error.NONE)
                continue

            # 排除代码保护规则覆盖的文本以后再继续进行检查
            processor = TextProcessor(
                self.config,
                None,
                quality_snapshot=self.quality_snapshot,
            )
            custom_enabled = (
                self.quality_snapshot.text_preserve_mode
                == DataManager.TextPreserveMode.CUSTOM
                if self.quality_snapshot is not None
                else DataManager.get().get_text_preserve_enable()
            )
            rule: re.Pattern | None = processor.get_re_sample(
                custom=custom_enabled,
                text_type=text_type,
            )

            if rule is not None:
                src = rule.sub("", src)
                dst = rule.sub("", dst)

            # 当原文语言为日语，且译文中包含平假名或片假名字符时，判断为 假名残留
            if self.config.source_language == BaseLanguage.Enum.JA and (
                TextHelper.JA.any_hiragana(dst) or TextHelper.JA.any_katakana(dst)
            ):
                checks.append(__class__.Error.LINE_ERROR_KANA)
                continue

            # 当原文语言为韩语，且译文中包含谚文字符时，判断为 谚文残留
            if (
                self.config.source_language == BaseLanguage.Enum.KO
                and TextHelper.KO.any_hangeul(dst)
            ):
                checks.append(__class__.Error.LINE_ERROR_HANGEUL)
                continue

            # 判断是否包含或相似
            if (
                src in dst
                or dst in src
                or TextHelper.check_similarity_by_jaccard(src, dst) > 0.80
            ):
                # 日翻中时，只有译文至少包含一个平假名或片假名字符时，才判断为 相似
                if (
                    self.config.source_language == BaseLanguage.Enum.JA
                    and self.config.target_language == BaseLanguage.Enum.ZH
                ):
                    if TextHelper.JA.any_hiragana(dst) or TextHelper.JA.any_katakana(
                        dst
                    ):
                        checks.append(__class__.Error.LINE_ERROR_SIMILARITY)
                        continue
                # 韩翻中时，只有译文至少包含一个谚文字符时，才判断为 相似
                elif (
                    self.config.source_language == BaseLanguage.Enum.KO
                    and self.config.target_language == BaseLanguage.Enum.ZH
                ):
                    if TextHelper.KO.any_hangeul(dst):
                        checks.append(__class__.Error.LINE_ERROR_SIMILARITY)
                        continue
                # 其他情况，只要原文译文相同或相似就可以判断为 相似
                else:
                    checks.append(__class__.Error.LINE_ERROR_SIMILARITY)
                    continue

            # 默认为无错误
            checks.append(__class__.Error.NONE)

        # 返回结果
        return checks
