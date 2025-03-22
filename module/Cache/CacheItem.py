import re
import threading

import tiktoken
import tiktoken_ext
from tiktoken_ext import openai_public

from base.Base import Base
from base.BaseData import BaseData

class CacheItem(BaseData):

    # 必须显式的引用这两个库，否则打包后会报错
    tiktoken_ext
    openai_public

    class FileType():

        MD: str = "MD"                                  # .md Markdown
        TXT: str = "TXT"                                # .txt 文本文件
        SRT: str = "SRT"                                # .srt 字幕文件
        ASS: str = "ASS"                                # .ass 字幕文件
        EPUB: str = "EPUB"                              # .epub
        XLSX: str = "XLSX"                              # .xlsx Translator++ SExtractor
        RENPY: str = "RENPY"                            # .rpy RenPy
        TRANS: str = "TRANS"                            # .trans Translator++
        KVJSON: str = "KVJSON"                          # .json MTool
        MESSAGEJSON: str = "MESSAGEJSON"                # .json SExtractor

    class TextType():

        MD: str = "MD"                                  # Markdown
        NONE: str = "NONE"                              # 无类型，即纯文本
        WOLF: str = "WOLF"                              # WOLF 游戏文本
        RENPY: str = "RENPY"                            # RENPY 游戏文本
        RPGMAKER: str = "RPGMAKER"                      # RPGMAKER 游戏文本

    # 缓存 Token 数量
    TOKEN_COUNT_CACHE: dict[str, int] = {}

    # RENPY - {w=2.3} [renpy.version_only]
    RE_RENPY = re.compile(r"\{[^{}]*\}|\[[^\[\]]*\]", flags = re.IGNORECASE)

    # Wolf - @123
    RE_WOLF = re.compile(r"@\d+", flags = re.IGNORECASE)

    # RPGMaker - /c[xy12] \bc[xy12] <\bc[xy12]>【/c[xy12]】 \nbx[6]
    RE_RPGMAKER = re.compile(r"[/\\][a-z]{1,8}[<\[][a-z\d]{0,16}[>\]]", flags = re.IGNORECASE)

    # RPGMaker - if(!s[982]) if(v[982] >= 1)  en(!s[982]) en(v[982] >= 1)
    RE_RPGMAKER_IF = re.compile(r"en\(.{0,8}[vs]\[\d+\].{0,16}\)|if\(.{0,8}[vs]\[\d+\].{0,16}\)", flags = re.IGNORECASE)

    def __init__(self, args: dict) -> None:
        super().__init__()

        # 默认值
        self.src: str = ""                                              # 原文
        self.dst: str = ""                                              # 译文
        self.extra_field: str = ""                                      # 额外字段原文，在以下类型中使用：ASS、SRT、RENPY、MESSAGEJSON
        self.tag: str = ""                                              # 标签，在以下类型中使用：EPUB
        self.row: int = 0                                               # 在原始文件中的行号
        self.file_type: str = ""                                        # 原始文件的类型
        self.file_path: str = ""                                        # 原始文件的相对路径
        self.text_type: str = CacheItem.TextType.NONE                   # 文本的实际类型
        self.status: str = Base.TranslationStatus.UNTRANSLATED          # 翻译状态
        self.retry_count: int = 0                                       # 重试次数，当前只有单独重试的时候才增加此计数

        # 初始化
        for k, v in args.items():
            setattr(self, k, v)

        # 线程锁
        self.lock = threading.Lock()

        # 如果文件类型是 XLSX、TRANS、KVJSON、MESSAGEJSON，且没有文本类型，则判断实际的文本类型
        types = (CacheItem.FileType.XLSX, CacheItem.FileType.TRANS, CacheItem.FileType.KVJSON, CacheItem.FileType.MESSAGEJSON)
        if self.get_file_type() in types and self.get_text_type() == CacheItem.TextType.NONE:
            if len(CacheItem.RE_WOLF.findall(self.get_src())) > 0:
                self.text_type = CacheItem.TextType.WOLF
            elif len(CacheItem.RE_RPGMAKER.findall(self.get_src())) > 0 or len(CacheItem.RE_RPGMAKER_IF.findall(self.get_src())) > 0:
                self.text_type = CacheItem.TextType.RPGMAKER
            elif len(CacheItem.RE_RENPY.findall(self.get_src())) > 0:
                self.text_type = CacheItem.TextType.RENPY

    # 获取原文
    def get_src(self) -> str:
        with self.lock:
            return self.src

    # 设置原文
    def set_src(self, src: str) -> None:
        with self.lock:
            self.src = src

    # 获取译文
    def get_dst(self) -> str:
        with self.lock:
            return self.dst

    # 设置译文
    def set_dst(self, dst: str) -> None:
        with self.lock:
            # 有时候模型的回复反序列化以后会是 int 等非字符类型，所以这里要强制转换成字符串
            # TODO:可能需要更好的处理方式
            if isinstance(dst, str):
                self.dst = dst
            else:
                self.dst = str(dst)

    # 获取额外字段原文
    def get_extra_field(self) -> str:
        with self.lock:
            return self.extra_field

    # 设置额外字段原文
    def set_extra_field(self, extra_field: str) -> None:
        with self.lock:
            self.extra_field = extra_field

    # 获取标签
    def get_tag(self) -> str:
        with self.lock:
            return self.tag

    # 设置标签
    def set_tag(self, tag: str) -> None:
        with self.lock:
            self.tag = tag

    # 获取行号
    def get_row(self) -> int:
        with self.lock:
            return self.row

    # 设置行号
    def set_row(self, row: int) -> None:
        with self.lock:
            self.row = row

    # 获取文件类型
    def get_file_type(self) -> str:
        with self.lock:
            return self.file_type

    # 设置文件类型
    def set_file_type(self, type: str) -> None:
        with self.lock:
            self.file_type = type

    # 获取文件路径
    def get_file_path(self) -> str:
        with self.lock:
            return self.file_path

    # 设置文件路径
    def set_file_path(self, path: str) -> None:
        with self.lock:
            self.file_path = path

    # 获取文本类型
    def get_text_type(self) -> str:
        with self.lock:
            return self.text_type

    # 设置文本类型
    def set_text_type(self, type: str) -> None:
        with self.lock:
            self.text_type = type

    # 获取翻译状态
    def get_status(self) -> int:
        with self.lock:
            return self.status

    # 设置翻译状态
    def set_status(self, status: int) -> None:
        with self.lock:
            self.status = status

    # 获取重试次数
    def get_retry_count(self) -> int:
        with self.lock:
            return self.retry_count

    # 设置重试次数
    def set_retry_count(self, retry_count: int) -> None:
        with self.lock:
            self.retry_count = retry_count

    # 获取 Token 数量
    def get_token_count(self) -> int:
        with self.lock:
            if self.src not in CacheItem.TOKEN_COUNT_CACHE:
                CacheItem.TOKEN_COUNT_CACHE[self.src] = len(tiktoken.get_encoding("o200k_base").encode(self.src))

            return CacheItem.TOKEN_COUNT_CACHE[self.src]

    # 将原文切片
    def split_sub_lines(self) -> list[str]:
        with self.lock:
            return [sub_line for sub_line in self.src.split("\n") if sub_line.strip() != ""]

    # 从切片中合并译文
    def merge_sub_lines(self, dst_sub_lines: list[str], check_result: list[int]) -> tuple[str, list[str], list[int]]:
        from module.Response.ResponseChecker import ResponseChecker

        # 当检查结果长度不足时，为其补全
        if len(check_result) < len(dst_sub_lines):
            check_result = check_result + [ResponseChecker.Error.NONE] * (len(dst_sub_lines) - len(check_result))

        dst = ""
        check = []
        for src_sub_line in self.src.split("\n"):
            if src_sub_line == "":
                dst = dst + "\n"
            elif src_sub_line.strip() == "":
                dst = dst + src_sub_line + "\n"
            elif len(dst_sub_lines) > 0:
                check.append(check_result.pop(0))
                dst = dst + str(dst_sub_lines.pop(0)) + "\n"
            # 冗余步骤
            # 当跳过行数检查步骤时，原文行数可能大于译文行数，此时需要填充多出来的行数
            else:
                check.append(0)
                dst = dst + str("") + "\n"

        # 如果当前片段中有没通过检查的子句，则将返回结果置空，以示当前片段需要重新翻译
        if any(v != ResponseChecker.Error.NONE for v in check):
            return None, dst_sub_lines, check_result
        else:
            return dst.removesuffix("\n"), dst_sub_lines, check_result