import math
from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.TextHelper import TextHelper

class ResponseChecker(Base):

    class Error():

        UNKNOWN: str = "未知"
        FAILED: str = "结果数据结构错误"
        LINE_COUNT: str = "结果未通过行数检查"
        UNTRANSLATED: str = "结果中存在没有翻译的条目"

    def __init__(self, config: dict, items: list[CacheItem]) -> None:
        super().__init__()

        # 初始化
        self.items = items
        self.config = config
        self.source_language = self.config.get("source_language")

    def check(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> str:
        # 数据解析失败
        if len(dst_dict) == 0 or all(v == "" or v == None for v in dst_dict.values()):
            return ResponseChecker.Error.FAILED, None

        # 当翻译任务为多条目任务，或者翻译任务为单条目任务，且此条目的重试次数小于等于 3 次时，才进行以下判断
        if len(self.items) > 1 or (len(self.items) == 1 and self.items[0].get_retry_count() <= 3):
            # 行数检查
            if not (
                len(src_dict) == len(dst_dict) # 原文与译文行数一致
                and all(str(key) in dst_dict for key in range(len(dst_dict))) # 译文的 Key 的值为从 0 开始的连续数值字符
            ):
                return ResponseChecker.Error.LINE_COUNT, None

            # 漏翻检查
            error, data = self.chech_untranslated(src_dict, dst_dict)
            if error != None:
                return error, data

        return None, None

    # 漏翻检查
    def chech_untranslated(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> tuple[str | None, list]:
        data = []
        for src, dst in zip(src_dict.values(), dst_dict.values()):
            src = src.strip()
            dst = dst.strip()

            # 判断是否包含或相似
            is_similar = False
            if "[占位符]" in src:
                pass
            elif src in dst or dst in src or TextHelper.check_similarity_by_Jaccard(src, dst) > 0.80:
                is_similar = True

            if is_similar == False:
                data.append(0)
            else:
                # 原文是日文时，只有译文至少包含一个平假名或片假名字符，才判断为漏翻
                if self.source_language == Base.Language.JA:
                    if TextHelper.has_any_hiragana(dst) or TextHelper.has_any_katakanae(dst):
                        data.append(1)
                    else:
                        data.append(0)
                # 原文是韩文时，只有译文至少包含一个谚文字符，才判断为漏翻
                elif self.source_language == Base.Language.KO:
                    if TextHelper.has_any_hangeul(dst):
                        data.append(1)
                    else:
                        data.append(0)
                # 其他语言时，只要原文译文相同或相似就可以判断为漏翻
                else:
                    data.append(1)

        return ResponseChecker.Error.UNTRANSLATED if sum(data) >= 1 else None, data