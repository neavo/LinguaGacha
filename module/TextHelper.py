import re
import json
import unicodedata

class TextHelper:

    # 平假名
    HIRAGANA = ("\u3040", "\u309F")

    # 片假名
    KATAKANA = ("\u30A0", "\u30FF")

    # 半角片假名（包括半角浊音、半角拗音等）
    KATAKANA_HALF_WIDTH = ("\uFF65", "\uFF9F")

    # 片假名语音扩展
    KATAKANA_PHONETIC_EXTENSIONS = ("\u31F0", "\u31FF")

    # 濁音和半浊音符号
    VOICED_SOUND_MARKS = ("\u309B", "\u309C")

    # 韩文字母 (Hangul Jamo)
    HANGUL_JAMO = ("\u1100", "\u11FF")

    # 韩文字母扩展-A (Hangul Jamo Extended-A)
    HANGUL_JAMO_EXTENDED_A = ("\uA960", "\uA97F")

    # 韩文字母扩展-B (Hangul Jamo Extended-B)
    HANGUL_JAMO_EXTENDED_B = ("\uD7B0", "\uD7FF")

    # 韩文音节块 (Hangul Syllables)
    HANGUL_SYLLABLES = ("\uAC00", "\uD7AF")

    # 韩文兼容字母 (Hangul Compatibility Jamo)
    HANGUL_COMPATIBILITY_JAMO = ("\u3130", "\u318F")

    # 中日韩统一表意文字（包括扩展A, B, C, D, E区）
    CJK = ("\u4E00", "\u9FFF")  # 基本区
    CJK_EXT_A = ("\u3400", "\u4DBF")  # 扩展A区
    CJK_EXT_B = ("\u20000", "\u2A6DF")  # 扩展B区
    CJK_EXT_C = ("\u2A700", "\u2B73F")  # 扩展C区
    CJK_EXT_D = ("\u2B740", "\u2B81F")  # 扩展D区
    CJK_EXT_E = ("\u2B820", "\u2CEAF")  # 扩展E区

    # 中日韩通用标点符号
    GENERAL_PUNCTUATION = ("\u2000", "\u206F")
    CJK_SYMBOLS_AND_PUNCTUATION = ("\u3001", "\u303F") # \u3000 是半角空格
    HALFWIDTH_AND_FULLWIDTH_FORMS = ("\uFF00", "\uFFEF")

    # 拉丁字符
    LATIN_1 = ("\u0041", "\u005A") # 大写字母 A-Z
    LATIN_2 = ("\u0061", "\u007A") # 小写字母 a-z
    LATIN_EXTENDED_A = ("\u0100", "\u017F")
    LATIN_EXTENDED_B = ("\u0180", "\u024F")
    LATIN_SUPPLEMENTAL = ("\u00A0", "\u00FF")

    # 拉丁标点符号
    LATIN_PUNCTUATION_BASIC_1 = ("\u0021", "\u002F") # \u0020 是半角空格
    LATIN_PUNCTUATION_BASIC_2 = ("\u003A", "\u0040")
    LATIN_PUNCTUATION_BASIC_3 = ("\u005B", "\u0060")
    LATIN_PUNCTUATION_BASIC_4 = ("\u007B", "\u007E")
    LATIN_PUNCTUATION_GENERAL = ("\u2000", "\u206F")
    LATIN_PUNCTUATION_SUPPLEMENTAL = ("\u2E00", "\u2E7F")

    # 俄文字符
    CYRILLIC_BASIC = ("\u0410", "\u044F")               # 基本俄文字母 (大写字母 А-Я, 小写字母 а-я)
    CYRILLIC_SUPPLEMENT = ("\u0500", "\u052F")          # 俄文字符扩展区（补充字符，包括一些历史字母和其他斯拉夫语言字符）
    CYRILLIC_EXTENDED_A = ("\u2C00", "\u2C5F")          # 扩展字符 A 区块（历史字母和一些东斯拉夫语言字符）
    CYRILLIC_EXTENDED_B = ("\u0300", "\u04FF")          # 扩展字符 B 区块（更多历史字母）
    CYRILLIC_SUPPLEMENTAL = ("\u1C80", "\u1C8F")        # 俄文字符补充字符集，包括一些少见和历史字符
    CYRILLIC_SUPPLEMENTAL_EXTRA = ("\u2DE0", "\u2DFF")  # 其他扩展字符（例如：斯拉夫语言的一些符号）
    CYRILLIC_OTHER = ("\u0500", "\u050F")               # 其他字符区块（包括斯拉夫语系其他语言的字符，甚至一些特殊符号）

    # 不属于标点符号范围但是一般也认为是标点符号
    SPECIAL_PUNCTUATION = (
        "\u00b7", # \u00b7 = ·
        "\u30FB", # \u30FB = ・
        "\u2665", # \u2665 = ♥
    )

    # 判断字符是否为汉字字符
    def is_cjk(char: str) -> bool:
        return (
            TextHelper.CJK[0] <= char <= TextHelper.CJK[1]
            or TextHelper.CJK_EXT_A[0] <= char <= TextHelper.CJK_EXT_A[1]
            or TextHelper.CJK_EXT_B[0] <= char <= TextHelper.CJK_EXT_B[1]
            or TextHelper.CJK_EXT_C[0] <= char <= TextHelper.CJK_EXT_C[1]
            or TextHelper.CJK_EXT_D[0] <= char <= TextHelper.CJK_EXT_D[1]
            or TextHelper.CJK_EXT_E[0] <= char <= TextHelper.CJK_EXT_E[1]
        )

    # 判断字符是否为拉丁字符
    def is_latin(char: str) -> bool:
        return (
            TextHelper.LATIN_1[0] <= char <= TextHelper.LATIN_1[1]
            or TextHelper.LATIN_2[0] <= char <= TextHelper.LATIN_2[1]
            or TextHelper.LATIN_EXTENDED_A[0] <= char <= TextHelper.LATIN_EXTENDED_A[1]
            or TextHelper.LATIN_EXTENDED_B[0] <= char <= TextHelper.LATIN_EXTENDED_B[1]
            or TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[0] <= char <= TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[1]
        )

    # 判断字符是否为谚文字符
    def is_hangeul(char: str) -> bool:
        return (
            TextHelper.HANGUL_JAMO[0] <= char <= TextHelper.HANGUL_JAMO[1]
            or TextHelper.HANGUL_JAMO_EXTENDED_A[0] <= char <= TextHelper.HANGUL_JAMO_EXTENDED_A[1]
            or TextHelper.HANGUL_JAMO_EXTENDED_B[0] <= char <= TextHelper.HANGUL_JAMO_EXTENDED_B[1]
            or TextHelper.HANGUL_SYLLABLES[0] <= char <= TextHelper.HANGUL_SYLLABLES[1]
            or TextHelper.HANGUL_COMPATIBILITY_JAMO[0] <= char <= TextHelper.HANGUL_COMPATIBILITY_JAMO[1]
        )

    # 判断字符是否为韩文字符
    def is_korean(char: str) -> bool:
        return TextHelper.is_cjk(char) or TextHelper.is_hangeul(char)

    # 判断字符是否为平假名
    def is_hiragana(char: str) -> bool:
        return TextHelper.HIRAGANA[0] <= char <= TextHelper.HIRAGANA[1]

    # 判断字符是否为片假名
    def is_katakana(char: str) -> bool:
        return (
            TextHelper.KATAKANA[0] <= char <= TextHelper.KATAKANA[1]
            or TextHelper.KATAKANA_HALF_WIDTH[0] <= char <= TextHelper.KATAKANA_HALF_WIDTH[1]
            or TextHelper.KATAKANA_PHONETIC_EXTENSIONS[0] <= char <= TextHelper.KATAKANA_PHONETIC_EXTENSIONS[1]
        )

    # 判断字符是否为日文字符
    def is_japanese(char: str) -> bool:
        return (
            TextHelper.is_cjk(char)
            or TextHelper.is_hiragana(char)
            or TextHelper.is_katakana(char)
            or TextHelper.VOICED_SOUND_MARKS[0] <= char <= TextHelper.VOICED_SOUND_MARKS[1]
        )

    # 判断字符是否为俄文字符
    def is_russian(char: str) -> bool:
        return (
            TextHelper.CYRILLIC_BASIC[0] <= char <= TextHelper.CYRILLIC_BASIC[1]
            or TextHelper.CYRILLIC_SUPPLEMENT[0] <= char <= TextHelper.CYRILLIC_SUPPLEMENT[1]
            or TextHelper.CYRILLIC_EXTENDED_A[0] <= char <= TextHelper.CYRILLIC_EXTENDED_A[1]
            or TextHelper.CYRILLIC_EXTENDED_B[0] <= char <= TextHelper.CYRILLIC_EXTENDED_B[1]
            or TextHelper.CYRILLIC_SUPPLEMENTAL[0] <= char <= TextHelper.CYRILLIC_SUPPLEMENTAL[1]
            or TextHelper.CYRILLIC_SUPPLEMENTAL_EXTRA[0] <= char <= TextHelper.CYRILLIC_SUPPLEMENTAL_EXTRA[1]
            or TextHelper.CYRILLIC_OTHER[0] <= char <= TextHelper.CYRILLIC_OTHER[1]
        )

    # 判断一个字符是否是标点符号
    def is_punctuation(char: str) -> bool:
        return TextHelper.is_cjk_punctuation(char) or TextHelper.is_latin_punctuation(char) or TextHelper.is_special_punctuation(char)

    # 判断一个字符是否是汉字标点符号
    def is_cjk_punctuation(char: str) -> bool:
        return (
            TextHelper.GENERAL_PUNCTUATION[0] <= char <= TextHelper.GENERAL_PUNCTUATION[1]
            or TextHelper.CJK_SYMBOLS_AND_PUNCTUATION[0] <= char <= TextHelper.CJK_SYMBOLS_AND_PUNCTUATION[1]
            or TextHelper.HALFWIDTH_AND_FULLWIDTH_FORMS[0] <= char <= TextHelper.HALFWIDTH_AND_FULLWIDTH_FORMS[1]
        )

    # 判断一个字符是否是拉丁标点符号
    def is_latin_punctuation(char: str) -> bool:
        return (
            TextHelper.LATIN_PUNCTUATION_BASIC_1[0] <= char <= TextHelper.LATIN_PUNCTUATION_BASIC_1[1]
            or TextHelper.LATIN_PUNCTUATION_BASIC_2[0] <= char <= TextHelper.LATIN_PUNCTUATION_BASIC_2[1]
            or TextHelper.LATIN_PUNCTUATION_BASIC_3[0] <= char <= TextHelper.LATIN_PUNCTUATION_BASIC_3[1]
            or TextHelper.LATIN_PUNCTUATION_BASIC_4[0] <= char <= TextHelper.LATIN_PUNCTUATION_BASIC_4[1]
            or TextHelper.LATIN_PUNCTUATION_GENERAL[0] <= char <= TextHelper.LATIN_PUNCTUATION_GENERAL[1]
            or TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[0] <= char <= TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[1]
        )

    # 判断一个字符是否是特殊标点符号
    def is_special_punctuation(char: str) -> bool:
        return char in TextHelper.SPECIAL_PUNCTUATION

    # 检查字符串是否包含至少一个汉字字符
    def has_any_cjk(text: str) -> bool:
        return any(TextHelper.is_cjk(char) for char in text)

    # 检查字符串是否包含至少一个拉丁字符
    def has_any_latin(text: str) -> bool:
        return any(TextHelper.is_latin(char) for char in text)

    # 检查字符串是否包含至少一个谚文字符
    def has_any_hangeul(text: str) -> bool:
        return any(TextHelper.is_hangeul(char) for char in text)

    # 检查字符串是否包含至少一个韩文字符（含汉字字符）
    def has_any_korean(text: str) -> bool:
        return any(TextHelper.is_korean(char) for char in text)

    # 检查字符串是否包含至少一个平假名
    def has_any_hiragana(text: str) -> bool:
        return any(TextHelper.is_hiragana(char) for char in text)

    # 检查字符串是否包含至少一个片假名
    def has_any_katakanae(text: str) -> bool:
        return any(TextHelper.is_katakana(char) for char in text)

    # 检查字符串是否包含至少一个日文字符（含汉字字符）
    def has_any_japanese(text: str) -> bool:
        return any(TextHelper.is_japanese(char) for char in text)

    # 检查字符串是否包含至少一个俄文字符
    def has_any_russian(text: str) -> bool:
        return any(TextHelper.is_russian(char) for char in text)

    # 检查字符串是否包含至少一个标点符号
    def has_any_punctuation(text: str) -> bool:
        return any(TextHelper.is_punctuation(char) for char in text)

    # 判断输入的字符串是否全部为汉字字符
    def is_all_cjk(text: str) -> bool:
        return all(TextHelper.is_cjk(char) for char in text)

    # 判断输入的字符串是否全部为拉丁字符
    def is_all_latin(text: str) -> bool:
        return all(TextHelper.is_latin(char) for char in text)

    # 判断输入的字符串是否全部为谚文字符
    def is_all_hangeul(text: str) -> bool:
        return all(TextHelper.is_all_hangeul(char) for char in text)

    # 判断输入的字符串是否全部为韩文字符（含汉字字符）
    def is_all_korean(text: str) -> bool:
        return all(TextHelper.is_korean(char) for char in text)

    # 判断字符串是否全部为平假名字符
    def is_all_hiragana(text: str) -> bool:
        return all(TextHelper.is_hiragana(char) for char in text)

    # 判断字符串是否全部为片假名字符
    def is_all_katakana(text: str) -> bool:
        return all(TextHelper.is_katakana(char) for char in text)

    # 判断输入的字符串是否全部为日文字符（含汉字字符）
    def is_all_japanese(text: str) -> bool:
        return all(TextHelper.is_japanese(char) for char in text)

    # 判断输入的字符串是否全部为俄文字符
    def is_all_russian(text: str) -> bool:
        return all(TextHelper.is_russian(char) for char in text)

    # 判断输入的字符串是否全部为标点符号
    def is_all_punctuation(text: str) -> bool:
        return all(TextHelper.is_punctuation(char) for char in text)

    # 移除开头结尾的非汉字字符
    def strip_not_cjk(text: str) -> str:
        text = text.strip()

        while text and not TextHelper.is_cjk(text[0]):
            text = text[1:]

        while text and not TextHelper.is_cjk(text[-1]):
            text = text[:-1]

        return text.strip()

    # 移除开头结尾的非拉丁字符
    def strip_not_latin(text: str) -> str:
        text = text.strip()

        while text and not TextHelper.is_latin(text[0]):
            text = text[1:]

        while text and not TextHelper.is_latin(text[-1]):
            text = text[:-1]

        return text.strip()

    # 移除开头结尾的非韩文字符
    def strip_not_korean(text: str) -> str:
        text = text.strip()

        while text and not TextHelper.is_korean(text[0]):
            text = text[1:]

        while text and not TextHelper.is_korean(text[-1]):
            text = text[:-1]

        return text.strip()

    # 移除开头结尾的非日文字符
    def strip_not_japanese(text: str) -> str:
        text = text.strip()

        while text and not TextHelper.is_japanese(text[0]):
            text = text[1:]

        while text and not TextHelper.is_japanese(text[-1]):
            text = text[:-1]

        return text.strip()

    # 移除开头结尾的标点符号
    def strip_punctuation(text: str) -> str:
        text = text.strip()

        while text and TextHelper.is_punctuation(text[0]):
            text = text[1:]

        while text and TextHelper.is_punctuation(text[-1]):
            text = text[:-1]

        return text.strip()

    # 移除开头结尾的阿拉伯数字
    def strip_arabic_numerals(text: str) -> str:
        return re.sub(r"^\d+|\d+$", "", text)

    # 按标点符号分割字符串
    def split_by_punctuation(text: str, split_by_space: bool) -> list[str]:
        if split_by_space == False:
            return re.split(""
                + r"["
                + rf"{TextHelper.GENERAL_PUNCTUATION[0]}-{TextHelper.GENERAL_PUNCTUATION[1]}"
                + rf"{TextHelper.CJK_SYMBOLS_AND_PUNCTUATION[0]}-{TextHelper.CJK_SYMBOLS_AND_PUNCTUATION[1]}"
                + rf"{TextHelper.HALFWIDTH_AND_FULLWIDTH_FORMS[0]}-{TextHelper.HALFWIDTH_AND_FULLWIDTH_FORMS[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_1[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_1[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_2[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_2[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_3[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_3[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_4[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_4[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_GENERAL[0]}-{TextHelper.LATIN_PUNCTUATION_GENERAL[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[0]}-{TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[1]}"
                + rf"{"".join(TextHelper.SPECIAL_PUNCTUATION)}"
                + r"]+",
                text,
            )
        else:
            return re.split(""
                + r"["
                + rf"{TextHelper.GENERAL_PUNCTUATION[0]}-{TextHelper.GENERAL_PUNCTUATION[1]}"
                + rf"{TextHelper.CJK_SYMBOLS_AND_PUNCTUATION[0]}-{TextHelper.CJK_SYMBOLS_AND_PUNCTUATION[1]}"
                + rf"{TextHelper.HALFWIDTH_AND_FULLWIDTH_FORMS[0]}-{TextHelper.HALFWIDTH_AND_FULLWIDTH_FORMS[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_1[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_1[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_2[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_2[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_3[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_3[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_BASIC_4[0]}-{TextHelper.LATIN_PUNCTUATION_BASIC_4[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_GENERAL[0]}-{TextHelper.LATIN_PUNCTUATION_GENERAL[1]}"
                + rf"{TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[0]}-{TextHelper.LATIN_PUNCTUATION_SUPPLEMENTAL[1]}"
                + rf"{"".join(TextHelper.SPECIAL_PUNCTUATION)}"
                + r"\u0020\u3000" # \u0020 = 半角空格 \u3000 = 全角空格
                + r"]+",
                text,
            )

    # 计算字符串的实际显示长度
    def get_display_lenght(text: str) -> int:
        # unicodedata.east_asian_width(c) 返回字符 c 的东亚洲宽度属性。
        # NaH 表示窄（Narrow）、中立（Neutral）和半宽（Halfwidth）字符，这些字符通常被认为是半角字符。
        # 其他字符（如全宽字符）的宽度属性为 W 或 F，这些字符被认为是全角字符。
        return sum(1 if unicodedata.east_asian_width(c) in "NaH" else 2 for c in text)

    # 安全加载 JSON 字典
    def safe_load_json_dict(json_str: str) -> dict:
        result = {}

        # 移除首尾空白符（含空格、制表符、换行符）
        json_str = json_str.strip()

        # 移除代码标识
        json_str = json_str.removeprefix("```json").removeprefix("```").strip()

        # 先尝试使用 json.loads 解析
        try:
            result = json.loads(json_str)
        except Exception:
            pass

        # 否则使用正则表达式匹配
        if len(result) == 0 or not isinstance(result, dict):
            result = {}
            for item in re.findall(r"['\"].+?['\"]\s*\:\s*['\"].+?['\"]\s*(?=[,}])", json_str, flags = re.IGNORECASE):
                p = item.split(":")
                result[p[0].strip().strip("'\"").strip()] = p[1].strip().strip("'\"").strip()

        return result if isinstance(result, dict) else {}

    # 安全加载 JSON 列表
    def safe_load_json_list(json_str: str) -> list:
        result = []

        # 移除首尾空白符（含空格、制表符、换行符）
        json_str = json_str.strip()

        # 移除代码标识
        json_str = json_str.removeprefix("```json").removeprefix("```").strip()

        # 先尝试使用 json.loads 解析
        try:
            result = json.loads(json_str)
        except Exception:
            pass

        # 否则使用正则表达式匹配
        if len(result) == 0 or not isinstance(result, list):
            result = []
            for item in re.findall(r"\{.+?\}", json_str, flags = re.IGNORECASE):
                result.append(TextHelper.safe_load_json_dict(item))

        return result if isinstance(result, list) else {}