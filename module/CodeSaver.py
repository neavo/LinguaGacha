import re

from base.Base import Base

class CodeSaver(Base):

    # 用于非英文的代码段规则
    CODE_PATTERN = (
        r"if\(.{0,5}[vs]\[\d+\].{0,10}\)",                  # if(!s[982]) if(v[982] >= 1) if(v[982] >= 1)
        r"en\(.{0,5}[vs]\[\d+\].{0,10}\)",                  # en(!s[982]) en(v[982] >= 1)
        r"[/\\][a-z]{1,5}<[a-z\d]{0,10}>",                  # /C<y> /C<1> \FS<xy> \FS<12>
        r"[/\\][a-z]{1,5}\[[a-z\d]{0,10}\]",                # /C[x] /C[1] \FS[xy] \FS[12]
        r"[/\\][a-z]{1,5}(?=<.{0,10}>|\[.{0,10}\])",        # /C<> \FS<> /C[] \FS[] 中 <> [] 前的部分
    )

    # 用于英文的代码段规则
    CODE_PATTERN_EN = (
        r"if\(.{0,5}[vs]\[\d+\].{0,10}\)",                  # if(!s[982]) if(s[1623]) if(v[982] >= 1)
        r"en\(.{0,5}[vs]\[\d+\].{0,10}\)",                  # en(!s[982]) en(v[982] >= 1)
        r"[/\\][a-z]{1,5}<[\d]{0,10}>",                     # /C<1> \FS<12>
        r"[/\\][a-z]{1,5}\[[\d]{0,10}\]",                   # /C[1] \FS[12]
        r"[/\\][a-z]{1,5}(?=<.{0,10}>|\[.{0,10}\])",        # /C<> \FS<> /C[] \FS[] 中 <> [] 前的部分
    )

    # 同时作用于英文于非英文的代码段规则
    CODE_PATTERN_COMMON = (
        r"\\fr",                                            # 重置文本的改变
        r"\\fb",                                            # 加粗
        r"\\fi",                                            # 倾斜
        r"\\\{",                                            # 放大字体 \{
        r"\\\}",                                            # 缩小字体 \}
        r"\\g",                                             # 显示货币 \G
        r"\\\$",                                            # 打开金币框 \$
        r"\\\.",                                            # 等待0.25秒 \.
        r"\\\|",                                            # 等待1秒 \|
        r"\\!",                                             # 等待按钮按下 \!
        r"\\>",                                             # 在同一行显示文字 \>
        r"\\<",                                             # 取消显示所有文字 \<
        r"\\\^",                                            # 显示文本后不需要等待 \^
        r"\\n",                                             # 换行符 \\n
        r"\\\\<br>",                                        # 换行符 \\<br>
        r"<br>",                                            # 换行符 <br>
    )

    # 空白符
    CODE_PATTERN_SPACE = (
        r"\u3000",                                          # 全角空格
        r"\u0020",                                          # 半角空格
        r"\r",                                              # 换行符
        r"\n",                                              # 换行符
        r"\t",                                              # 制表符
    )

    # 占位符文本
    PLACEHOLDER = "{PLACEHOLDER}"

    # 正则表达式
    RE_CHECK = re.compile(rf"(?:{"|".join(CODE_PATTERN + CODE_PATTERN_COMMON)})+", re.IGNORECASE)
    RE_PREFIX = re.compile(rf"^(?:{"|".join(CODE_PATTERN + CODE_PATTERN_COMMON + CODE_PATTERN_SPACE)})+", re.IGNORECASE)
    RE_SUFFIX = re.compile(rf"(?:{"|".join(CODE_PATTERN + CODE_PATTERN_COMMON + CODE_PATTERN_SPACE)})+$", re.IGNORECASE)
    RE_CHECK_EN = re.compile(rf"(?:{"|".join(CODE_PATTERN_EN + CODE_PATTERN_COMMON)})+", re.IGNORECASE)
    RE_PREFIX_EN = re.compile(rf"^(?:{"|".join(CODE_PATTERN_EN + CODE_PATTERN_COMMON + CODE_PATTERN_SPACE)})+", re.IGNORECASE)
    RE_SUFFIX_EN = re.compile(rf"(?:{"|".join(CODE_PATTERN_EN + CODE_PATTERN_COMMON + CODE_PATTERN_SPACE)})+$", re.IGNORECASE)

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.placeholders = set()
        self.prefix_codes = {}
        self.suffix_codes = {}
        self.source_language = config.get("source_language")

        # 根据原文语言选择规则
        if self.source_language not in (Base.Language.ZH, Base.Language.JA, Base.Language.KO):
            self.re_check = CodeSaver.RE_CHECK
            self.re_prefix = CodeSaver.RE_PREFIX
            self.re_suffix = CodeSaver.RE_SUFFIX
        else:
            self.re_check = CodeSaver.RE_CHECK_EN
            self.re_prefix = CodeSaver.RE_PREFIX_EN
            self.re_suffix = CodeSaver.RE_SUFFIX_EN

    # 预处理
    def preprocess(self, data: dict[str, str]) -> dict[str, str]:
        for k in data.keys():
            # 查找与替换前缀代码段
            self.prefix_codes[k] = self.re_prefix.findall(data.get(k))
            data[k] = self.re_prefix.sub("", data.get(k))

            # 查找与替换后缀代码段
            self.suffix_codes[k] = self.re_suffix.findall(data.get(k))
            data[k] = self.re_suffix.sub("", data.get(k))

            # 如果处理后的文本为空，则记录 ID，并将文本替换为占位符
            if data[k] == "":
                data[k] = CodeSaver.PLACEHOLDER
                self.placeholders.add(k)

        return data

    # 后处理
    def postprocess(self, data: dict[str, str]) -> dict[str, str]:
        for k in data.keys():
            # 如果 ID 在占位符集合中，则将文本置为空
            if k in self.placeholders:
                data[k] = ""

            # 移除模型可能额外添加的头尾空白符
            data[k] = data.get(k).strip()

            # 还原前缀代码段
            data[k] = "".join(self.prefix_codes.get(k)) + data.get(k)

            # 还原后缀代码段
            data[k] = data.get(k) + "".join(self.suffix_codes.get(k))

        return data

    # 检查代码段
    def check(self, src: str, dst: str) -> None:
        return len(self.re_check.findall(src)) == len(self.re_check.findall(dst))