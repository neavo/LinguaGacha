class TextBase:

    # 汉字字符
    CJK_SET = {
        chr(char)
        for start, end in (
            (0x4E00, 0x9FFF),                           # 基本区
            (0x3400, 0x4DBF),                           # 扩展A区
            (0x20000, 0x2A6DF),                         # 扩展B区
            (0x2A700, 0x2B73F),                         # 扩展C区
            (0x2B740, 0x2B81F),                         # 扩展D区
            (0x2B820, 0x2CEAF),                         # 扩展E区
        )
        for char in range(start, end + 1)
    }

    # 拉丁字符
    LATIN_SET = {
        chr(char)
        for start, end in (
            (0x0020, 0x00FF),                           # 从 \u0020 开始，排除控制字符
            (0x0100, 0x017F),                           # 拉丁扩展-A 区（包括带有重音的字母）
            (0x0180, 0x024F),                           # 拉丁扩展-B 区（更多带有重音和其他变体的字母）
        )
        for char in range(start, end + 1)
    }

    # 谚文字符
    HANGUL_SET = {
        chr(char)
        for start, end in (
            (0x1100, 0x11FF),                           # 韩文字母 (Hangul Jamo)
            (0xA960, 0xA97F),                           # 韩文字母扩展-A (Hangul Jamo Extended-A)
            (0xD7B0, 0xD7FF),                           # 韩文字母扩展-B (Hangul Jamo Extended-B)
            (0xAC00, 0xD7AF),                           # 韩文音节块 (Hangul Syllables)
            (0x3130, 0x318F),                           # 韩文兼容字母 (Hangul Compatibility Jamo)
        )
        for char in range(start, end + 1)
    }

    # 平假名
    HIRAGANA_SET = {
        chr(char)
        for start, end in (
            (0x3040, 0x309F),                           # 平假名
        )
        for char in range(start, end + 1)
    }

    # 片假名
    KATAKANA_SET = {
        chr(char)
        for start, end in (
            (0x30A0, 0x30FF),                          # 片假名
            (0xFF65, 0xFF9F),                          # 半角片假名（包括半角浊音、半角拗音等）
            (0x31F0, 0x31FF),                          # 片假名语音扩展
        )
        for char in range(start, end + 1)
    }

    # 濁音和半浊音符号
    JA_VOICED_SOUND_MARKS_SET = {
        chr(0x309B),
        chr(0x309C),
    }

    # 俄文字符
    RU_SET = {
        chr(char)
        for start, end in (
            (0x0410, 0x044F),                           # 基本俄文字母 (大写字母 А-Я, 小写字母 а-я)
            (0x0500, 0x052F),                           # 俄文字符扩展区（补充字符，包括一些历史字母和其他斯拉夫语言字符）
            (0x2C00, 0x2C5F),                           # 扩展字符 A 区块（历史字母和一些东斯拉夫语言字符）
            (0xA640, 0xA69F),                           # 扩展字符 B 区块（更多历史字母）
            (0x1C80, 0x1C8F),                           # 俄文字符补充字符集，包括一些少见和历史字符
            (0x2DE0, 0x2DFF),                           # 其他扩展字符（例如：斯拉夫语言的一些符号）
        )
        for char in range(start, end + 1)
    }

    # 德文字符 (Latin 扩展 + 特殊字符)
    DE_SET = LATIN_SET | {
        "Ä", "Ö", "Ü", "ä", "ö", "ü", "ß"
    }

    # 印尼文字符 (基本上使用拉丁字母)
    ID_SET = LATIN_SET

    # 越南文字符 (Latin 扩展 + 很多变音符号)
    VI_SET = LATIN_SET | {
        chr(char)
        for start, end in (
            (0x1EA0, 0x1EF9),                           # 越南语扩展字符
        )
        for char in range(start, end + 1)
    }

    # 判断字符是否属于目标范围
    def char(self, char: str) -> bool:
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
    def char(self, char: str) -> bool:
        return char in TextBase.CJK_SET

# 拉丁文
class Latin(TextBase):
    def char(self, char: str) -> bool:
        return char in TextBase.LATIN_SET

# 日文
class JA(TextBase):
    CJK = CJK()

    def hiragana(self, char: str) -> bool:
        return char in TextBase.HIRAGANA_SET

    def katakana(self, char: str) -> bool:
        return char in TextBase.KATAKANA_SET

    def char(self, char: str) -> bool:
        return self.CJK.char(char) or self.hiragana(char) or self.katakana(char) or char in TextBase.JA_VOICED_SOUND_MARKS_SET

# 韩文
class KO(TextBase):
    CJK = CJK()

    def hangeul(self, char: str) -> bool:
        return char in TextBase.HANGUL_SET

    def char(self, char: str) -> bool:
        return self.CJK.char(char) or self.hangeul(char)

# 俄文
class RU(TextBase):
    def char(self, char: str) -> bool:
        return char in TextBase.RU_SET

# 德文
class DE(TextBase):
    def char(self, char: str) -> bool:
        return char in TextBase.DE_SET


# 印尼文
class ID(TextBase):
    def char(self, char: str) -> bool:
        return char in TextBase.ID_SET


# 越南文
class VI(TextBase):
    def char(self, char: str) -> bool:
        return char in TextBase.VI_SET
