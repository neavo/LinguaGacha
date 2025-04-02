import os
import shutil
import itertools

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.File.TRANS.NONE import NONE
from module.File.TRANS.WOLF import WOLF
from module.File.TRANS.RENPY import RENPY
from module.File.TRANS.RPGMAKER import RPGMAKER

class TRANS(Base):

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        items: list[CacheItem] = []
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

                # 获取处理实体
                processor: NONE = self.get_processor(project)
                processor.pre_process()

                # 处理数据
                path: str = ""
                entry: dict = {}
                files: dict = project.get("files", {})
                for path, entry in files.items():
                    for tag, data, context, parameter in itertools.zip_longest(
                        entry.get("tags", []),
                        entry.get("data", []),
                        entry.get("context", []),
                        entry.get("parameters", []),
                        fillvalue = None
                    ):
                        # 处理可能为 None 的情况
                        tag: list[str] = tag if tag is not None else []
                        data: list[str] = data if data is not None else []
                        context: list[str] = context if context is not None else []
                        parameter: list[str] = parameter if parameter is not None else []

                        # 检查并添加数据
                        src, dst, tag, status, skip_internal_filter = processor.check(path, data, tag, context)
                        items.append(
                            CacheItem({
                                "src": src,
                                "dst": dst,
                                "extra_field": {
                                    "tag": tag,
                                    "context": context,
                                    "parameter": parameter,
                                },
                                "tag": path,
                                "row": len(items),
                                "file_type": CacheItem.FileType.TRANS,
                                "file_path": rel_path,
                                "text_type": processor.TEXT_TYPE,
                                "status": status,
                                "skip_internal_filter": skip_internal_filter,
                            })
                        )

            # 去重
            translation: dict[str, str] = {}
            for item in [v for v in items if v.get_status() == Base.TranslationStatus.UNTRANSLATED]:
                src = item.get_src()
                dst = item.get_dst()
                if src not in translation:
                    translation[src] = dst
                else:
                    item.set_status(Base.TranslationStatus.DUPLICATED)

        return items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:
        # 筛选
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.TRANS
        ]

        # 按文件路径分组
        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in group.items():
            # 按行号排序
            items = sorted(items, key = lambda x: x.get_row())

            # 数据处理
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

                    # 获取处理实体
                    processor: NONE = self.get_processor(project)
                    processor.post_process()

                    # 去重
                    translation: dict[str, str] = {}
                    for item in [v for v in items if v.get_status() == Base.TranslationStatus.TRANSLATED]:
                        src = item.get_src()
                        dst = item.get_dst()
                        if src not in translation:
                            translation[src] = dst
                    for item in [v for v in items if v.get_status() == Base.TranslationStatus.DUPLICATED]:
                        src = item.get_src()
                        dst = item.get_dst()
                        if src in translation:
                            item.set_dst(translation.get(src))

                    # 处理数据
                    path: str = ""
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

                            # 当翻译状态为 已排除、过去已翻译 时，直接使用原始参数
                            if item.get_status() in (Base.TranslationStatus.EXCLUDED, Base.TranslationStatus.TRANSLATED_IN_PAST):
                                parameters.append(extra_field.get("parameter", []))
                            # 否则，判断与计算分区翻译功能参数
                            else:
                                parameters.append(
                                    processor.generate_parameter(
                                        src = item.get_src(),
                                        context = extra_field.get("context", []),
                                        parameter = extra_field.get("parameter", []),
                                        block = processor.filter(
                                            src = item.get_src(),
                                            path = path,
                                            tag = extra_field.get("tags", []),
                                            context = extra_field.get("context", []),
                                        ),
                                    )
                                )

                        # 清理
                        if all(v is None or len(v) == 0 for v in tags):
                            tags = []
                        if all(v is None or len(v) == 0 for v in parameters):
                            parameters = []

                        # 赋值
                        json_data["project"]["files"][path]["tags"] = tags
                        json_data["project"]["files"][path]["data"] = data
                        json_data["project"]["files"][path]["context"] = context
                        json_data["project"]["files"][path]["parameters"] = parameters

                # 写入文件
                json.dump(json_data, writer, indent = None, ensure_ascii = False)

    # 获取处理实体
    def get_processor(self, project: dict) -> NONE:
        engine: str = project.get("gameEngine", "")

        if engine.lower() in ("wolf", "wolfrpg"):
            processor: NONE = WOLF(project)
        elif engine.lower() == "renpy":
            processor: NONE = RENPY(project)
        elif engine.lower() in ("2k", "rmjdb", "rmvx", "rmvxace", "rmmv", "rmmz"):
            processor: NONE = RPGMAKER(project)
        else:
            processor: NONE = NONE(project)

        return processor