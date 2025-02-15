import math
from base.Base import Base
from module.TextHelper import TextHelper

class ResponseChecker(Base):

    class Error():

        UNKNOWN: str = "未知"
        NONE: str = "结果数据结构错误"
        LINE_COUNT: str = "结果未通过行数检查"
        UNTRANSLATED: str = "结果中部分条目可能没有翻译"

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config = config

        # 计算轮数阈值，即在此轮次及后续轮次，任务一定是单条目任务
        self.round_threshold = math.ceil(math.log(config.get("task_token_limit"), 2))

    def check(self, src_dict: dict[str, str], dst_dict: dict[str, str], current_round: int) -> str:
        # 数据解析失败
        if len(dst_dict) == 0 or all(v == "" or v == None for v in dst_dict.values()):
            return ResponseChecker.Error.NONE, None

        # 未通过行数检查
        if not (
            len(src_dict) == len(dst_dict) # 原文与译文行数一致
            and all(str(key) in dst_dict for key in range(len(dst_dict))) # 译文的 Key 的值为从 0 开始的连续数值字符
        ):
            return ResponseChecker.Error.LINE_COUNT, None

        # 部分条目中原文译文相似
        if len(dst_dict) > 1 and current_round <= self.round_threshold:
            return self.chech_untranslated(src_dict, dst_dict)

        return None, None

    # 计算 Jaccard 相似度
    def check_similarity_by_Jaccard(self, x: str, y: str) -> float:
        set_x = set(x.split())
        set_y = set(y.split())

        # 求并集
        union = len(set_x | set_y)

        # 求交集
        intersection = len(set_x & set_y)

        # 计算并返回相似度，完全一致是 1，完全不同是 0
        return intersection / union if union > 0 else 0.0

    # 部分条目可能没有翻译
    def chech_untranslated(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> str:
        data = []
        for src, dst in zip(src_dict.values(), dst_dict.values()):
            src = src.strip()
            dst = dst.strip()
            source_language = self.config.get("source_language")

            # 针对占位符、短文本、长文本分别使用不同策略判断是否相同或相似
            is_similar  = False
            if "[占位符]" in src:
                pass
            elif src == dst and TextHelper.get_display_lenght(src) < 10:
                is_similar = True
            elif self.check_similarity_by_Jaccard(src, dst) > 0.80 and TextHelper.get_display_lenght(src) >= 10:
                is_similar = True

            if is_similar == False:
                data.append(0)
            else:
                # 原文是日文时，只有至少包含一个平假名或片假名字符，才判断为漏翻
                if source_language == Base.Language.JA:
                    if TextHelper.has_any_hiragana(src) or TextHelper.has_any_katakanae(src):
                        data.append(1)
                    else:
                        data.append(0)
                # 原文是韩文时，只有至少包含一个谚文字符，才判断为漏翻
                elif source_language == Base.Language.KO:
                    if TextHelper.has_any_hangeul(src):
                        data.append(1)
                    else:
                        data.append(0)
                # 其他语言时，只要原文译文相同或相似就可以判断为漏翻
                else:
                    data.append(1)

        return ResponseChecker.Error.UNTRANSLATED if sum(data) >= 1 else None, data