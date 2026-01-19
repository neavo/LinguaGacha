import re


class EscapeFixer:
    # \f[21]\c[4]\E仲良くなるためのヒント
    # \f[21]\c[4]\\E增进亲密度的小提示

    # 「\\n[1]様、おはようございます」
    # 「\n[1] 殿下，早安」

    RE_ESCAPE_PATTERN: re.Pattern = re.compile(r"\\+", flags=re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__()

    # 检查并替换
    @classmethod
    def fix(cls, src: str, dst: str) -> str:
        # 理论上文本中不会包含换行符，如果出现换行符，将其还原为 \\n
        dst = dst.replace("\n", "\\n")
        src_results: list[str] = cls.RE_ESCAPE_PATTERN.findall(src)
        dst_results: list[str] = cls.RE_ESCAPE_PATTERN.findall(dst)

        # 检查匹配项是否完全相同
        if src_results == dst_results:
            return dst

        # 检查匹配项数量是否一致
        if len(src_results) != len(dst_results):
            return dst

        # 逐一替换
        i: list[int] = [0]
        dst = cls.RE_ESCAPE_PATTERN.sub(
            lambda m: cls.repl(m, i, src_results),
            dst,
        )

        return dst

    @classmethod
    def repl(cls, m: re.Match, i: list[int], src_results: list[str]) -> str:
        i[0] = i[0] + 1
        return src_results[i[0] - 1]
