import os

from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Localizer.Localizer import Localizer
from module.ExpertConfig import ExpertConfig

class TXT(Base):

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: BaseLanguage.Enum = config.get("source_language")
        self.target_language: BaseLanguage.Enum = config.get("target_language")

    # 在扩展名前插入文本
    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.target_language.lower()}{ext}"

    # 在扩展名前插入文本
    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.source_language.lower()}.{self.target_language.lower()}{ext}"

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        items:list[CacheItem] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, self.input_path)

            # 获取文件编码
            encoding = TextHelper.get_enconding(path = abs_path, add_sig_to_utf8 = True)

            # 数据处理
            with open(abs_path, "r", encoding = encoding) as reader:
                for line in [line.removesuffix("\n") for line in reader.readlines()]:
                    items.append(
                        CacheItem({
                            "src": line,
                            "dst": line,
                            "row": len(items),
                            "file_type": CacheItem.FileType.TXT,
                            "file_path": rel_path,
                        })
                    )

        return items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:
        # 筛选
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.TXT
        ]

        # 按文件路径分组
        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in group.items():
            abs_path = os.path.join(self.output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            with open(self.insert_target(abs_path), "w", encoding = "utf-8") as writer:
                writer.write("\n".join([item.get_dst() for item in items]))

        # 分别处理每个文件（双语）
        for rel_path, items in group.items():
            abs_path = f"{self.output_path}/{Localizer.get().path_bilingual}/{rel_path}"
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            with open(self.insert_source_target(abs_path), "w", encoding = "utf-8") as writer:
                result: list[str] = []
                for item in items:
                    if ExpertConfig.get().deduplication_in_bilingual == True and item.get_src() == item.get_dst():
                        result.append(item.get_dst())
                    else:
                        result.append(f"{item.get_src()}\n{item.get_dst()}")
                writer.write("\n".join(result))
