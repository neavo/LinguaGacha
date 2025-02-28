import re

from base.Base import Base
from module.Cache.CacheItem import CacheItem

class CodeSaver(Base):

    # RENPY - {w=2.3} [renpy.version_only]
    RE_RENPY = re.compile(r"\{[^{}]*\}|\[[^\[\]]*\]", flags = re.IGNORECASE)

    # RPGMaker - /c[xy12] \bc[xy12] <\bc[xy12]>【/c[xy12]】 \nbx[6]
    RE_RPGMAKER = re.compile(r"[/\\][a-z]{1,5}[<\[][a-z\d]{0,16}[>\]]", flags = re.IGNORECASE)

    # RPGMaker - if(!s[982]) if(v[982] >= 1)  en(!s[982]) en(v[982] >= 1)
    RE_RPGMAKER_IF = re.compile(r"en\(.{0,5}[vs]\[\d+\].{0,16}\)|if\(.{0,5}[vs]\[\d+\].{0,16}\)", flags = re.IGNORECASE)

    # 用于 RPGMaker 的规则
    RE_CODE_RPGMAKER = (
        r"en\(.{0,5}[vs]\[\d+\].{0,16}\)",                                          # en(!s[982]) en(v[982] >= 1)
        r"if\(.{0,5}[vs]\[\d+\].{0,16}\)",                                          # if(!s[982]) if(v[982] >= 1)
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
    )

    # 用于 RenPy 的规则
    RE_CODE_RENPY = (
        r"\{[^{}]*\}",                                                              # {w=2.3}
        r"\[[^\[\]]*\]",                                                            # [renpy.version_only]
    )

    # 通用规则
    RE_CODE_COMMON = (
        r"\\n",                                                                     # 换行符 \\n
        r"\\\\<br>",                                                                # 换行符 \\<br>
        r"<br>",                                                                    # 换行符 <br>
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

    # 生成示例
    def generate_samples(self, full_text: str) -> tuple[list[str], bool]:
        renpy: bool = False
        samples: list[str] = []

        # RPGMaker 第一类代码
        if CodeSaver.RE_RPGMAKER.findall(full_text) != []:
            samples.append("\\abc[…]")
            samples.append("/xyz<…>")

        # RPGMaker 第二类代码
        if CodeSaver.RE_RPGMAKER_IF.findall(full_text) != []:
            samples.append("if(…)")
            samples.append("en(…)")

        # RenPy 代码
        # 注意 RenPy 的示例可能会对 RPGMaker 游戏起反作用，所以只有不包含 RPGMaker 数据的才判断是否为 RenPy
        if samples == [] and CodeSaver.RE_RENPY.findall(full_text) != []:
            renpy = True
            samples.append("[…]")
            samples.append("{…}")

        return samples, renpy

    # 预处理
    def pre_process(self, src_dict: dict[str, str]) -> tuple[dict[str, str], list[str]]:
        # 生成示例
        samples, renpy = self.generate_samples("\n".join([v.strip() for v in src_dict.values()]))

        # 分别处理
        if renpy == True:
            for k in src_dict.keys():
                self.pre_process_renpy(k, src_dict)
        else:
            for k in src_dict.keys():
                self.pre_process_rpgmaker(k, src_dict)

        return src_dict, samples

    # 预处理 - RPGMaker
    def pre_process_rpgmaker(self, k: str, src_dict: dict[str, str]) -> None:
        # 查找与替换前缀代码段
        self.prefix_codes[k] = CodeSaver.RE_PREFIX_RPGMAKER.findall(src_dict.get(k))
        src_dict[k] = CodeSaver.RE_PREFIX_RPGMAKER.sub("", src_dict.get(k))

        # 查找与替换后缀代码段
        self.suffix_codes[k] = CodeSaver.RE_SUFFIX_RPGMAKER.findall(src_dict.get(k))
        src_dict[k] = CodeSaver.RE_SUFFIX_RPGMAKER.sub("", src_dict.get(k))

        # 如果处理后的文本为空，则记录 ID，并将文本替换为占位符
        if src_dict[k] == "":
            src_dict[k] = CodeSaver.PLACEHOLDER
            self.placeholders.add(k)

    # 预处理 - RenPy
    def pre_process_renpy(self, k: str, src_dict: dict[str, str]) -> None:
        # 替换转义符号
        src_dict[k] = src_dict[k].replace("{{", "#!#").replace("}}", "#@#").replace("[[", "#$#").replace("]]", "#%#")

        # 查找与替换前缀代码段
        self.prefix_codes[k] = CodeSaver.RE_PREFIX_RENPY.findall(src_dict.get(k))
        src_dict[k] = CodeSaver.RE_PREFIX_RENPY.sub("", src_dict.get(k))

        # 查找与替换后缀代码段
        self.suffix_codes[k] = CodeSaver.RE_SUFFIX_RENPY.findall(src_dict.get(k))
        src_dict[k] = CodeSaver.RE_SUFFIX_RENPY.sub("", src_dict.get(k))

        # 如果处理后的文本为空，则记录 ID，并将文本替换为占位符
        if src_dict[k] == "":
            src_dict[k] = CodeSaver.PLACEHOLDER
            self.placeholders.add(k)

    # 后处理
    def post_process(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> dict[str, str]:
        for k in dst_dict.keys():
            # 检查一下返回值的有效性
            if k not in src_dict:
                continue

            # 如果 ID 在占位符集合中，则将文本置为空
            if k in self.placeholders:
                dst_dict[k] = ""

            # 移除模型可能额外添加的头尾空白符
            dst_dict[k] = dst_dict.get(k).strip()

            # 还原前缀代码段
            dst_dict[k] = "".join(self.prefix_codes.get(k)) + dst_dict.get(k)

            # 还原后缀代码段
            dst_dict[k] = dst_dict.get(k) + "".join(self.suffix_codes.get(k))

            # 还原转义符号
            dst_dict[k] = dst_dict[k].replace("#!#", "{{").replace("#@#", "}}").replace("#$#", "[[").replace("#%#", "]]")

        return dst_dict

    # 检查代码段
    def check(self, src: str, dst: str) -> bool:
        # 生成示例
        _, renpy = self.generate_samples(src)

        # 分别处理
        if renpy == True:
            x = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RENPY.findall(src)]
            y = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RENPY.findall(dst)]
        else:
            x = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RPGMAKER.findall(src)]
            y = [v.replace(" ", "").replace("　", "") for v in CodeSaver.RE_CHECK_RPGMAKER.findall(dst)]

        return x == y