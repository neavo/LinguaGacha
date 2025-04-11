import re
import unicodedata

from module.Text import TextBase

class TextHelper:

    # 汉字标点符号（CJK）
    CJK_PUNCTUATION_SET = {
        chr(char)
        for start, end in (
            (0x3001, 0x303F),                           # CJK标点（排除全角空格0x3000）
            (0xFF01, 0xFF0F),                           # 全角标点（！＂＃＄％＆＇（）＊＋，－．／）
            (0xFF1A, 0xFF1F),                           # 全角标点（：；＜＝＞？）
            (0xFF3B, 0xFF40),                           # 全角标点（［＼］＾＿｀）
            (0xFF5B, 0xFF65),                           # 全角标点（｛｜｝～｟｠）
            (0xFFE0, 0xFFEE),                           # 补充全角符号（￠￡￢￣￤￨等）
        )
        for char in range(start, end + 1)
    }

    # 拉丁标点符号
    LATIN_PUNCTUATION_SET = {
        chr(char)
        for start, end in (
            (0x0021, 0x002F),                           # 基本拉丁标点（!"#$%&'()*+,-./）
            (0x003A, 0x0040),                           # 基本拉丁标点（:;<=>?@）
            (0x005B, 0x0060),                           # 基本拉丁标点（[\]^_`）
            (0x007B, 0x007E),                           # 基本拉丁标点（{|}~）
            (0x2000, 0x206F),                           # 通用标点符号（含引号、破折号等）
            (0x2E00, 0x2E7F),                           # 补充标点符号（双引号、括号等）
            (0x2010, 0x2027),                           # 连字符、破折号、引号等
            (0x2030, 0x205E),                           # 千分比符号、引号等
        )
        for char in range(start, end + 1)
    }

    # 特殊符号(不属于标点符号范围但是当作标点符号处理)
    SPECIAL_PUNCTUATION_SET = {
        chr(0x00b7),                                    # ·
        chr(0x30FB),                                    # ・
        chr(0x2665),                                    # ♥
    }

    CJK = TextBase.CJK()                                # 汉字
    Latin = TextBase.Latin()                            # 拉丁文
    JA = TextBase.JA()                                  # 日文 (Japanese)
    KO = TextBase.KO()                                  # 韩文 (Korean)
    RU = TextBase.RU()                                  # 阿拉伯文 (Russian)
    AR = TextBase.AR()                                  # 俄文 (Arabic)
    DE = TextBase.DE()                                  # 德文 (German)
    FR = TextBase.FR()                                  # 法文 (French)
    PL = TextBase.PL()                                  # 法文 (French)
    ES = TextBase.ES()                                  # 西班牙文 (Spanish)
    IT = TextBase.IT()                                  # 意大利文 (Italian)
    PT = TextBase.PT()                                  # 葡萄牙文 (Portuguese)
    HU = TextBase.HU()                                  # 匈牙利文 (Hungrarian)
    TR = TextBase.TR()                                  # 土耳其文 (Turkish)
    TH = TextBase.TH()                                  # 泰文 (Thai)
    ID = TextBase.ID()                                  # 印尼文 (Indonesian)
    VI = TextBase.VI()                                  # 越南文 (Vietnamese)

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
    def check_similarity_by_jaccard(x: str, y: str) -> float:
        set_x = set(x)
        set_y = set(y)

        # 求并集
        union = len(set_x | set_y)

        # 求交集
        intersection = len(set_x & set_y)

        # 计算并返回相似度，完全一致是 1，完全不同是 0
        return intersection / union if union > 0 else 0.0