import re


class NumberFixer:
    # 圆圈数字列表
    CIRCLED_NUMBERS = tuple(chr(i) for i in range(0x2460, 0x2474))  # ①-⑳
    CIRCLED_NUMBERS_CJK_01 = tuple(chr(i) for i in range(0x3251, 0x3260))  # ㉑-㉟
    CIRCLED_NUMBERS_CJK_02 = tuple(chr(i) for i in range(0x32B1, 0x32C0))  # ㊱-㊿
    CIRCLED_NUMBERS_ALL = (
        ("",) + CIRCLED_NUMBERS + CIRCLED_NUMBERS_CJK_01 + CIRCLED_NUMBERS_CJK_02
    )  # 开头加个空字符来对齐索引和数值

    # 预设编译正则
    PATTERN_ALL_NUM = re.compile(r"\d+|[①-⑳㉑-㉟㊱-㊿]", re.IGNORECASE)
    PATTERN_CIRCLED_NUM = re.compile(r"[①-⑳㉑-㉟㊱-㊿]", re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(cls, src: str, dst: str) -> str:
        # 找出 src 与 dst 中的圆圈数字
        src_nums = cls.PATTERN_ALL_NUM.findall(src)
        dst_nums = cls.PATTERN_ALL_NUM.findall(dst)
        src_circled_nums = cls.PATTERN_CIRCLED_NUM.findall(src)
        dst_circled_nums = cls.PATTERN_CIRCLED_NUM.findall(dst)

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
            dst_num_int = cls.safe_int(dst_num_srt)

            # 如果原文中该位置不是圆圈数字，则跳过
            if src_num_srt not in cls.CIRCLED_NUMBERS_ALL:
                continue

            # 如果译文中该位置数值不在有效范围，则跳过
            if dst_num_int < 0 or dst_num_int >= len(cls.CIRCLED_NUMBERS_ALL):
                continue

            # 如果原文、译文中该位置的圆圈数字不一致，则跳过
            if src_num_srt != cls.CIRCLED_NUMBERS_ALL[dst_num_int]:
                continue

            # 尝试恢复
            dst = cls.fix_circled_numbers_by_index(dst, i, src_num_srt)

        return dst

    # 安全转换字符串为整数
    @classmethod
    def safe_int(cls, s: str) -> int:
        result = -1

        try:
            result = int(s)
        except ValueError:
            pass

        return result

    # 通过索引修复圆圈数字
    @classmethod
    def fix_circled_numbers_by_index(
        cls, dst: str, target_i: int, target_str: str
    ) -> str:
        # 用于标识目标位置
        i = [0]

        def repl(m: re.Match) -> str:
            if i[0] == target_i:
                i[0] = i[0] + 1
                return target_str
            else:
                i[0] = i[0] + 1
                return m.group(0)

        return cls.PATTERN_ALL_NUM.sub(repl, dst)
