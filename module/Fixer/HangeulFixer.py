from base.Base import Base
from module.Text.TextHelper import TextHelper

class HangeulFixer(Base):

    # 拟声词
    RULE_ONOMATOPOEIA = (
        "뿅",
        "슝",
        "쩝",
        "콕",
        "끙",
        "힝",
    )

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    def fix(self, dst: str) -> str:
        # 将字符串转换为列表，方便逐个处理字符
        result = []
        length = len(dst)

        for i, char in enumerate(dst):
            if char in HangeulFixer.RULE_ONOMATOPOEIA:
                # 检查前后字符是否为假名
                prev_char = dst[i - 1] if i > 0 else None
                next_char = dst[i + 1] if i < length - 1 else None

                is_prev_hangeul = prev_char is not None and TextHelper.KO.hangeul(prev_char)
                is_next_hangeul = next_char is not None and TextHelper.KO.hangeul(next_char)

                # 如果前后字符中有谚文，则保留当前字符
                if is_prev_hangeul == True or is_next_hangeul == True :
                    result.append(char)
            else:
                # 非拟声词字符直接保留
                result.append(char)

        # 将列表转换回字符串
        return "".join(result)
