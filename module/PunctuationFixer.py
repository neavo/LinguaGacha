import re

from base.Base import Base

class PunctuationFixer():

    # A区：应用到所有语言的规则
    RULE_A = {
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

    # B区：只应用到部分语言的规则
    RULE_B = {
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

    # 替换区：即不匹配数量，直接强制替换的规则
    RULE_REPLACE = {
        "「": ("‘", "“"),
        "」": ("’", "”"),
    }

    # 圆圈数字列表
    CIRCLED_NUMBERS = tuple(chr(i) for i in range(0x2460, 0x2474))                                      # ①-⑳
    CIRCLED_NUMBERS_CJK_01 = tuple(chr(i) for i in range(0x3251, 0x3260))                               # ㉑-㉟
    CIRCLED_NUMBERS_CJK_02 = tuple(chr(i) for i in range(0x32B1, 0x32C0))                               # ㊱-㊿
    CIRCLED_NUMBERS_ALL = ("",) + CIRCLED_NUMBERS + CIRCLED_NUMBERS_CJK_01 + CIRCLED_NUMBERS_CJK_02     # 开头加个空字符来对齐索引和数值

    # 预设编译正则
    PATTERN_ALL_NUM = re.compile(r"\d+|[①-⑳㉑-㉟㊱-㊿]", re.IGNORECASE)
    PATTERN_CIRCLED_NUM = re.compile(r"[①-⑳㉑-㉟㊱-㊿]", re.IGNORECASE)

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.source_language = config.get("source_language")
        self.target_language = config.get("target_language")

    # 检查并替换
    def fix(self, src: str, dst: str) -> str:
        # 修复圆圈数字
        dst = self.fix_circled_numbers(src, dst)

        # 执行 A区规则 修复标点
        for key, value in PunctuationFixer.RULE_A.items():
            if self.check(src, dst, key, value) == True:
                dst = self.replace(dst, key, value)

        # 当从非CJK语言翻译到CJK语言时，跳过执行 B区规则 和 替换区
        if self.source_language not in Base.Language.CJK and self.target_language in Base.Language.CJK:
            pass
        else:
            for key, value in PunctuationFixer.RULE_B.items():
                if self.check(src, dst, key, value) == True:
                    dst = self.replace(dst, key, value)
            for key, value in PunctuationFixer.RULE_REPLACE.items():
                dst = self.replace(dst, key, value)

        return dst

    # 检查
    def check(self, src: str, dst: str, key: str, value: tuple) -> tuple[str, bool]:
        num_s_x = src.count(key)
        num_s_y = sum(src.count(t) for t in value)
        num_t_x = dst.count(key)
        num_t_y = sum(dst.count(t) for t in value)

        # 首先，原文中的目标符号的数量应大于零，否则表示没有需要修复的标点
        # 然后，原文中目标符号和错误符号的数量不应相等，否则无法确定哪个符号是正确的
        # 然后，原文中的目标符号的数量应大于译文中的目标符号的数量，否则表示没有需要修复的标点
        # 最后，如果原文中目标符号的数量等于译文中目标符号与错误符号的数量之和，则判断为需要修复
        return num_s_x > 0 and num_s_x != num_s_y and num_s_x > num_t_x and num_s_x == num_t_x + num_t_y

    # 替换
    def replace(self, dst: str, key: str, value: tuple) -> str:
        for t in value:
            dst = dst.replace(t, key)

        return dst

    # 安全转换字符串为整数
    def safe_int(self, s: str) -> int:
        result = -1

        try:
            result = int(s)
        except Exception:
            pass

        return result

    # 修复圆圈数字
    def fix_circled_numbers(self, src: str, dst: str) -> str:
        # 找出 src 与 dst 中的圆圈数字
        src_nums = PunctuationFixer.PATTERN_ALL_NUM.findall(src)
        dst_nums = PunctuationFixer.PATTERN_ALL_NUM.findall(dst)
        src_circled_nums = PunctuationFixer.PATTERN_CIRCLED_NUM.findall(src)
        dst_circled_nums = PunctuationFixer.PATTERN_CIRCLED_NUM.findall(dst)

        # 如果原文中没有圆圈数字，则跳过
        if len(src_circled_nums) == 0:
            return dst

        # 如果原文和译文中数字（含圆圈数字）的数量不一致，则跳过
        if len(src_nums) != len(dst_nums):
            return dst

        # 如果原文中的圆圈数字数量少于译文中的圆圈数字数量，则跳过
        if len(src_circled_nums) < len(dst_circled_nums):
            return dst

        # 遍历原文与译文中的数字（含圆圈数字），尝试恢复
        for i in range(len(src_nums)):
            src_num_srt = src_nums[i]
            dst_num_srt = dst_nums[i]
            dst_num_int = self.safe_int(dst_num_srt)

            # 如果原文中该位置不是圆圈数字，则跳过
            if src_num_srt not in PunctuationFixer.CIRCLED_NUMBERS_ALL:
                continue

            # 如果译文中该位置数值不在有效范围，则跳过
            if dst_num_int < 0 or dst_num_int >= len(PunctuationFixer.CIRCLED_NUMBERS_ALL):
                continue

            # 如果原文、译文中该位置的圆圈数字不一致，则跳过
            if src_num_srt != PunctuationFixer.CIRCLED_NUMBERS_ALL[dst_num_int]:
                continue

            # 尝试恢复
            dst = self.fix_circled_numbers_by_index(dst, i, src_num_srt)

        return dst

    # 通过索引修复圆圈数字
    def fix_circled_numbers_by_index(self, dst: str, target_i: int, target_str: str) -> str:
        # 用于标识目标位置
        i = [0]

        def repl(m: re.Match) -> str:
            if i[0] == target_i:
                i[0] = i[0] + 1
                return target_str
            else:
                i[0] = i[0] + 1
                return m.group(0)

        return PunctuationFixer.PATTERN_ALL_NUM.sub(repl, dst)