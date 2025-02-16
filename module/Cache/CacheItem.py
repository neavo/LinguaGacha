import threading

import tiktoken

from base.Base import Base
from base.BaseData import BaseData

class CacheItem(BaseData):

    class FileType():

        TXT: str = "TXT"                                # .txt 文本文件
        SRT: str = "SRT"                                # .srt 字幕文件
        ASS: str = "ASS"                                # .ass 字幕文件
        EPUB: str = "EPUB"                              # .epub
        XLSX: str = "XLSX"                              # .xlsx Translator++ SExtractor
        RENPY: str = "RENPY"                            # .rpy RenPy
        KVJSON: str = "KVJSON"                          # .json MTool
        MESSAGEJSON: str = "MESSAGEJSON"                # .json SExtractor

    # 缓存 Token 数量
    TOKEN_COUNT_CACHE: dict[str, int] = {}

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
        self.status: str = Base.TranslationStatus.UNTRANSLATED          # 翻译状态
        self.retry_count: int = 0                                       # 重试次数，当前只有单独重试的时候才增加此计数

        # 初始化
        for k, v in args.items():
            setattr(self, k, v)

        # 线程锁
        self.lock = threading.Lock()

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
                CacheItem.TOKEN_COUNT_CACHE[self.src] = len(tiktoken.get_encoding("cl100k_base").encode(self.src))

            return CacheItem.TOKEN_COUNT_CACHE[self.src]

    # 将原文切片
    def split_sub_lines(self) -> list[str]:
        with self.lock:
            return [sub_line for sub_line in self.src.split("\n") if sub_line.strip() != ""]

    # 从切片中合并译文
    def merge_sub_lines(self, dst_sub_lines: list[str], check_results: list[int]) -> tuple[str, list[str], list[int]]:
        # 检查数据为空时，填充为 0，即视为全部子句都通过了检查
        if check_results == None or check_results == []:
            check_results = [0] * len(dst_sub_lines)

        dst = ""
        check = []
        for src_sub_line in self.src.split("\n"):
            if src_sub_line == "":
                dst = dst + "\n"
            elif src_sub_line.strip() == "":
                dst = dst + src_sub_line + "\n"
            else:
                check.append(check_results.pop(0))
                dst = dst + str(dst_sub_lines.pop(0)) + "\n"

        # 如果当前片段中有没通过检查的子句，则将返回结果置空，以示当前片段需要重新翻译
        if sum(check) >= 1:
            return None, dst_sub_lines, check_results
        else:
            return dst.removesuffix("\n"), dst_sub_lines, check_results