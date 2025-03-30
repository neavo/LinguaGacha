import re

from base.BaseLanguage import BaseLanguage

class PunctuationFixer():

    # 数量一致才执行的规则 - A区
    RULE_SAME_COUNT_A = {
        "　": (" ", ),                                      # 全角空格和半角空格之间的转换
        "：": (":", ),
        "・": ("·", ),
        "？": ("?", ),
        "！": ("!", ),
        "\u2014": ("\u002d", "\u2015"),                     # 破折号之间的转换，\u002d = - ，\u2014 = ― ，\u2015 = —
        "\u2015": ("\u002d", "\u2014"),                     # 破折号之间的转换，\u002d = - ，\u2014 = ― ，\u2015 = —
        "＜": ("<", "《"),
        "＞": (">", "》"),
        "「": ("‘", "“", "『"),
        "」": ("’", "”", "』"),
        "『": ("‘", "“", "「"),
        "』": ("’", "”", "」"),
        "（": ("(", "「", "‘", "“"),
        "）": (")", "」", "’", "”"),
    }

    # 数量一致才执行的规则 - B区
    RULE_SAME_COUNT_B = {
        " ": ("　", ),                                      # 全角空格和半角空格之间的转换
        ":": ("：", ),
        "·": ("・", ),
        "?": ("？", ),
        "!": ("！", ),
        "\u002d": ("\u2014", "\u2015"),                     # 破折号之间的转换，\u002d = - ，\u2014 = ― ，\u2015 = —
        "<": ("＜", "《"),
        ">": ("＞", "》"),
        "(": ("（", "「", "‘", "“"),
        ")": ("）", "」", "’", "”"),
    }

    # 正则规则
    RULE_REGEX_CJK = [
        {
            "source_language_tuple" : None,
            "target_language_tuple" : None,
            "regex_src": re.compile(r"^「.*」$", flags = re.IGNORECASE),
            "regex_dst": None,
            "regex_repl": re.compile(r"^\"(.*)\"$", flags = re.IGNORECASE),
            "repl": r"「\1」",
        },
        {
            "source_language_tuple" : None,
            "target_language_tuple" : None,
            "regex_src": re.compile(r"^『.*』$", flags = re.IGNORECASE),
            "regex_dst": None,
            "regex_repl": re.compile(r"^\"(.*)\"$", flags = re.IGNORECASE),
            "repl": r"『\1』",
        },
        {
            "source_language_tuple" : None,
            "target_language_tuple" : (BaseLanguage.ZH, BaseLanguage.JA, BaseLanguage.KO),
            "regex_src": re.compile(r"^“.*”$", flags = re.IGNORECASE),
            "regex_dst": None,
            "regex_repl": re.compile(r"^\"(.*)\"$", flags = re.IGNORECASE),
            "repl": r"“\1”",
        },
        {
            "source_language_tuple" : None,
            "target_language_tuple" : (BaseLanguage.ZH, BaseLanguage.JA, BaseLanguage.KO),
            "regex_src": re.compile(r"^‘.*’$", flags = re.IGNORECASE),
            "regex_dst": None,
            "regex_repl": re.compile(r"^'(.*)'$", flags = re.IGNORECASE),
            "repl": r"‘\1’",
        }
    ]

    # 强制规则
    RULE_FORCE_CJK = {
        "「": ("‘", "“"),
        "」": ("’", "”"),
    }

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(cls, src: str, dst: str, source_language: str, target_language: str) -> str:
        # 执行正则区规则
        for rule in cls.RULE_REGEX_CJK:
            regex_src: re.Pattern = rule.get("regex_src")
            regex_dst: re.Pattern = rule.get("regex_dst")
            source_language_tuple: tuple[str] = rule.get("source_language_tuple")
            target_language_tuple: tuple[str] = rule.get("target_language_tuple")

            # 有效性检查
            if isinstance(regex_src, re.Pattern) and regex_src.search(src) == None:
                continue
            if isinstance(regex_dst, re.Pattern) and regex_dst.search(dst) == None:
                continue
            if isinstance(source_language_tuple, tuple) and not source_language in source_language_tuple:
                continue
            if isinstance(target_language_tuple, tuple) and not target_language in target_language_tuple:
                continue

            dst = rule.get("regex_repl").sub(rule.get("repl"), dst)

        # CJK To CJK = A + B
        # CJK To 非CJK = B
        # 非CJK To CJK = A
        # 非CJK To 非CJK = B
        if BaseLanguage.is_cjk(source_language) and BaseLanguage.is_cjk(target_language):
            cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
            cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)
        elif BaseLanguage.is_cjk(source_language) and not BaseLanguage.is_cjk(target_language):
            cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)
        elif not BaseLanguage.is_cjk(source_language) and BaseLanguage.is_cjk(target_language):
            cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
        else:
            cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)

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