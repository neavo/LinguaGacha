import re

from base.Base import Base
from module.Cache.CacheItem import CacheItem

class CodeSaver(Base):

    # 用于 RPGMaker 的规则
    RE_CODE_RPGMAKER = (
        r"if\(.{0,5}[vs]\[\d+\].{0,16}\)",                                          # if(!s[982]) if(v[982] >= 1) if(v[982] >= 1)
        r"en\(.{0,5}[vs]\[\d+\].{0,16}\)",                                          # en(!s[982]) en(v[982] >= 1) en(v[982] >= 1)
        r"[<【]{0,1}[/\\][a-z]{1,5}[<\[][a-z\d]{0,16}[>\]][>】]{0,1}",              # /c[xy12] \bc[xy12] <\bc[xy12]>【/c[xy12]】
        r"[/\\][a-z]{1,5}(?=<.{0,16}>|\[.{0,16}\])",                                # /C<> \FS<> /C[] \FS[] 中 <> [] 前的部分
        r"\\fr",                                                                    # 重置文本的改变
        r"\\fb",                                                                    # 加粗
        r"\\fi",                                                                    # 倾斜
        r"\\\{",                                                                    # 放大字体 \{
        r"\\\}",                                                                    # 缩小字体 \}
        r"\\g",                                                                     # 显示货币 \G
        r"\\\$",                                                                    # 打开金币框 \$
        r"\\\.",                                                                    # 等待0.25秒 \.
        r"\\\|",                                                                    # 等待1秒 \|
        r"\\!",                                                                     # 等待按钮按下 \!
        r"\\>",                                                                     # 在同一行显示文字 \>
        r"\\<",                                                                     # 取消显示所有文字 \<
        r"\\\^",                                                                    # 显示文本后不需要等待 \^
        r"\\n",                                                                     # 换行符 \\n
        r"\\\\<br>",                                                                # 换行符 \\<br>
        r"<br>",                                                                    # 换行符 <br>
    )

    # 用于 RenPy 的规则
    RE_CODE_RENPY = (
        r"\{[^{}]*\}",                                                                 # {w=2.3}
        r"\[[^\[\]]*\]",                                                               # [renpy.version_only]
    )

    # 通用规则
    RE_CODE_COMMON = (
        r"\u3000",                                                                  # 全角空格
        r"\u0020",                                                                  # 半角空格
        r"\r",                                                                      # 换行符
        r"\n",                                                                      # 换行符
        r"\t",                                                                      # 制表符
    )

    # 占位符文本
    PLACEHOLDER = "{PLACEHOLDER}"

    # 正则表达式
    RE_CHECK_RENPY = re.compile(rf"(?:{"|".join(RE_CODE_RENPY)})+", re.IGNORECASE)
    RE_PREFIX_RENPY = re.compile(rf"^(?:{"|".join(RE_CODE_RENPY + RE_CODE_COMMON)})+", re.IGNORECASE)
    RE_SUFFIX_RENPY = re.compile(rf"(?:{"|".join(RE_CODE_RENPY + RE_CODE_COMMON)})+$", re.IGNORECASE)
    RE_CHECK_RPGMAKER = re.compile(rf"(?:{"|".join(RE_CODE_RPGMAKER)})+", re.IGNORECASE)
    RE_PREFIX_RPGMAKER = re.compile(rf"^(?:{"|".join(RE_CODE_RPGMAKER + RE_CODE_COMMON)})+", re.IGNORECASE)
    RE_SUFFIX_RPGMAKER = re.compile(rf"(?:{"|".join(RE_CODE_RPGMAKER + RE_CODE_COMMON)})+$", re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.placeholders = set()
        self.prefix_codes = {}
        self.suffix_codes = {}

    # 预处理
    def pre_process(self, data: dict[str, str], file_type: dict[str, str]) -> dict[str, str]:
        for k in data.keys():
            if file_type.get(k) == CacheItem.FileType.RENPY:
                self.pre_process_renpy(k, data)
            else:
                self.pre_process_rpgmaker(k, data)

        return data

    # 预处理 - RPGMaker
    def pre_process_rpgmaker(self, k: str, data: dict[str, str]) -> None:
        # 查找与替换前缀代码段
        self.prefix_codes[k] = CodeSaver.RE_PREFIX_RPGMAKER.findall(data.get(k))
        data[k] = CodeSaver.RE_PREFIX_RPGMAKER.sub("", data.get(k))

        # 查找与替换后缀代码段
        self.suffix_codes[k] = CodeSaver.RE_SUFFIX_RPGMAKER.findall(data.get(k))
        data[k] = CodeSaver.RE_SUFFIX_RPGMAKER.sub("", data.get(k))

        # 如果处理后的文本为空，则记录 ID，并将文本替换为占位符
        if data[k] == "":
            data[k] = CodeSaver.PLACEHOLDER
            self.placeholders.add(k)

    # 预处理 - RenPy
    def pre_process_renpy(self, k: str, data: dict[str, str]) -> None:
        # 替换转义符号
        data[k] = data[k].replace("{{", "#!#").replace("}}", "#@#").replace("[[", "#$#").replace("]]", "#%#")

        # 查找与替换前缀代码段
        self.prefix_codes[k] = CodeSaver.RE_PREFIX_RENPY.findall(data.get(k))
        data[k] = CodeSaver.RE_PREFIX_RENPY.sub("", data.get(k))

        # 查找与替换后缀代码段
        self.suffix_codes[k] = CodeSaver.RE_SUFFIX_RENPY.findall(data.get(k))
        data[k] = CodeSaver.RE_SUFFIX_RENPY.sub("", data.get(k))

        # 如果处理后的文本为空，则记录 ID，并将文本替换为占位符
        if data[k] == "":
            data[k] = CodeSaver.PLACEHOLDER
            self.placeholders.add(k)

    # 后处理
    def post_process(self, data: dict[str, str], file_type: dict[str, str]) -> dict[str, str]:
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

            # 还原转义符号
            data[k] = data[k].replace("#!#", "{{").replace("#@#", "}}").replace("#$#", "[[").replace("#%#", "]]")

        return data

    # 检查代码段
    def check(self, src: str, dst: str, file_type: str) -> bool:
        if file_type == CacheItem.FileType.RENPY:
            x = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RENPY.findall(src)]
            y = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RENPY.findall(dst)]
        else:
            x = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RPGMAKER.findall(src)]
            y = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RPGMAKER.findall(dst)]

        return x == y