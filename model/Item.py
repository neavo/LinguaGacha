import dataclasses
import re
import threading
from enum import StrEnum
from typing import Any
from typing import ClassVar
from typing import Self
from typing import cast

import tiktoken
import tiktoken_ext
from tiktoken_ext import openai_public

from base.Base import Base
from module.Text.TextBase import TextBase


@dataclasses.dataclass
class Item:
    # 必须显式的引用这两个库，否则打包后会报错
    tiktoken_ext
    openai_public

    class FileType(StrEnum):
        NONE = "NONE"  # 无类型
        MD = "MD"  # .md Markdown
        TXT = "TXT"  # .txt 文本文件
        SRT = "SRT"  # .srt 字幕文件
        ASS = "ASS"  # .ass 字幕文件
        EPUB = "EPUB"  # .epub
        XLSX = "XLSX"  # .xlsx Translator++ SExtractor
        WOLFXLSX = "WOLFXLSX"  # .xlsx WOLF 官方翻译工具导出文件
        RENPY = "RENPY"  # .rpy RenPy
        TRANS = "TRANS"  # .trans Translator++
        KVJSON = "KVJSON"  # .json MTool
        MESSAGEJSON = "MESSAGEJSON"  # .json SExtractor

    class TextType(StrEnum):
        NONE = "NONE"  # 无类型，即纯文本
        MD = "MD"  # Markdown
        KAG = "KAG"  # KAG 游戏文本
        WOLF = "WOLF"  # WOLF 游戏文本
        RENPY = "RENPY"  # RENPY 游戏文本
        RPGMAKER = "RPGMAKER"  # RPGMAKER 游戏文本

    # 默认值
    id: int | None = None  # 数据库主键（自增）
    src: str = ""  # 原文
    dst: str = ""  # 译文
    name_src: str | list[str] | None = None  # 角色姓名原文
    name_dst: str | list[str] | None = None  # 角色姓名译文
    extra_field: str | dict = ""  # 额外字段原文
    tag: str = ""  # 标签
    row: int = 0  # 行号
    file_type: FileType = FileType.NONE  # 文件的类型
    file_path: str = ""  # 文件的相对路径
    text_type: TextType = TextType.NONE  # 文本的实际类型
    status: Base.ProjectStatus = Base.ProjectStatus.NONE  # 翻译状态
    retry_count: int = 0  # 重试次数，当前只有单独重试的时候才增加此计数

    # 线程锁
    lock: threading.Lock = dataclasses.field(
        init=False, repr=False, compare=False, default_factory=threading.Lock
    )

    # WOLF
    REGEX_WOLF: ClassVar[tuple] = (
        re.compile(r"@\d+", flags=re.IGNORECASE),  # 角色 ID
        re.compile(
            r"\\[cus]db\[.+?:.+?:.+?\]", flags=re.IGNORECASE
        ),  # 数据库变量 \cdb[0:1:2]
    )

    # RENPY
    CJK_RANGE: ClassVar[str] = (
        rf"{TextBase.CJK_RANGE}{TextBase.HANGUL_RANGE}{TextBase.HIRAGANA_RANGE}{TextBase.KATAKANA_RANGE}"
    )
    REGEX_RENPY: ClassVar[tuple] = (
        re.compile(r"\{[^\{" + CJK_RANGE + r"]*?\}", flags=re.IGNORECASE),  # {w=2.3}
        re.compile(
            r"\[[^\[" + CJK_RANGE + r"]*?\]", flags=re.IGNORECASE
        ),  # [renpy.version_only]
    )

    # RPGMaker
    REGEX_RPGMaker: ClassVar[tuple] = (
        re.compile(
            r"en\(.{0,8}[vs]\[\d+\].{0,16}\)", flags=re.IGNORECASE
        ),  # en(!s[982]) en(v[982] >= 1)
        re.compile(
            r"if\(.{0,8}[vs]\[\d+\].{0,16}\)", flags=re.IGNORECASE
        ),  # if(!s[982]) if(v[982] >= 1)
        re.compile(
            r"[/\\][a-z]{1,8}[<\[][a-z\d]{0,16}[>\]]", flags=re.IGNORECASE
        ),  # /c[xy12] \bc[xy12] <\bc[xy12]>
    )

    @classmethod
    def from_dict(cls, data: dict) -> Self:
        class_fields = {f.name for f in dataclasses.fields(cls)}
        filtered_data = {k: v for k, v in data.items() if k in class_fields}
        return cls(**filtered_data)

    def to_dict(self) -> dict[str, Any]:
        with self.lock:
            return {
                v.name: getattr(self, v.name)
                for v in dataclasses.fields(self)
                if v.init
            }

    def __post_init__(self) -> None:
        # 如果文件类型是 XLSX、TRANS、KVJSON、MESSAGEJSON，且没有文本类型，则判断实际的文本类型
        if (
            self.get_file_type()
            in (
                __class__.FileType.XLSX,
                __class__.FileType.KVJSON,
                __class__.FileType.MESSAGEJSON,
            )
            and self.get_text_type() == __class__.TextType.NONE
        ):
            if any(v.search(self.get_src()) is not None for v in __class__.REGEX_WOLF):
                self.set_text_type(__class__.TextType.WOLF)
            elif any(
                v.search(self.get_src()) is not None for v in __class__.REGEX_RPGMaker
            ):
                self.set_text_type(__class__.TextType.RPGMAKER)
            elif any(
                v.search(self.get_src()) is not None for v in __class__.REGEX_RENPY
            ):
                self.set_text_type(__class__.TextType.RENPY)

    # 获取数据库主键
    def get_id(self) -> int | None:
        with self.lock:
            return self.id

    # 设置数据库主键
    def set_id(self, id: int | None) -> None:
        with self.lock:
            self.id = id

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

    # 获取角色姓名原文
    def get_name_src(self) -> str | list[str] | None:
        with self.lock:
            return cast(str | list[str] | None, self.name_src)

    # 设置角色姓名原文
    def set_name_src(self, name_src: str | list[str] | None) -> None:
        with self.lock:
            self.name_src = name_src

    # 获取角色姓名译文
    def get_name_dst(self) -> str | list[str] | None:
        with self.lock:
            return cast(str | list[str] | None, self.name_dst)

    # 设置角色姓名译文
    def set_name_dst(self, name_dst: str | list[str] | None) -> None:
        with self.lock:
            self.name_dst = name_dst

    # 获取额外字段原文
    def get_extra_field(self) -> str | dict:
        with self.lock:
            return self.extra_field

    # 设置额外字段原文
    def set_extra_field(self, extra_field: str | dict) -> None:
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
    def get_file_type(self) -> FileType:
        with self.lock:
            return self.file_type

    # 设置文件类型
    def set_file_type(self, type: FileType) -> None:
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
    def get_text_type(self) -> TextType:
        with self.lock:
            return self.text_type

    # 设置文本类型
    def set_text_type(self, type: TextType) -> None:
        with self.lock:
            self.text_type = type

    # 获取翻译状态
    def get_status(self) -> Base.ProjectStatus:
        with self.lock:
            return self.status

    # 设置翻译状态
    def set_status(self, status: Base.ProjectStatus) -> None:
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
        return len(tiktoken.get_encoding("o200k_base").encode(self.get_src()))

    # 获取第一个角色姓名原文
    def get_first_name_src(self) -> str | None:
        name: str | None = None

        name_src: str | list[str] | None = self.get_name_src()
        if isinstance(name_src, str) and name_src != "":
            name = name_src
        elif isinstance(name_src, list) and name_src != []:
            name = name_src[0]

        return name

    # 设置第一个角色姓名译文
    def set_first_name_dst(self, name: str) -> None:
        name_src: str | list[str] | None = self.get_name_src()
        if isinstance(name_src, str) and name_src != "":
            self.set_name_dst(name)
        elif isinstance(name_src, list) and name_src != []:
            self.set_name_dst([name] + name_src[1:])
