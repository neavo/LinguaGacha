import re

from rich import print

from model.Item import Item
from module.Config import Config
from module.Data.QualityRuleSnapshot import QualityRuleSnapshot


class CodeFixer:
    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(
        cls,
        src: str,
        dst: str,
        text_type: Item.TextType,
        config: Config,
        quality_snapshot: QualityRuleSnapshot | None = None,
    ) -> str:
        from module.TextProcessor import TextProcessor

        src_codes: list[str] = []
        dst_codes: list[str] = []
        rule: re.Pattern | None = TextProcessor(
            config,
            None,
            quality_snapshot=quality_snapshot,
        ).get_re_sample(
            custom=False,
            text_type=text_type,
        )

        if rule is not None:
            src_codes = [
                v.group(0) for v in rule.finditer(src) if v.group(0).strip() != ""
            ]
            dst_codes = [
                v.group(0) for v in rule.finditer(dst) if v.group(0).strip() != ""
            ]

        if src_codes == dst_codes:
            return dst

        if len(src_codes) >= len(dst_codes):
            return dst

        # 判断是否是有序子集
        flag, mismatchs = cls.is_ordered_subset(src_codes, dst_codes)
        if flag:
            if rule is None:
                return dst
            i: list[int] = [0]
            dst = rule.sub(lambda m: cls.repl(m, i, mismatchs), dst)

        return dst

    @classmethod
    def repl(cls, m: re.Match, i: list[int], mismatchs: list[int]) -> str:
        text: str = m.group(0)
        if text.strip() == "":
            return text
        elif i[0] in mismatchs:
            i[0] = i[0] + 1
            return ""
        else:
            i[0] = i[0] + 1
            return text

    # 判断是否是有序子集，并输出 y 中多余元素的索引
    @classmethod
    def is_ordered_subset(
        cls, x: list[str], y_list: list[str]
    ) -> tuple[bool, list[int]]:
        y_copy = y_list.copy()
        mismatchs: list[int] = []

        y_index: int = -1
        for x_item in x:
            match_flag: bool = False
            break_flag: bool = False

            while (not break_flag) and len(y_copy) > 0:
                y_item = y_copy.pop(0)
                y_index = y_index + 1
                if x_item == y_item:
                    match_flag = True
                    break_flag = True
                    break
                else:
                    mismatchs.append(y_index)

            if not match_flag:
                return False, []

        # 如果还有剩余未匹配项，则将其索引全部添加
        for i in range(len(y_copy)):
            mismatchs.append(y_index + i + 1)

        # 如果所有 x 元素都匹配成功，返回 True
        return True, mismatchs

    @classmethod
    def test(cls, config: Config) -> None:
        x = "合計　\\V[62]！　やったやった♪　私の勝ちね！\n\\c[17]――レナリスの勝ち！　【３０００ G】手に入れた！\\c[0]\n\\$"
        y = "总计　\\V[62]！　哈哈！　我赢了！\n\\c[17]――雷纳里斯赢了！ 获得了\\c[2]【3000 G】\\c[0]！\\c[0]\n\\$"
        z = cls().fix(x, y, Item.TextType.RPGMAKER, config)
        print(f"{repr(x)}\n{repr(y)}\n{repr(z)}")
