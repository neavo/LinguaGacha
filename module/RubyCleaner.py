import re

from model.Item import Item

class RubyCleaner:

    # 激进模式额外规则（移除括号/竖线等格式的ruby标记）
    AGGRESSIVE_RULES: tuple[tuple[re.Pattern, str], ...] = (
        # (漢字/かんじ)
        (re.compile(r"\((.+)/.+\)", flags=re.IGNORECASE), r"\1"),
        # [漢字/かんじ]
        (re.compile(r"\[(.+)/.+\]", flags=re.IGNORECASE), r"\1"),
        # |漢字[かんじ]
        (re.compile(r"\|(.+?)\[.+?\]", flags=re.IGNORECASE), r"\1"),
    )

    # 保守模式规则（移除所有常见的ruby标记）
    CONSERVATIVE_RULES: tuple[tuple[re.Pattern, str], ...] = (
        # \r[漢字,かんじ]
        (re.compile(r"\\r\[(.+?),.+?\]", flags=re.IGNORECASE), r"\1"),
        # \rb[漢字,かんじ]
        (re.compile(r"\\rb\[(.+?),.+?\]", flags=re.IGNORECASE), r"\1"),
        # [r_かんじ][ch_漢字]
        (re.compile(r"\[r_.+?\]\[ch_(.+?)\]", flags=re.IGNORECASE), r"\1"),
        # [ch_漢字]
        (re.compile(r"\[ch_(.+?)\]", flags=re.IGNORECASE), r"\1"),
        # <ruby = かんじ>漢字</ruby>
        (re.compile(r"<ruby\s*=\s*.*?>(.*?)</ruby>", flags=re.IGNORECASE), r"\1"),
        # <ruby><rb>漢字</rb><rtc><rt>かんじ</rt></rtc><rtc><rt>Chinese character</rt></rtc></ruby>
        (re.compile(r"<ruby>.*?<rb>(.*?)</rb>.*?</ruby>", flags=re.IGNORECASE), r"\1"),
        # [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]
        (re.compile(r"\[ruby text\s*=\s*.*?\]", flags=re.IGNORECASE), ""),
    )

    @classmethod
    def clean(cls, text: str, type: Item.TextType) -> str:
        # 始终应用保守规则
        for pattern, replacement in cls.CONSERVATIVE_RULES:
            text = re.sub(pattern, replacement, text)

        # 激进模式额外应用规则
        if type not in (
            Item.TextType.WOLF,
            Item.TextType.RPGMAKER,
            Item.TextType.RENPY,
        ):
            for pattern, replacement in cls.AGGRESSIVE_RULES:
                text = re.sub(pattern, replacement, text)

        return text