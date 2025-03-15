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
        return [False] * len(context)

    # 过滤 - Wolf
    def filter_wolf(self, path: str, context: list[str]) -> bool:
        return [False] * len(context)

    # 过滤 - RenPy
    def filter_renpy(self, path: str, context: list[str]) -> bool:
        return [False] * len(context)

    # 过滤 - RPGMaker
    def filter_rpgmaker(self, path: str, context: list[str]) -> list[bool]:
        if any(len(v.findall(path)) > 0 for v in TRANS.RPGMAKER_EXCLUDED_PATH):
            return [True] * len(context)

        block: list[bool] = []
        for address in context:
            if any(len(rule.findall(address)) > 0 for rule in TRANS.RPGMAKER_EXCLUDED_ADDRESS):
                block.append(True)
            else:
                block.append(False)

        return block

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
        # 查找需要排除的地址
        block = self.filter_rpgmaker("", context)

        # 如果全部需要排除或者全部需要保留，则不需要启用分区翻译功能
        if all(v is True for v in block) or all(v is False for v in block):
            pass
        else:
            if parameter is None:
                parameter = []
            for i, v in enumerate(block):
                if i >= len(parameter):
                    parameter.append({})
                parameter[i]["contextStr"] = context[i]
                parameter[i]["translation"] = src if v == True else ""

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
                if engine.lower() == "wolf":
                    filter_func = self.filter_wolf
                    text_type = CacheItem.TextType.WOLF
                elif engine.lower() == "renpy":
                    filter_func = self.filter_renpy
                    text_type = CacheItem.TextType.RENPY
                elif engine.lower() in ("2k", "rmjdb", "rmvx", "rmvxace", "rmmv", "rmmz"):
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
                            block = filter_func(path, context)
                            tag =  list(set(tag + ["gold"])) if any(v == True for v in block) else tag
                            status = Base.TranslationStatus.UNTRANSLATED if any(v == False for v in block) else Base.TranslationStatus.EXCLUDED
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
                    if engine.lower() == "wolf":
                        generate_func = self.generate_parameter_wolf
                    elif engine.lower() == "renpy":
                        generate_func = self.generate_parameter_renpy
                    elif engine.lower() in ("2k", "rmjdb", "rmvx", "rmvxace", "rmmv", "rmmz"):
                        generate_func = self.generate_parameter_rpgmaker
                    else:
                        generate_func = self.generate_parameter_none

                    # 处理数据
                    for path in files.keys():
                        tags: list[list[str]] = []
                        data: list[list[str]]  = []
                        context: list[list[str]]  = []
                        parameters: list[dict[str, str]] = []
                        for item in [item for item in items if item.get_tag() == path]:
                            data.append((item.get_src(), item.get_dst()))

                            extra_field: dict[str, list[str]] = item.get_extra_field()
                            tags.append(extra_field.get("tag", []))
                            context.append(extra_field.get("context", []))

                            # 当翻译状态为排除时，直接使用原始参数
                            if item.get_status() == Base.TranslationStatus.EXCLUDED:
                                parameters.append(extra_field.get("parameter", []))
                            # 否则，判断与计算分区翻译功能参数
                            else:
                                parameters.append(
                                    generate_func(
                                        item.get_src(),
                                        extra_field.get("context", []),
                                        extra_field.get("parameter", []),
                                    )
                                )

                        # 清理
                        if all(v == None or len(v) == 0 for v in tags):
                            tags = []
                        if all(v == None or len(v) == 0 for v in parameters):
                            parameters = []

                        # 赋值
                        json_data["project"]["files"][path]["tags"] = tags
                        json_data["project"]["files"][path]["data"] = data
                        json_data["project"]["files"][path]["context"] = context
                        json_data["project"]["files"][path]["parameters"] = parameters

                # 写入文件
                json.dump(json_data, writer, indent = None, ensure_ascii = False)