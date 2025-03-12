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
        re.compile(r"CommonEvents/\d+/name", flags = re.IGNORECASE),
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
        return context, []

    # 过滤 - Wolf
    def filter_wolf(self, path: str, context: list[str]) -> bool:
        return context, []

    # 过滤 - RenPy
    def filter_renpy(self, path: str, context: list[str]) -> bool:
        return context, []

    # 过滤 - RPGMaker
    def filter_rpgmaker(self, path: str, context: list[str]) -> tuple[list[str], list[str]]:
        if any(len(v.findall(path)) > 0 for v in TRANS.RPGMAKER_EXCLUDED_PATH):
            return [], context

        allow: list[str] = []
        block: list[str] = []
        for address in context:
            if any(rule.search(address) for rule in TRANS.RPGMAKER_EXCLUDED_ADDRESS):
                block.append(address)  # 命中规则，加入 block 列表
            else:
                allow.append(address)  # 未命中规则，加入 allow 列表

        return allow, block

    # 生成参数
    def generate_parameter_none(self, src: str, context: list[str], parameter: list[dict[str, str]]) -> list[dict[str, str]]:
        return parameter

    # 生成参数 - Wolf
    def generate_parameter_wolf(self, src: str, context: list[str], parameter: list[dict[str, str]]) -> list[dict[str, str]]:
        return parameter

    # 生成参数 - Renpy
    def generate_parameter_renpy(self, src: str, context: list[str], parameter: list[dict[str, str]]) -> list[dict[str, str]]:
        return parameter

    # 生成参数 - RPGMaker
    def generate_parameter_rpgmaker(self, src: str, context: list[str], parameter: list[dict[str, str]]) -> list[dict[str, str]]:
        if parameter is None:
            parameter = []

        for i, address in enumerate(context):
            # 补足数量
            if i >= len(parameter):
                parameter.append({})

            # 分情况判断，排除需要排除的地址
            if any(rule.search(address) for rule in TRANS.RPGMAKER_EXCLUDED_ADDRESS):
                parameter[-1]["contextStr"] = address
                parameter[-1]["translation"] = src
            else:
                parameter[-1]["contextStr"] = address
                parameter[-1]["translation"] = ""

        # 如果所有条目都需要排除，则不需要启用分区翻译功能
        if all(v.get("translation") == src for v in parameter):
            for v in parameter:
                v["translation"] = ""

        return parameter

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
                if engine == "wolf":
                    filter_func = self.filter_wolf
                    text_type = CacheItem.TextType.WOLF
                elif engine == "renpy":
                    filter_func = self.filter_renpy
                    text_type = CacheItem.TextType.RENPY
                elif engine in ("2k", "RMJDB", "rmvx", "rmvxace", "rmmv", "rmmz"):
                    filter_func = self.filter_rpgmaker
                    text_type = CacheItem.TextType.RPGMAKER
                else:
                    filter_func = self.filter_none
                    text_type = CacheItem.TextType.NONE

                # 处理数据
                for path, entry in project.get("files", {}).items():
                    for data, tag, context, parameter in itertools.zip_longest(
                        entry.get("data", []),
                        entry.get("tags", []),
                        entry.get("context", []),
                        entry.get("parameters", []),
                        fillvalue = []
                    ):
                        # 有效性校验
                        if not isinstance(data, list) or len(data) == 0 or not isinstance(data[0], str):
                            continue

                        # 处理可能为 None 的情况
                        tag = tag if tag is not None else []

                        # 如果包含 水蓝色 标签，则强制重新翻译
                        if any(v == "aqua" for v in tag):
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[0],
                                    "extra_field": {
                                        "tag": tag,
                                        "context": context,
                                        "parameter": parameter,
                                    },
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": Base.TranslationStatus.UNTRANSLATED,
                                })
                            )
                        # 如果 第一列、第二列 都有文本，则跳过
                        elif len(data) >= 2 and isinstance(data[1], str) and data[1].strip() != "":
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[1],
                                    "tag": path,
                                    "extra_field": {
                                        "tag": tag,
                                        "context": context,
                                        "parameter": parameter,
                                    },
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": Base.TranslationStatus.EXCLUDED,
                                })
                            )
                        # 如果包含 红色、蓝色 标签，则跳过
                        elif any(v in ("red", "blue") for v in tag):
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[0],
                                    "extra_field": {
                                        "tag": tag,
                                        "context": context,
                                        "parameter": parameter,
                                    },
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": Base.TranslationStatus.EXCLUDED,
                                })
                            )
                        # 如果没有允许翻译的上下文地址，则跳过，否则正常翻译
                        else:
                            allow, block = filter_func(path, context)
                            tag = tag if len(block) == 0 else list(set(tag + ["gold"]))
                            status = Base.TranslationStatus.EXCLUDED if len(allow) == 0 else Base.TranslationStatus.UNTRANSLATED
                            items.append(
                                CacheItem({
                                    "src": data[0],
                                    "dst": data[0],
                                    "extra_field": {
                                        "tag": tag,
                                        "context": context,
                                        "parameter": parameter,
                                    },
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": text_type,
                                    "status": status,
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
                    engine: str = project.get("gameEngine", "")

                    # 设置排除规则
                    if engine == "wolf":
                        generate_func = self.generate_parameter_wolf
                    elif engine == "renpy":
                        generate_func = self.generate_parameter_renpy
                    elif engine in ("2k", "RMJDB", "rmvx", "rmvxace", "rmmv", "rmmz"):
                        generate_func = self.generate_parameter_rpgmaker
                    else:
                        generate_func = self.generate_parameter_none

                    # 处理数据
                    for path in files.keys():
                        tags: list[str] = []
                        data: list[str] = []
                        context: list[str] = []
                        parameters: list[dict[str, str]] = []
                        for item in [item for item in items if item.get_tag() == path]:
                            data.append((item.get_src(), item.get_dst()))

                            extra_field: dict[str, list[str]] = item.get_extra_field()
                            tags.append(extra_field.get("tag", []))
                            context.append(extra_field.get("context", []))
                            parameters.append(
                                generate_func(
                                    item.get_src(),
                                    extra_field.get("context", []),
                                    extra_field.get("parameter", []),
                                )
                            )
                        json_data["project"]["files"][path]["tags"] = tags
                        json_data["project"]["files"][path]["data"] = data
                        json_data["project"]["files"][path]["context"] = context
                        json_data["project"]["files"][path]["parameters"] = parameters

                # 写入文件
                json.dump(json_data, writer, indent = 4, ensure_ascii = False)