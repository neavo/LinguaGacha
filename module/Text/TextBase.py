class TextBase:

    # 汉字字符（剔除全角标点符号）
    CJK_SET = {
        chr(c)
        for start, end in (
            (0x4E00, 0x9FFF),                           # 基本区
            (0x3400, 0x4DBF),                           # 扩展A区
            (0x20000, 0x2A6DF),                         # 扩展B区
            (0x2A700, 0x2B73F),                         # 扩展C区
            (0x2B740, 0x2B81F),                         # 扩展D区
            (0x2B820, 0x2CEAF),                         # 扩展E区
        )
        for c in range(start, end + 1)
        if not (0xFF01 <= c <= 0xFF60 or 0x3000 <= c <= 0x303F)  # 排除全角标点符号
    }

    # 拉丁字符（剔除半角标点符号）
    LATIN_SET = {
        chr(c)
        for start, end in (
            (0x0041, 0x005A),                           # 大写字母 A-Z
            (0x0061, 0x007A),                           # 小写字母 a-z
            (0x00C0, 0x00FF),                           # 拉丁扩展字符
            (0x0100, 0x017F),                           # 拉丁扩展-A 区
            (0x0180, 0x024F),                           # 拉丁扩展-B 区
        )
        for c in range(start, end + 1)
    }

    # 谚文字符（剔除全角标点符号）
    HANGUL_SET = {
        chr(c)
        for start, end in (
            (0x1100, 0x11FF),                           # 韩文字母 (Hangul Jamo)
            (0xA960, 0xA97F),                           # 韩文字母扩展-A (Hangul Jamo Extended-A)
            (0xD7B0, 0xD7FF),                           # 韩文字母扩展-B (Hangul Jamo Extended-B)
            (0xAC00, 0xD7AF),                           # 韩文音节块 (Hangul Syllables)
            (0x3130, 0x318F),                           # 韩文兼容字母 (Hangul Compatibility Jamo)
        )
        for c in range(start, end + 1)
        if not (0xFF01 <= c <= 0xFF60 or 0x3000 <= c <= 0x303F)  # 排除全角标点符号
    }

    # 平假名（剔除全角标点符号）
    HIRAGANA_SET = {
        chr(c)
        for start, end in (
            (0x3040, 0x309F),                           # 平假名
        )
        for c in range(start, end + 1)
        if not (
            0xFF01 <= c <= 0xFF60                       # 排除全角标点符号
            or 0x3000 <= c <= 0x303F                    # 排除全角标点符号
            or c in (0x309B, 0x309C)                    # 排除 0x309B 濁点 ゛ 0x309C 半濁点 ゜
        )
    }

    # 片假名（剔除全角标点符号）
    KATAKANA_SET = {
        chr(c)
        for start, end in (
            (0x30A0, 0x30FF),                          # 片假名
            (0xFF65, 0xFF9F),                          # 半角片假名（包括半角浊音、半角拗音等）
            (0x31F0, 0x31FF),                          # 片假名语音扩展
        )
        for c in range(start, end + 1)
        if not (
            0xFF01 <= c <= 0xFF60                       # 排除全角标点符号
            or 0x3000 <= c <= 0x303F                    # 排除全角标点符号
            or c in (
                0x30FB,                                 # 排除中点 ・
                0x30FC,                                 # 排除長音符 ー
            )
        )
    }

    # 俄文字符
    RU_SET = {
        chr(c)
        for start, end in (
            (0x0410, 0x044F),                           # 基本俄文字母 (大写字母 А-Я, 小写字母 а-я)
            (0x0500, 0x052F),                           # 俄文字符扩展区（补充字符，包括一些历史字母和其他斯拉夫语言字符）
            (0x2C00, 0x2C5F),                           # 扩展字符 A 区块（历史字母和一些东斯拉夫语言字符）
            (0xA640, 0xA69F),                           # 扩展字符 B 区块（更多历史字母）
            (0x1C80, 0x1C8F),                           # 俄文字符补充字符集，包括一些少见和历史字符
            (0x2DE0, 0x2DFF),                           # 其他扩展字符（例如：斯拉夫语言的一些符号）
        )
        for c in range(start, end + 1)
    }

    # 德文字符 (Latin 扩展 + 特殊字符)
    DE_SET = LATIN_SET | {
        "Ä", "Ö", "Ü", "ä", "ö", "ü", "ß"
    }

    # 法文字符
    FR_SET = LATIN_SET | {
        "à", "á", "â", "ä", "ç", "é", "è", "ê", "ë", "î", "ï", "ô", "ö", "ù", "û", "ü", "ÿ", "œ", "Œ" # 添加 œ 和 Œ
    }

    # 波兰文字符
    PL_SET = LATIN_SET | {
        "ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż",
        "Ą", "Ć", "Ę", "Ł", "Ń", "Ó", "Ś", "Ź", "Ż"
    }

    # 西班牙文字符
    ES_SET = LATIN_SET | {
        "ñ", "á", "é", "í", "ó", "ú", "ü"
    }

    # 意大利文字符
    IT_SET = LATIN_SET | {
        "à", "è", "é", "ì", "ò", "ù"
    }

    # 葡萄牙文字符
    PT_SET = LATIN_SET | {
        "á", "é", "í", "ó", "ú", "ã", "õ", "à", "â", "ê", "ô", "ç"
    }

    # 匈牙利文字符
    HU_SET = LATIN_SET | {
        "á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű"
    }

    # 印尼文字符 (基本上使用拉丁字母)
    ID_SET = LATIN_SET

    # 越南文字符 (Latin 扩展 + 很多变音符号)
    VI_SET = LATIN_SET | {
        chr(c)
        for start, end in (
            (0x1EA0, 0x1EF9),                           # 越南语扩展字符
        )
        for c in range(start, end + 1)
    }

    # 泰文字符
    TH_SET = {
        chr(c)
        for start, end in (
            (0x0E00, 0x0E7F),                           # 泰文字符
            (0x0E50, 0x0E59),                           # 泰文数字
        )
        for c in range(start, end + 1)
    }

    # 判断字符是否属于目标范围
    def char(self, c: str) -> bool:
        pass

    # 判断字符串中是否包含至少一个目标范围的字符
    def any(self, text: str) -> bool:
        return any(self.char(c) for c in text)

    # 判断字符串中是否全部是目标范围的字符
    def all(self, text: str) -> bool:
        return all(self.char(c) for c in text)

    # 移除字符串两边非目标范围的字符
    def strip_non_target(self, text: str) -> str:
        text = text.strip()

        if not text:
            return text

        text_list = list(text)
        start, end = 0, len(text_list) - 1

        while start <= end and not self.char(text_list[start]):
            start += 1

        while end >= start and not self.char(text_list[end]):
            end -= 1

        # 越界检测
        if start > end:
            return ""

        return "".join(text_list[start : end + 1])

# 汉字
class CJK(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.CJK_SET

# 拉丁文
class Latin(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.LATIN_SET

# 日文
class JA(TextBase):
    CJK = CJK()

    def hiragana(self, c: str) -> bool:
        return c in TextBase.HIRAGANA_SET

    def any_hiragana(self, text: str) -> bool:
        return any(self.hiragana(c) for c in text)

    def all_hiragana(self, text: str) -> bool:
        return all(self.hiragana(c) for c in text)

    def katakana(self, c: str) -> bool:
        return c in TextBase.KATAKANA_SET

    def any_katakana(self, text: str) -> bool:
        return any(self.katakana(c) for c in text)

    def all_katakana(self, text: str) -> bool:
        return all(self.katakana(c) for c in text)

    def char(self, c: str) -> bool:
        return self.CJK.char(c) or self.hiragana(c) or self.katakana(c)

# 韩文
class KO(TextBase):
    CJK = CJK()

    def hangeul(self, char: str) -> bool:
        return char in TextBase.HANGUL_SET

    def any_hangeul(self, text: str) -> bool:
        return any(self.hangeul(c) for c in text)

    def all_hangeul(self, text: str) -> bool:
        return all(self.hangeul(c) for c in text)

    def char(self, c: str) -> bool:
        return self.CJK.char(c) or self.hangeul(c)

# 俄文
class RU(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.RU_SET

# 德文
class DE(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.DE_SET

# 法文
class FR(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.FR_SET

# 波兰文
class PL(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.PL_SET

# 西班牙文
class ES(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.ES_SET

# 意大利文
class IT(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.IT_SET

# 葡萄牙文
class PT(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.PT_SET

# 匈牙利文
class HU(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.HU_SET

# 泰文
class TH(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.TH_SET

# 印尼文
class ID(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.ID_SET

# 越南文
class VI(TextBase):
    def char(self, c: str) -> bool:
        return c in TextBase.VI_SET