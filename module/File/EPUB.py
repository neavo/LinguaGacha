import os

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.File.EPUBAst import EPUBAst
from module.File.EPUBAstWriter import EPUBAstWriter


class EPUB(Base):
    def __init__(self, config: Config) -> None:
        super().__init__()
        self.config = config
        self.ast = EPUBAst(config)
        self.writer = EPUBAstWriter(config)

    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.config.target_language.lower()}{ext}"

    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.config.source_language.lower()}.{self.config.target_language.lower()}{ext}"

    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        items: list[Item] = []
        for abs_path in abs_paths:
            rel_path = os.path.relpath(abs_path, input_path)
            with open(abs_path, "rb") as reader:
                items.extend(self.read_from_stream(reader.read(), rel_path))
        return items

    def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
        return self.ast.read_from_stream(content, rel_path)

    def write_to_path(self, items: list[Item]) -> None:
        target = [item for item in items if item.get_file_type() == Item.FileType.EPUB]

        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        dm = DataManager.get()

        # 单语
        for rel_path, group_items in group.items():
            output_path = dm.get_translated_path()
            abs_path = os.path.join(output_path, rel_path)

            original_content = dm.get_asset_decompressed(rel_path)
            if original_content is None:
                continue

            out_epub_path = self.insert_target(abs_path)
            self.writer.build_epub(
                original_epub_bytes=original_content,
                items=group_items,
                out_path=out_epub_path,
                bilingual=False,
            )

        # 双语
        for rel_path, group_items in group.items():
            output_path = dm.get_bilingual_path()
            abs_path = os.path.join(output_path, rel_path)

            original_content = dm.get_asset_decompressed(rel_path)
            if original_content is None:
                continue

            out_epub_path = self.insert_source_target(abs_path)
            self.writer.build_epub(
                original_epub_bytes=original_content,
                items=group_items,
                out_path=out_epub_path,
                bilingual=True,
            )
