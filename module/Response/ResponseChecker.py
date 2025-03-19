import re

from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Filter.RuleFilter import RuleFilter
from module.Filter.LanguageFilter import LanguageFilter
from module.CodeSaver import CodeSaver
from module.PromptBuilder import PromptBuilder

class ResponseChecker(Base):

    class Error():

        UNKNOWN: int = 100
        FAIL_DATA: int = 200
        FAIL_LINE: int = 300
        SIMILARITY: int = 400
        DEGRADATION: int = 500

    RE_DEGRADATION = re.compile(r"(.{1,2})\1{16,}", flags = re.IGNORECASE)

    def __init__(self, config: dict, items: list[CacheItem]) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.config = config
        self.source_language = self.config.get("source_language")
        self.target_language = self.config.get("target_language")

    def check(self, src_dict: dict[str, str], dst_dict: dict[str, str], source_language: str) -> str:
        # 数据解析失败
        if len(dst_dict) == 0 or all(v == "" or v == None for v in dst_dict.values()):
            return ResponseChecker.Error.FAIL_DATA, None

        # 当翻译任务为单条目任务，且此条目已单独重试过至少一次，直接返回 None（即没有错误），不进行后续判断
        if len(self.items) == 1 and self.items[0].get_retry_count() > 1:
            return None, None

        # 行数检查
        if not (
            len(src_dict) == len(dst_dict) # 原文与译文行数一致
            and all(str(key) in dst_dict for key in range(len(dst_dict))) # 译文的 Key 的值为从 0 开始的连续数值字符
        ):
            return ResponseChecker.Error.FAIL_LINE, None

        # 相似检查
        error, data = self.check_similarity(src_dict, dst_dict, source_language)
        if error != None:
            return error, data

        # 退化检查
        error, data = self.check_degradation(src_dict, dst_dict)
        if error != None:
            return error, data

        return None, None

    # 相似检查
    def check_similarity(self, src_dict: dict[str, str], dst_dict: dict[str, str], source_language: str) -> tuple[str | None, list]:
        data = []
        for src, dst in zip(src_dict.values(), dst_dict.values()):
            src = src.strip()
            dst = dst.strip()

            # 原文内容包含代码救星占位符时，判断为正确翻译
            if CodeSaver.PLACEHOLDER in src:
                data.append(0)
                continue

            # 原文内容符合规则过滤条件时，判断为正确翻译
            if RuleFilter.filter(src) == True:
                data.append(0)
                continue

            # 原文内容符合语言过滤条件时，判断为正确翻译
            if LanguageFilter.filter(src, source_language) == True:
                data.append(0)
                continue

            # 译文内容包括伪回复时，判断为错误翻译
            if PromptBuilder.FAKE_REPLY_ZH in dst or PromptBuilder.FAKE_REPLY_EN in dst:
                data.append(1)
                continue

            # 判断是否包含或相似
            is_similar = src in dst or dst in src or TextHelper.check_similarity_by_jaccard(src, dst) > 0.80

            # 不包含或相似时，判断为正确翻译
            if not is_similar:
                data.append(0)
            else:
                # 日翻中时，只有译文至少包含一个平假名或片假名字符时，才判断为 相似
                if self.source_language == Base.Language.JA and self.target_language == Base.Language.ZH:
                    if TextHelper.JA.any_hiragana(dst) or TextHelper.JA.any_katakana(dst):
                        data.append(1)
                    else:
                        data.append(0)
                # 韩翻中时，只有译文至少包含一个谚文字符时，判断为 相似
                elif self.source_language == Base.Language.KO and self.target_language == Base.Language.ZH:
                    if TextHelper.KO.any_hangeul(dst):
                        data.append(1)
                    else:
                        data.append(0)
                # 其他情况，只要原文译文相同或相似就可以判断为 相似
                else:
                    data.append(1)

        if all(v == 0 for v in data):
            return None, None
        else:
            return ResponseChecker.Error.SIMILARITY, data

    # 退化检测
    def check_degradation(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> None:
        data: list[int] = []

        for src, dst in zip(src_dict.values(), dst_dict.values()):
            src = src.strip()
            dst = dst.strip()

            # 当原文中不包含重复文本但是译文中包含重复文本时，判断为 退化
            if ResponseChecker.RE_DEGRADATION.search(src) == None and ResponseChecker.RE_DEGRADATION.search(dst) != None:
                data.append(1)
            else:
                data.append(0)

        if all(v == 0 for v in data):
            return None, None
        else:
            return ResponseChecker.Error.DEGRADATION, data