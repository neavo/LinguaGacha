from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.CodeSaver import CodeSaver
from module.PromptBuilder import PromptBuilder

class ResponseChecker(Base):

    class Error():

        UNKNOWN: int = 100
        FAIL_DATA: int = 200
        FAIL_LINE: int = 300
        UNTRANSLATED: int = 400

    def __init__(self, config: dict, items: list[CacheItem]) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.config = config
        self.source_language = self.config.get("source_language")

    def check(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> str:
        # 数据解析失败
        if len(dst_dict) == 0 or all(v == "" or v == None for v in dst_dict.values()):
            return ResponseChecker.Error.FAIL_DATA, None

        # 当翻译任务为多条目任务，或者翻译任务为单条目任务，且此条目的重试次数小于等于 3 次时，才进行以下判断
        if len(self.items) > 1 or (len(self.items) == 1 and self.items[0].get_retry_count() <= 3):
            # 行数检查
            if not (
                len(src_dict) == len(dst_dict) # 原文与译文行数一致
                and all(str(key) in dst_dict for key in range(len(dst_dict))) # 译文的 Key 的值为从 0 开始的连续数值字符
            ):
                return ResponseChecker.Error.FAIL_LINE, None

            # 翻译错误检查
            error, data = self.check_translation_error(src_dict, dst_dict)
            if error != None:
                return error, data

        return None, None

    # 翻译错误检查
    def check_translation_error(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> tuple[str | None, list]:
        data = []
        for src, dst in zip(src_dict.values(), dst_dict.values()):
            src = src.strip()
            dst = dst.strip()

            # 回复内容是代码救星的占位符时，判断为正确翻译
            if CodeSaver.PLACEHOLDER in src:
                data.append(0)
                continue

            # 模型生成的伪回复原文返回时，判断为错误翻译
            if PromptBuilder.FAKE_REPLY_ZH in dst or PromptBuilder.FAKE_REPLY_EN in dst:
                data.append(1)
                continue

            # 判断是否包含或相似
            is_similar = src in dst or dst in src or TextHelper.check_similarity_by_Jaccard(src, dst) > 0.80

            # 不包含或相似时，判断为正确翻译
            if not is_similar:
                data.append(0)
            else:
                # 原文是日文时，只有译文至少包含一个平假名或片假名字符时，判断为错误翻译（漏翻）
                if self.source_language == Base.Language.JA:
                    data.append(1 if (TextHelper.JA.hiragana(dst) or TextHelper.JA.katakana(dst)) else 0)
                # 原文是日文时，只有译文至少包含一个谚文字符时，判断为错误翻译（漏翻）
                elif self.source_language == Base.Language.KO:
                    data.append(1 if TextHelper.KO.hangeul(dst) else 0)
                # 其他语言时，只要原文译文相同或相似就可以判断为错误翻译（漏翻）
                else:
                    data.append(1)

        return ResponseChecker.Error.UNTRANSLATED if sum(data) >= 1 else None, data