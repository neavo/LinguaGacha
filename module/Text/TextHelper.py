import re
import unicodedata

from module.Text import TextBase

class TextHelper:

    # 汉字标点符号
    CJK_PUNCTUATION_SET = {
        chr(char)
        for start, end in (
            (0x2000, 0x206F),
            (0x3001, 0x303F),                           # 0x3000 是半角空格
            (0xFF00, 0xFFEF),
        )
        for char in range(start, end + 1)
    }

    # 拉丁标点符号
    LATIN_PUNCTUATION_SET = {
        chr(char)
        for start, end in (
            (0x0021, 0x002F),                           # 0x0020 是半角空格
            (0x003A, 0x0040),
            (0x005B, 0x0060),
            (0x007B, 0x007E),
            (0x2000, 0x206F),
            (0x2E00, 0x2E7F),
        )
        for char in range(start, end + 1)
    }

    # 不属于标点符号范围但是一般也认为是标点符号
    SPECIAL_PUNCTUATION_SET = {
        chr(0x00b7),                                    # ·
        chr(0x30FB),                                    # ・
        chr(0x2665),                                    # ♥
    }

    # 汉字
    CJK = TextBase.CJK()

    # 拉丁文
    Latin = TextBase.Latin()

    # 日文
    JA = TextBase.JA()

    # 韩文
    KO = TextBase.KO()

    # 俄文
    RU = TextBase.RU()

    # 德文
    DE = TextBase.DE()

    # 印尼文
    ID = TextBase.ID()

    # 越南文
    VI = TextBase.VI()

    # 判断一个字符是否是标点符号
    def is_punctuation(char: str) -> bool:
        return TextHelper.is_cjk_punctuation(char) or TextHelper.is_latin_punctuation(char) or TextHelper.is_special_punctuation(char)

    # 判断一个字符是否是汉字标点符号
    def is_cjk_punctuation(char: str) -> bool:
        return char in TextHelper.CJK_PUNCTUATION_SET

    # 判断一个字符是否是拉丁标点符号
    def is_latin_punctuation(char: str) -> bool:
        return char in TextHelper.LATIN_PUNCTUATION_SET

    # 判断一个字符是否是特殊标点符号
    def is_special_punctuation(char: str) -> bool:
        return char in TextHelper.SPECIAL_PUNCTUATION_SET

    # 判断输入的字符串是否包含至少一个标点符号
    def any_punctuation(text: str) -> bool:
        return any(TextHelper.is_punctuation(char) for char in text)

    # 判断输入的字符串是否全部为标点符号
    def all_punctuation(text: str) -> bool:
        return all(TextHelper.is_punctuation(char) for char in text)

    # 移除开头结尾的标点符号
    def strip_punctuation(text: str) -> str:
        text = text.strip()

        if not text:
            return text

        text_list = list(text)
        start, end = 0, len(text_list) - 1

        # 移除开头的标点符号
        while start <= end and TextHelper.is_punctuation(text_list[start]):
            start += 1

        # 移除结尾的标点符号
        while end >= start and TextHelper.is_punctuation(text_list[end]):
            end -= 1

        # 越界检测
        if start > end:
            return ""

        return "".join(text_list[start : end + 1])

    # 移除开头结尾的阿拉伯数字
    def strip_arabic_numerals(text: str) -> str:
        return re.sub(r"^\d+|\d+$", "", text)

    # 按标点符号分割字符串
    def split_by_punctuation(text: str, split_by_space: bool) -> list[str]:
        result: list[str] = []
        current_segment: list[str] = []

        for char in text:
            if TextHelper.is_punctuation(char) or (split_by_space and char in (0x0020, 0x3000)):
                if current_segment != []:
                    result.append("".join(current_segment))
                    current_segment = []
            else:
                current_segment.append(char)

        if current_segment != []:
            result.append("".join(current_segment))

        # 只返回非空结果
        return [segment for segment in result if segment]

    # 计算字符串的实际显示长度
    def get_display_lenght(text: str) -> int:
        # unicodedata.east_asian_width(c) 返回字符 c 的东亚洲宽度属性。
        # NaH 表示窄（Narrow）、中立（Neutral）和半宽（Halfwidth）字符，这些字符通常被认为是半角字符。
        # 其他字符（如全宽字符）的宽度属性为 W 或 F，这些字符被认为是全角字符。
        return sum(1 if unicodedata.east_asian_width(c) in "NaH" else 2 for c in text)

    # 计算 Jaccard 相似度
    def check_similarity_by_Jaccard(x: str, y: str) -> float:
        set_x = set(x)
        set_y = set(y)

        # 求并集
        union = len(set_x | set_y)

        # 求交集
        intersection = len(set_x & set_y)

        # 计算并返回相似度，完全一致是 1，完全不同是 0
        return intersection / union if union > 0 else 0.0