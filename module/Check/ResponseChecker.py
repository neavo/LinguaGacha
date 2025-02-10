import math
from base.Base import Base
from module.TextHelper import TextHelper

class ResponseChecker(Base):

    class Error():

        UNKNOWN: str = "未知"
        NONE: str = "没有有效数据"
        EMPTY_LINE: str = "译文包含空行"
        LINE_COUNT: str = "未通过行数检查"
        UNTRANSLATED: str = "部分条目可能没有翻译"

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config = config

        # 计算轮数阈值，即在此轮次及后续轮次，任务一定是单条目任务
        self.round_threshold = math.ceil(math.log(config.get("task_token_limit"), 2))

    def check(self, src_dict: dict[str, str], dst_dict: dict[str, str], current_round: int) -> str:
        # 没有有效数据
        if len(dst_dict) == 0:
            return ResponseChecker.Error.NONE, None

        # 译文包含空行
        # if any(v == "" or v == None for v in dst_dict.values()):
        #     return ResponseChecker.Error.EMPTY_LINE, None

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

    # 部分条目可能没有翻译
    def chech_untranslated(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> str:
        data = []
        for src, dst in zip(src_dict.values(), dst_dict.values()):
            if src.strip() == dst.strip() and "[占位符]" not in src:
                # 获取原文语言
                source_language = self.config.get("source_language")

                # 原文是日文时，只有至少包含一个平假名或片假名字符，才判断为漏翻
                if source_language == Base.Language.JA:
                    if TextHelper.has_any_hiragana(src) or TextHelper.has_any_katakanae(src):
                        data.append(1)
                    else:
                        data.append(0)
                # 原文是韩文时，只有至少包含一个谚文字符，才判断为漏翻
                elif source_language == Base.Language.KO:
                    if TextHelper.has_any_hiragana(src):
                        data.append(1)
                    else:
                        data.append(0)
                # 其他语言时，只要原文译文相同就可以判断为漏翻
                else:
                    data.append(1)
            else:
                data.append(0)

        return ResponseChecker.Error.UNTRANSLATED if sum(data) >= 1 else None, data