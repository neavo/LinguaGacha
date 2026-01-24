import os
import re

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Storage.PathStore import PathStore
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

            # 数据处理
            with open(abs_path, "rb") as reader:
                items.extend(self.read_from_stream(reader.read(), rel_path))

        return items

    # 从流读取
    def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
        items: list[Item] = []

        # 获取文件编码
        encoding = TextHelper.get_encoding(content=content, add_sig_to_utf8=True)

        # 数据处理
        text = content.decode(encoding)
        chunks = re.split(r"\n{2,}", text.strip())
        for chunk in chunks:
            lines = [line.strip() for line in chunk.splitlines()]

            # 格式校验
            if len(lines) < 3 or not lines[0].isdecimal():
                continue

            # 添加数据
            if lines[-1] != "":
                items.append(
                    Item.from_dict(
                        {
                            "src": "\n".join(lines[2:]),  # 如有多行文本则用换行符拼接
                            "dst": "\n".join(lines[2:]),  # 如有多行文本则用换行符拼接
                            "extra_field": lines[1],
                            "row": int(lines[0]),
                            "file_type": Item.FileType.SRT,
                            "file_path": rel_path,
                        }
                    )
                )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 获取输出目录
        output_path = PathStore.get_translated_path()
        bilingual_path = PathStore.get_bilingual_path()

        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.SRT]

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, group_items in group.items():
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            result = []
            for item in group_items:
                result.append(
                    [
                        str(item.get_row()),
                        str(item.get_extra_field()),
                        item.get_dst(),
                    ]
                )

            with open(self.insert_target(abs_path), "w", encoding="utf-8") as writer:
                for item_lines in result:
                    writer.write("\n".join(item_lines))
                    writer.write("\n\n")

        # 分别处理每个文件（双语）
        for rel_path, group_items in group.items():
            result = []
            for item in group_items:
                if (
                    self.config.deduplication_in_bilingual
                    and item.get_src() == item.get_dst()
                ):
                    result.append(
                        [
                            str(item.get_row()),
                            str(item.get_extra_field()),
                            item.get_dst(),
                        ]
                    )
                else:
                    result.append(
                        [
                            str(item.get_row()),
                            str(item.get_extra_field()),
                            f"{item.get_src()}\n{item.get_dst()}",
                        ]
                    )

            abs_path = os.path.join(bilingual_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(
                self.insert_source_target(abs_path), "w", encoding="utf-8"
            ) as writer:
                for item_lines in result:
                    writer.write("\n".join(item_lines))
                    writer.write("\n\n")
