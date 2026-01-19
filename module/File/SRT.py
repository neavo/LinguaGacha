import os
import re

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.OutputPath import OutputPath
from module.Text.TextHelper import TextHelper


class SRT(Base):
    # 1
    # 00:00:08,120 --> 00:00:10,460
    # にゃにゃにゃ

    # 2
    # 00:00:14,000 --> 00:00:15,880
    # えーこの部屋一人で使

    # 3
    # 00:00:15,880 --> 00:00:17,300
    # えるとか最高じゃん

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

    # 在扩展名前插入文本
    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.target_language.lower()}{ext}"

    # 在扩展名前插入文本
    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return (
            f"{root}.{self.source_language.lower()}.{self.target_language.lower()}{ext}"
        )

    # 读取
    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        items: list[Item] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, input_path)

            # 获取文件编码
            encoding = TextHelper.get_enconding(path=abs_path, add_sig_to_utf8=True)

            # 数据处理
            with open(abs_path, "r", encoding=encoding) as reader:
                chunks = re.split(r"\n{2,}", reader.read().strip())
                for chunk in chunks:
                    lines = [line.strip() for line in chunk.splitlines()]

                    # isdecimal
                    # 字符串中的字符是否全是十进制数字。也就是说，只有那些在数字系统中被认为是"基本"的数字字符（0-9）才会返回 True。
                    # isdigit
                    # 字符串中的字符是否都是数字字符。它不仅检查十进制数字，还包括其他可以表示数字的字符，如数字上标、罗马数字、圆圈数字等。
                    # isnumeric
                    # 字符串中的字符是否表示任何类型的数字，包括整数、分数、数字字符的变种（比如上标、下标）以及其他可以被认为是数字的字符（如中文数字）。

                    # 格式校验
                    if len(lines) < 3 or not lines[0].isdecimal():
                        continue

                    # 添加数据
                    if lines[-1] != "":
                        items.append(
                            Item.from_dict(
                                {
                                    "src": "\n".join(
                                        lines[2:]
                                    ),  # 如有多行文本则用换行符拼接
                                    "dst": "\n".join(
                                        lines[2:]
                                    ),  # 如有多行文本则用换行符拼接
                                    "extra_field": lines[1],
                                    "row": str(lines[0]),
                                    "file_type": Item.FileType.SRT,
                                    "file_path": rel_path,
                                }
                            )
                        )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 获取输出目录
        output_path = OutputPath.get_translated_path()
        bilingual_path = OutputPath.get_bilingual_path()

        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.SRT]

        # 按文件路径分组
        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in group.items():
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            result: list[str] = []
            for item in items:
                result.append(
                    [
                        item.get_row(),
                        item.get_extra_field(),
                        item.get_dst(),
                    ]
                )

            with open(self.insert_target(abs_path), "w", encoding="utf-8") as writer:
                for item in result:
                    writer.write("\n".join(item))
                    writer.write("\n\n")

        # 分别处理每个文件（双语）
        for rel_path, items in group.items():
            result: list[str] = []
            for item in items:
                if (
                    self.config.deduplication_in_bilingual
                    and item.get_src() == item.get_dst()
                ):
                    result.append(
                        [
                            item.get_row(),
                            item.get_extra_field(),
                            item.get_dst(),
                        ]
                    )
                else:
                    result.append(
                        [
                            item.get_row(),
                            item.get_extra_field(),
                            f"{item.get_src()}\n{item.get_dst()}",
                        ]
                    )

            abs_path = os.path.join(bilingual_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(
                self.insert_source_target(abs_path), "w", encoding="utf-8"
            ) as writer:
                for item in result:
                    writer.write("\n".join(item))
                    writer.write("\n\n")
