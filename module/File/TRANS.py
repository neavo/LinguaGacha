import os
import re
import shutil
import itertools

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem

class TRANS(Base):

    RPGMAKER_EXCLUDED_PATH = (
        re.compile(r"\.js$", flags = re.IGNORECASE),
    )

    RPGMAKER_EXCLUDED_ADDRESS = (
        re.compile(r"filename", flags = re.IGNORECASE),
        re.compile(r"Tilesets/\d+/name", flags = re.IGNORECASE),
        re.compile(r"MapInfos/\d+/name", flags = re.IGNORECASE),
        re.compile(r"Animations/\d+/name", flags = re.IGNORECASE),
        re.compile(r"Map\d+/events/\d+/name", flags = re.IGNORECASE),
    )

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 过滤
    def filter_none(self, path: str, context: list[str]) -> bool:
        return False

    # 过滤 - Wolf
    def filter_wolf(self, path: str, context: list[str]) -> bool:
        return False

    # 过滤 - RPGMaker
    def filter_rpgmaker(self, path: str, context: list[str]) -> bool:
        if any(len(v.findall(path)) > 0 for v in TRANS.RPGMAKER_EXCLUDED_PATH):
            return True

        context = "\n".join(context)
        for rule in TRANS.RPGMAKER_EXCLUDED_ADDRESS:
            if len(rule.findall(context)) > 0:
                return True

        return False

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        items = []
        for abs_path in set(abs_paths):
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, self.input_path)

            # 将原始文件复制一份
            os.makedirs(os.path.dirname(f"{self.output_path}/cache/temp/{rel_path}"), exist_ok = True)
            shutil.copy(abs_path, f"{self.output_path}/cache/temp/{rel_path}")

            # 数据处理
            with open(abs_path, "r", encoding = "utf-8-sig") as reader:
                json_data = json.load(reader)

                # 有效性校验
                if not isinstance(json_data, dict):
                    continue

                # 获取项目信息
                project: dict = json_data.get("project", {})
                engine: str = project.get("gameEngine", "")

                # 设置排除规则
                if engine in ("wolf", ""):
                    filter = TRANS.filter_wolf
                    text_type = CacheItem.TextType.WOLF
                elif engine in ("2k", "RMJDB", "rmvx", "rmvxace", "rmmv", "rmmz"):
                    filter = TRANS.filter_rpgmaker
                    text_type = CacheItem.TextType.RPGMAKER
                else:
                    filter = TRANS.filter_none
                    text_type = CacheItem.TextType.NONE

                # 处理数据
                for path, entry in project.get("files", {}).items():
                    data: list[str] = []
                    context: list[str] = []
                    for data, tag, context in itertools.zip_longest(entry.get("data", []), entry.get("tags", []), entry.get("context", []), fillvalue = []):
                        # 有效性校验
                        if not isinstance(data, list) or len(data) == 0 or not isinstance(data[0], str):
                            continue

                        if len(data) >= 2 and isinstance(data[1], str) and data[1].strip() != "":
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[1],
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": Base.TranslationStatus.EXCLUDED,
                                })
                            )
                        elif any(v in ("red", "blue") for v in tag or []):
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[0],
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": Base.TranslationStatus.EXCLUDED,
                                })
                            )
                        elif filter(self, path, context):
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[0],
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "extra_field": "gold",
                                    "status": Base.TranslationStatus.EXCLUDED,
                                })
                            )
                        else:
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[0],
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": Base.TranslationStatus.UNTRANSLATED,
                                })
                            )

        return items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:
        # 筛选
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.TRANS
        ]

        # 按文件路径分组
        data: dict[str, list[str]] = {}
        for item in target:
            data.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in data.items():
            # 按行号排序
            items = sorted(items, key = lambda x: x.get_row())

            # 处理文件
            abs_path = f"{self.output_path}/{rel_path}"
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            with open(abs_path, "w", encoding = "utf-8") as writer:
                with open(f"{self.output_path}/cache/temp/{rel_path}", "r", encoding = "utf-8-sig") as reader:
                    json_data = json.load(reader)

                    # 有效性校验
                    if not isinstance(json_data, dict):
                        continue

                    # 获取项目信息
                    project: dict = json_data.get("project", {})
                    files: dict = project.get("files", {})

                    # 处理数据
                    for tag in files.keys():
                        target_items = [item for item in items if item.get_tag() == tag]

                        tags: list[str] = []
                        data: list[str] = []
                        for i, item in enumerate(target_items):
                            data.append((item.get_src(), item.get_dst()))
                            if i >= len(json_data["project"]["files"][tag]["tags"]):
                                t = set()
                            elif json_data["project"]["files"][tag]["tags"][i] is None:
                                t = set()
                            else:
                                t = set(json_data["project"]["files"][tag]["tags"][i])
                            if item.get_extra_field() != "":
                                t.add(item.get_extra_field())
                            tags.append(list(t))
                        json_data["project"]["files"][tag]["tags"] = tags
                        json_data["project"]["files"][tag]["data"] = data

                # 写入文件
                json.dump(json_data, writer, indent = 4, ensure_ascii = False)