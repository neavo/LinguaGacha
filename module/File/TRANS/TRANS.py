import itertools
import json
import os

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.File.TRANS.KAG import KAG
from module.File.TRANS.NONE import NONE
from module.File.TRANS.RENPY import RENPY
from module.File.TRANS.RPGMAKER import RPGMAKER
from module.File.TRANS.WOLF import WOLF
from module.Storage.AssetStore import AssetStore
from module.Storage.PathStore import PathStore
from module.Storage.StorageContext import StorageContext

class TRANS(Base):
    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

    # 读取
    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        items: list[Item] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, input_path)

            # 数据处理
            with open(abs_path, "r", encoding="utf-8-sig") as reader:
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
                        fillvalue=None,
                    ):
                        # 处理可能为 None 的情况
                        tag: list[str] = tag if tag is not None else []
                        data: list[str] = data if data is not None else []
                        context: list[str] = context if context is not None else []
                        parameter: list[str] = (
                            parameter if parameter is not None else []
                        )

                        # 检查并添加数据
                        src, dst, tag, status, skip_internal_filter = processor.check(
                            path, data, tag, context
                        )
                        items.append(
                            Item.from_dict(
                                {
                                    "src": src,
                                    "dst": dst,
                                    "extra_field": {
                                        "tag": tag,
                                        "context": context,
                                        "parameter": parameter,
                                    },
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": Item.FileType.TRANS,
                                    "file_path": rel_path,
                                    "text_type": processor.TEXT_TYPE,
                                    "status": status,
                                    "skip_internal_filter": skip_internal_filter,
                                }
                            )
                        )

            # 去重
            if self.config.deduplication_in_trans:
                translation: dict[str, str] = {}
                for item in [
                    v for v in items if v.get_status() == Base.ProjectStatus.NONE
                ]:
                    src = item.get_src()
                    dst = item.get_dst()
                    if src not in translation:
                        translation[src] = dst
                    else:
                        item.set_status(Base.ProjectStatus.DUPLICATED)

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.TRANS]

        # 按文件路径分组
        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in group.items():
            # 按行号排序
            items = sorted(items, key=lambda x: x.get_row())

            # 获取输出目录
            output_path = PathStore.get_translated_path()

            # 数据处理
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            # 从工程 assets 获取原始文件内容
            db = StorageContext.get().get_db()
            if db is None:
                continue
            compressed = db.get_asset(rel_path)
            if compressed is None:
                continue
            original_content = AssetStore.decompress(compressed).decode("utf-8-sig")
            json_data = json.loads(original_content)

            with open(abs_path, "w", encoding="utf-8") as writer:
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
                if self.config.deduplication_in_trans:
                    translation: dict[str, str] = {}
                    for item in [
                        v
                        for v in items
                        if v.get_status() == Base.ProjectStatus.PROCESSED
                    ]:
                        src = item.get_src()
                        dst = item.get_dst()
                        if src not in translation:
                            translation[src] = dst
                    for item in [
                        v
                        for v in items
                        if v.get_status() == Base.ProjectStatus.DUPLICATED
                    ]:
                        src = item.get_src()
                        dst = item.get_dst()
                        if src in translation:
                            item.set_dst(translation.get(src))

                # 处理数据
                path: str = ""
                for path in files.keys():
                    tags: list[list[str]] = []
                    data: list[list[str]] = []
                    context: list[list[str]] = []
                    parameters: list[dict[str, str]] = []
                    for item in [item for item in items if item.get_tag() == path]:
                        data.append((item.get_src(), item.get_dst()))

                        extra_field: dict[str, list[str]] = item.get_extra_field()
                        tags.append(extra_field.get("tag", []))
                        context.append(extra_field.get("context", []))

                        # 当翻译状态为 已排除、过去已翻译 时，直接使用原始参数
                        if item.get_status() in (
                            Base.ProjectStatus.EXCLUDED,
                            Base.ProjectStatus.PROCESSED_IN_PAST,
                        ):
                            parameters.append(extra_field.get("parameter", []))
                        # 否则，判断与计算分区翻译功能参数
                        else:
                            parameters.append(
                                processor.generate_parameter(
                                    src=item.get_src(),
                                    context=extra_field.get("context", []),
                                    parameter=extra_field.get("parameter", []),
                                    block=processor.filter(
                                        src=item.get_src(),
                                        path=path,
                                        tag=extra_field.get("tags", []),
                                        context=extra_field.get("context", []),
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
                json.dump(json_data, writer, indent=None, ensure_ascii=False)

    # 获取处理实体
    def get_processor(self, project: dict) -> NONE:
        engine: str = project.get("gameEngine", "")

        if engine.lower() in ("kag", "vntrans"):
            processor: NONE = KAG(project)
        elif engine.lower() in ("wolf", "wolfrpg"):
            processor: NONE = WOLF(project)
        elif engine.lower() in ("renpy",):
            processor: NONE = RENPY(project)
        elif engine.lower() in (
            "2k",
            "2k3",
            "rmjdb",
            "rmxp",
            "rmvx",
            "rmvxace",
            "rmmv",
            "rmmz",
        ):
            processor: NONE = RPGMAKER(project)
        else:
            processor: NONE = NONE(project)

        return processor
