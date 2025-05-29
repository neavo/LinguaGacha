import re

class RubyCleaner():

    RULE: tuple[re.Pattern] = (
        # (漢字/かんじ)
        (re.compile(r'\((.+)/.+\)', flags = re.IGNORECASE), r"\1"),
        # [漢字/かんじ]
        (re.compile(r'\[(.+)/.+\]', flags = re.IGNORECASE), r"\1"),
        # |漢字[かんじ]
        (re.compile(r'\|(.+?)\[.+?\]', flags = re.IGNORECASE), r"\1"),
        # WOLF - \r[漢字,かんじ]
        (re.compile(r'\\r\[(.+?),.+?\]', flags = re.IGNORECASE), r"\1"),
        # [r_かんじ][ch_漢字]
        (re.compile(r'\[r_.+?\]\[ch_(.+?)\]', flags = re.IGNORECASE), r"\1"),
        # [ch_漢字]
        (re.compile(r'\[ch_(.+?)\]', flags = re.IGNORECASE), r"\1"),
        # <ruby = かんじ>漢字</ruby>
        (re.compile(r'<ruby\s*=\s*.*?>(.*?)</ruby>', flags = re.IGNORECASE), r"\1"),
        # <ruby><rb>漢字</rb><rtc><rt>かんじ</rt></rtc><rtc><rt>Chinese character</rt></rtc></ruby>
        (re.compile(r'<ruby>.*?<rb>(.*?)</rb>.*?</ruby>', flags = re.IGNORECASE), r"\1"),
        # [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]
        (re.compile(rf'\[ruby text\s*=\s*.*?\]', flags = re.IGNORECASE), ""),
    )

    @classmethod
    def clean(cls, text: str) -> str:
        for pattern, replacement in cls.RULE:
            text = re.sub(pattern, replacement, text)

        return text