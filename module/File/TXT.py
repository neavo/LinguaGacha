import os

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Storage.PathStore import PathStore
from module.Text.TextHelper import TextHelper


class TXT(Base):
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
        for line in text.splitlines():
            items.append(
                Item.from_dict(
                    {
                        "src": line,
                        "dst": line,
                        "row": len(items),
                        "file_type": Item.FileType.TXT,
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
        target = [item for item in items if item.get_file_type() == Item.FileType.TXT]

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, group_items in group.items():
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(self.insert_target(abs_path), "w", encoding="utf-8") as writer:
                writer.write("\n".join([item.get_dst() for item in group_items]))

        # 分别处理每个文件（双语）
        for rel_path, group_items in group.items():
            abs_path = os.path.join(bilingual_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(
                self.insert_source_target(abs_path), "w", encoding="utf-8"
            ) as writer:
                result: list[str] = []
                for item in group_items:
                    if (
                        self.config.deduplication_in_bilingual
                        and item.get_src() == item.get_dst()
                    ):
                        result.append(item.get_dst())
                    else:
                        result.append(f"{item.get_src()}\n{item.get_dst()}")
                writer.write("\n".join(result))
