import re
from module.Cache.CacheItem import CacheItem
from module.CodeSaver import CodeSaver
from module.LogHelper import LogHelper

class CodeFixer():

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(cls, src: str, dst: str, text_type: str) -> str:
        if text_type == CacheItem.TextType.RENPY:
            rule: re.Pattern = CodeSaver.RE_CHECK_RENPY
            src_codes = CodeSaver.RE_CHECK_RENPY.findall(src)
            dst_codes = CodeSaver.RE_CHECK_RENPY.findall(dst)
        elif text_type in (CacheItem.TextType.WOLF, CacheItem.TextType.RPGMAKER):
            rule: re.Pattern = CodeSaver.RE_CHECK_WOLF_RPGMAKER
            src_codes = CodeSaver.RE_CHECK_WOLF_RPGMAKER.findall(src)
            dst_codes = CodeSaver.RE_CHECK_WOLF_RPGMAKER.findall(dst)
        else:
            rule: re.Pattern = None
            src_codes = []
            dst_codes = []

        if src_codes == dst_codes:
            return dst

        if len(src_codes) >= len(dst_codes):
            return dst

        # 判断是否是有序子集
        flag, mismatchs = cls.is_ordered_subset(src_codes, dst_codes)
        if flag == True:
            i: list[int] = [0]
            dst = rule.sub(lambda m: cls.repl(m, i, mismatchs), dst)

        return dst

    @classmethod
    def repl(cls, m: re.Match, i: list[int], mismatchs: list[int]) -> str:
        if i[0] in mismatchs:
            i[0] = i[0] + 1
            return ""
        else:
            i[0] = i[0] + 1
            return m.group(0)

    # 判断是否是有序子集，并输出 y 中多余元素的索引
    @classmethod
    def is_ordered_subset(cls, x: list[str], y: list[str]) -> tuple[bool, list[int]]:
        y: list[str] = y.copy()
        mismatchs: list[int] = []

        y_index: int = -1
        for x_item in x:
            match_flag: bool = False
            break_flag: bool = False

            while break_flag == False and len(y) > 0:
                y_item = y.pop(0)
                y_index = y_index + 1
                if x_item == y_item:
                    match_flag = True
                    break_flag = True
                    break
                else:
                    mismatchs.append(y_index)

            if match_flag == False:
                return False, []

        # 如果还有剩余未匹配项，则将其索引全部添加
        for i in range(len(y)):
            mismatchs.append(y_index + i + 1)

        # 如果所有 x 元素都匹配成功，返回 True
        return True, mismatchs

    @classmethod
    def test(cls) -> None:
        x = "\\C[8]黒髪のアイゼン\\C[0]"
        y = "\\C[8]\\C[8]黑发艾森\\C[0]\\C[0]"
        cls().fix(x, y, CacheItem.TextType.RENPY)