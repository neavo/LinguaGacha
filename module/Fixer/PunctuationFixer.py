from base.BaseLanguage import BaseLanguage

class PunctuationFixer():

    # 数量匹配规则
    RULE_SAME_COUNT_A: dict[str, tuple[str]] = {
        "　": (" ", ),                                      # 全角空格和半角空格之间的转换
        "：": (":", ),
        "・": ("·", ),
        "？": ("?", ),
        "！": ("!", ),
        "\u2014": ("\u002d", "\u2015"),                     # 破折号之间的转换，\u002d = - ，\u2014 = ― ，\u2015 = —
        "\u2015": ("\u002d", "\u2014"),                     # 破折号之间的转换，\u002d = - ，\u2014 = ― ，\u2015 = —
        "<": ("＜", "《"),
        ">": ("＞", "》"),
        "＜": ("<", "《"),
        "＞": (">", "》"),
        "[": ("【", ),
        "]": ("】", ),
        "【": ("[", ),
        "】": ("]", ),
        "(": ("（", ),
        ")": ("）", ),
        "（": ("(", ),
        "）": (")", ),
        "「": ("‘", "“", "『"),
        "」": ("’", "”", "』"),
        "『": ("‘", "“", "「"),
        "』": ("’", "”", "」"),
        "‘": ("“", "「", "『"),
        "’": ("”", "」", "』"),
        "“": ("‘", "「", "『"),
        "”": ("’", "」", "』"),
    }

    # 数量匹配规则
    RULE_SAME_COUNT_B: dict[str, tuple[str]] = {
        " ": ("　", ),                                      # 全角空格和半角空格之间的转换
        ":": ("：", ),
        "·": ("・", ),
        "?": ("？", ),
        "!": ("！", ),
        "\u002d": ("\u2014", "\u2015"),                     # 破折号之间的转换，\u002d = - ，\u2014 = ― ，\u2015 = —
    }

    # 强制替换规则
    # 译文语言为 CJK 语言时，执行此规则
    RULE_FORCE_CJK: dict[str, tuple[str]] = {
        "「": ("“"),
        "」": ("”"),
    }

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(cls, src: str, dst: str, source_language: str, target_language: str) -> str:
        # 首尾标点修正
        dst = cls.fix_start_end(src, dst, target_language)

        # CJK To CJK = A + B
        # CJK To 非CJK = A + B
        # 非CJK To CJK = A
        # 非CJK To 非CJK = A + B
        if BaseLanguage.is_cjk(source_language) and BaseLanguage.is_cjk(target_language):
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)
        elif BaseLanguage.is_cjk(source_language) and not BaseLanguage.is_cjk(target_language):
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)
        elif not BaseLanguage.is_cjk(source_language) and BaseLanguage.is_cjk(target_language):
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
        else:
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
            dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)

        # 译文语言为 CJK 语言时，执行强制规则
        if BaseLanguage.is_cjk(target_language):
            for key, value in cls.RULE_FORCE_CJK.items():
                dst = cls.apply_replace_rules(dst, key, value)

        return dst

    # 检查
    @classmethod
    def check(cls, src: str, dst: str, key: str, value: tuple) -> tuple[str, bool]:
        num_s_x = src.count(key)
        num_s_y = sum(src.count(t) for t in value)
        num_t_x = dst.count(key)
        num_t_y = sum(dst.count(t) for t in value)

        # 首先，原文中的目标符号的数量应大于零，否则表示没有需要修复的标点
        # 然后，原文中目标符号和错误符号的数量不应相等，否则无法确定哪个符号是正确的
        # 然后，原文中的目标符号的数量应大于译文中的目标符号的数量，否则表示没有需要修复的标点
        # 最后，如果原文中目标符号的数量等于译文中目标符号与错误符号的数量之和，则判断为需要修复
        return num_s_x > 0 and num_s_x != num_s_y and num_s_x > num_t_x and num_s_x == num_t_x + num_t_y

    # 应用修复规则
    @classmethod
    def apply_fix_rules(cls, src: str, dst: str, rules: dict) -> str:
        for key, value in rules.items():
            if cls.check(src, dst, key, value) == True:
                dst = cls.apply_replace_rules(dst, key, value)

        return dst

    # 应用替换规则
    @classmethod
    def apply_replace_rules(cls, dst: str, key: str, value: tuple) -> str:
        for t in value:
            dst = dst.replace(t, key)

        return dst

    # 首尾标点修正
    @classmethod
    def fix_start_end(self, src: str, dst: str, target_language: str) -> str:
        # 纠正首尾错误的引号
        if dst.startswith(("'", "\"", "‘", "“", "「", "『")):
            if src.startswith(("「", "『")):
                dst = f"{src[0]}{dst[1:]}"
            elif BaseLanguage.is_cjk(target_language) and src.startswith(("‘", "“")):
                dst = f"{src[0]}{dst[1:]}"
        if dst.endswith(("'", "\"", "’", "”", "」", "』")):
            if src.endswith(("」", "』")):
                dst = f"{dst[:-1]}{src[-1]}"
            elif BaseLanguage.is_cjk(target_language) and src.endswith(("’", "”")):
                dst = f"{dst[:-1]}{src[-1]}"

        # 移除首尾多余的引号
        for v in ("‘", "“", "「", "『"):
            if dst.startswith(v) and not src.startswith(v) and dst.count(v) > src.count(v):
                dst = dst[1:]
                break
        for v in ("’", "”", "」", "』"):
            if dst.endswith(v) and not src.endswith(v) and dst.count(v) > src.count(v):
                dst = dst[:-1]
                break

        return dst