import os

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
        text = content.decode(encoding)

        # 使用 splitlines() 原生处理各种换行符，无需手动归一化
        lines = text.splitlines()
        current_chunk: list[str] = []

        def process_chunk(chunk: list[str]) -> None:
            # 格式校验：标准 SRT 块至少包含序号、时间、文本三部分
            if len(chunk) < 3 or not chunk[0].isdecimal():
                return

            items.append(
                Item.from_dict(
                    {
                        "src": "\n".join(chunk[2:]),
                        "dst": "\n".join(chunk[2:]),
                        "extra_field": chunk[1],
                        "row": int(chunk[0]),
                        "file_type": Item.FileType.SRT,
                        "file_path": rel_path,
                    }
                )
            )

        for line in lines:
            stripped = line.strip()

            # 空行作为分隔符
            if not stripped:
                if current_chunk:
                    process_chunk(current_chunk)
                    current_chunk = []
            else:
                current_chunk.append(stripped)

        # 处理文件末尾可能的最后一个块
        if current_chunk:
            process_chunk(current_chunk)

        return items

    def write_to_path(self, items: list[Item]) -> None:
        output_path = PathStore.get_translated_path()
        bilingual_path = PathStore.get_bilingual_path()

        # 筛选 SRT 条目
        target_items = [i for i in items if i.get_file_type() == Item.FileType.SRT]
        if not target_items:
            return

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target_items:
            group.setdefault(item.get_file_path(), []).append(item)

        # 同时处理翻译和双语文件写入
        for rel_path, group_items in group.items():
            abs_out = os.path.join(output_path, rel_path)
            abs_bi = os.path.join(bilingual_path, rel_path)

            os.makedirs(os.path.dirname(abs_out), exist_ok=True)
            os.makedirs(os.path.dirname(abs_bi), exist_ok=True)

            target_path = self.insert_target(abs_out)
            bilingual_target_path = self.insert_source_target(abs_bi)

            with (
                open(target_path, "w", encoding="utf-8") as f_out,
                open(bilingual_target_path, "w", encoding="utf-8") as f_bi,
            ):
                for item in group_items:
                    row = str(item.get_row())
                    time_code = str(item.get_extra_field())
                    src = item.get_src()
                    dst = item.get_dst()

                    # 写入翻译文件
                    f_out.write(f"{row}\n{time_code}\n{dst}\n\n")

                    # 写入双语文件
                    if self.config.deduplication_in_bilingual and src == dst:
                        content = dst
                    else:
                        content = f"{src}\n{dst}"
                    f_bi.write(f"{row}\n{time_code}\n{content}\n\n")
