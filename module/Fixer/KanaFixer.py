from module.Text.TextHelper import TextHelper

class KanaFixer():

    # 拟声词
    RULE_ONOMATOPOEIA = (
        "ッ",
        "っ",
        "ぁ",
        "ぃ",
        "ぅ",
        "ぇ",
        "ぉ",
        "ゃ",
        "ゅ",
        "ょ",
        "ゎ",
    )

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(cls, dst: str) -> str:
        # 将字符串转换为列表，方便逐个处理字符
        result = []
        length = len(dst)

        for i, char in enumerate(dst):
            if char in KanaFixer.RULE_ONOMATOPOEIA:
                # 检查前后字符是否为假名
                prev_char = dst[i - 1] if i > 0 else None
                next_char = dst[i + 1] if i < length - 1 else None

                is_prev_kana = prev_char is not None and (TextHelper.JA.hiragana(prev_char) or TextHelper.JA.katakana(prev_char))
                is_next_kana = next_char is not None and (TextHelper.JA.hiragana(next_char) or TextHelper.JA.katakana(next_char))

                # 如果前后字符中有假名，则保留当前字符
                if is_prev_kana == True or is_next_kana == True :
                    result.append(char)
            else:
                # 非拟声词字符直接保留
                result.append(char)

        # 将列表转换回字符串
        return "".join(result)
