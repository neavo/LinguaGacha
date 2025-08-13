import os
import json

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Config import Config

class PARATRANZJSON(Base):

    # [
    #   {
    #     "key": "KEY 键值",
    #     "original": "source text 原文",
    #     "translation": "translation text 译文"
    #   }
    # ]

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.input_path: str = config.input_folder
        self.output_path: str = config.output_folder
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

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
                json_data: list[dict] = json.load(reader)

                # 格式校验
                if not isinstance(json_data, list):
                    continue

                # 读取数据
                for entry in json_data:
                    if not isinstance(entry, dict):
                        continue
                    
                    key = entry.get("key")
                    original = entry.get("original")
                    translation = entry.get("translation")

                    if isinstance(key, str) and isinstance(original, str) and isinstance(translation, str):
                        src = original
                        dst = translation
                        pzkey = key
                        

                        if src == "":
                            status = Base.TranslationStatus.EXCLUDED
                        elif dst != "" and src != dst:
                            status = Base.TranslationStatus.TRANSLATED_IN_PAST
                        else:
                            status = Base.TranslationStatus.UNTRANSLATED
                        
                        items.append(
                            CacheItem.from_dict({
                                "pzkey": pzkey,
                                "src": src,
                                "dst": dst,
                                "row": len(items),
                                "file_type": CacheItem.FileType.PARATRANZJSON,
                                "file_path": rel_path,
                                "status": status,
                               
                            })
                        )

        return items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.PARATRANZJSON
        ]

        group: dict[str, list[CacheItem]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        for rel_path, file_items in group.items():
            # 按行号排序
            file_items = sorted(file_items, key = lambda x: x.get_row())
            
            abs_path = os.path.join(self.output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            
            result_data = []
            for item in file_items:              
                result_data.append({
                    "key": item.get_pzkey(),
                    "original": item.get_src(),
                    "translation": item.get_dst()
                })

            with open(abs_path, "w", encoding = "utf-8") as writer:
                writer.write(
                    json.dumps(
                        result_data,
                        indent = 2,
                        ensure_ascii = False,
                    )
                )