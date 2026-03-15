import os

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.File.TRANS.KAG import KAG
from module.File.TRANS.NONE import NONE
from module.File.TRANS.RENPY import RENPY
from module.File.TRANS.RPGMAKER import RPGMAKER
from module.File.TRANS.WOLF import WOLF
from module.Utils.GapTool import GapTool
from module.Utils.JSONTool import JSONTool


class TRANS(Base):
    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config

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

        # 数据处理
        # .trans 文件固定为 UTF-8（可能带 BOM），直接按 bytes 解析避免 decode 大字符串。
        json_data = JSONTool.loads(content)

        # 有效性校验
        if not isinstance(json_data, dict):
            return items

        # 获取项目信息
        project_raw = json_data.get("project", {})
        project: dict = project_raw if isinstance(project_raw, dict) else {}

        index_original_raw = project.get("indexOriginal", 0)
        index_translation_raw = project.get("indexTranslation", 1)
        index_original = (
            index_original_raw if isinstance(index_original_raw, int) else 0
        )
        index_translation = (
            index_translation_raw if isinstance(index_translation_raw, int) else 1
        )
        # 防止负索引导致错误取值（Python list[-1] 等）。
        if index_original < 0:
            index_original = 0
        if index_translation < 0:
            index_translation = 1

        # 获取处理实体
        processor: NONE = self.get_processor(project)
        processor.pre_process()

        # 处理数据
        files_raw = project.get("files", {})
        if not isinstance(files_raw, dict):
            return items

        dedup_seen: set[str] = set()
        files: dict[str, dict] = files_raw
        for file_key, entry_raw in files.items():
            if not isinstance(entry_raw, dict):
                continue

            data_list_raw = entry_raw.get("data", [])
            data_list: list = data_list_raw if isinstance(data_list_raw, list) else []

            tags_list_raw = entry_raw.get("tags", [])
            tags_list: list = tags_list_raw if isinstance(tags_list_raw, list) else []

            context_list_raw = entry_raw.get("context", [])
            context_list: list = (
                context_list_raw if isinstance(context_list_raw, list) else []
            )

            parameters_list_raw = entry_raw.get("parameters", [])
            parameters_list: list = (
                parameters_list_raw if isinstance(parameters_list_raw, list) else []
            )

            # 以 data 为权威行表，按 row_index 索引读取同位 tags/context/parameters。
            for row_index in GapTool.iter(range(len(data_list))):
                data_raw = data_list[row_index]
                data_row: list = data_raw if isinstance(data_raw, list) else []

                src_cell = (
                    data_row[index_original] if index_original < len(data_row) else ""
                )
                dst_cell = (
                    data_row[index_translation]
                    if index_translation < len(data_row)
                    else ""
                )
                data_item = [
                    src_cell if isinstance(src_cell, str) else "",
                    dst_cell if isinstance(dst_cell, str) else "",
                ]

                tag_raw = tags_list[row_index] if row_index < len(tags_list) else []
                tag_item: list[str] = (
                    [v for v in tag_raw if isinstance(v, str)]
                    if isinstance(tag_raw, list)
                    else []
                )

                context_raw = (
                    context_list[row_index] if row_index < len(context_list) else []
                )
                context_item: list[str] = (
                    [v for v in context_raw if isinstance(v, str)]
                    if isinstance(context_raw, list)
                    else []
                )

                parameter_raw = (
                    parameters_list[row_index]
                    if row_index < len(parameters_list)
                    else []
                )
                parameter_item_raw = parameter_raw if parameter_raw is not None else []
                parameter_item: list[dict] = (
                    [v for v in parameter_item_raw if isinstance(v, dict)]
                    if isinstance(parameter_item_raw, list)
                    else []
                )

                # 检查并添加数据
                src, dst, tag_final, status, skip_internal_filter = processor.check(
                    file_key, data_item, tag_item, context_item
                )

                # 去重：读入阶段流式标记 DUPLICATED，保持现有开关与语义。
                if (
                    self.config.deduplication_in_trans
                    and status == Base.ProjectStatus.NONE
                ):
                    if src in dedup_seen:
                        status = Base.ProjectStatus.DUPLICATED
                    else:
                        dedup_seen.add(src)

                items.append(
                    Item.from_dict(
                        {
                            "src": src,
                            "dst": dst,
                            "extra_field": {
                                "tag": tag_final,
                                "context": context_item,
                                "parameter": parameter_item,
                                "trans_ref": {
                                    "file_key": file_key,
                                    "row_index": row_index,
                                },
                            },
                            "tag": file_key,
                            "row": len(items),
                            "file_type": Item.FileType.TRANS,
                            "file_path": rel_path,
                            "text_type": processor.TEXT_TYPE,
                            "status": status,
                            "skip_internal_filter": skip_internal_filter,
                        }
                    )
                )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.TRANS]

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, group_items in group.items():
            # 获取输出目录
            output_path = DataManager.get().get_translated_path()

            # 数据处理
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            # 从工程 assets 获取原始文件内容
            decompressed = DataManager.get().get_asset_decompressed(rel_path)
            if decompressed is None:
                continue

            # 反序列化
            json_data = JSONTool.loads(decompressed)
            if not isinstance(json_data, dict):
                continue

            project_raw = json_data.get("project", {})
            if not isinstance(project_raw, dict):
                continue
            project: dict = project_raw

            files_raw = project.get("files", {})
            if not isinstance(files_raw, dict):
                continue
            files: dict[str, dict] = files_raw

            index_original_raw = project.get("indexOriginal", 0)
            index_translation_raw = project.get("indexTranslation", 1)
            index_original = (
                index_original_raw if isinstance(index_original_raw, int) else 0
            )
            index_translation = (
                index_translation_raw if isinstance(index_translation_raw, int) else 1
            )
            if index_original < 0:
                index_original = 0
            if index_translation < 0:
                index_translation = 1

            # 获取处理实体
            processor: NONE = self.get_processor(project)
            processor.post_process()

            # 对每个 Item 做一次性字段快照，减少多次 get_*() 加锁调用。
            item_snapshots: list[dict] = []
            for item in group_items:
                extra_field_raw = item.get_extra_field()
                extra_field: dict = (
                    extra_field_raw if isinstance(extra_field_raw, dict) else {}
                )
                item_snapshots.append(
                    {
                        "row": item.get_row(),
                        "file_key": item.get_tag(),
                        "src": item.get_src(),
                        "dst": item.get_dst(),
                        "status": item.get_status(),
                        "extra_field": extra_field,
                    }
                )

            # 去重回填映射：从 PROCESSED 收集 (src -> dst)
            translation: dict[str, str] = {}
            if self.config.deduplication_in_trans:
                for snap in item_snapshots:
                    if snap["status"] == Base.ProjectStatus.PROCESSED:
                        translation.setdefault(snap["src"], snap["dst"])

            # Patch Writer：优先使用 trans_ref 定位，仅做最小补丁更新。
            patch_targets: list[tuple[dict, str, int]] = []
            can_patch = True
            for snap in item_snapshots:
                extra_field: dict = snap["extra_field"]
                trans_ref_raw = extra_field.get("trans_ref")
                if not isinstance(trans_ref_raw, dict):
                    can_patch = False
                    break

                file_key = trans_ref_raw.get("file_key")
                row_index = trans_ref_raw.get("row_index")
                if not isinstance(file_key, str) or not isinstance(row_index, int):
                    can_patch = False
                    break

                entry_raw = files.get(file_key)
                if not isinstance(entry_raw, dict):
                    can_patch = False
                    break

                data_list_raw = entry_raw.get("data", [])
                if not isinstance(data_list_raw, list) or row_index < 0:
                    can_patch = False
                    break
                if row_index >= len(data_list_raw):
                    can_patch = False
                    break

                patch_targets.append((snap, file_key, row_index))

            if can_patch:
                for snap, file_key, row_index in patch_targets:
                    entry = files[file_key]

                    status = snap["status"]
                    src = snap["src"]

                    # 读取 row 级的 tags/context/parameters，以原始 JSON 为准。
                    tags_list_raw = entry.get("tags")
                    tags_list: list = (
                        tags_list_raw if isinstance(tags_list_raw, list) else []
                    )
                    tag_row_raw = (
                        tags_list[row_index] if row_index < len(tags_list) else []
                    )
                    tag_row: list[str] = (
                        [v for v in tag_row_raw if isinstance(v, str)]
                        if isinstance(tag_row_raw, list)
                        else []
                    )

                    context_list_raw = entry.get("context")
                    context_list: list = (
                        context_list_raw if isinstance(context_list_raw, list) else []
                    )
                    context_row_raw = (
                        context_list[row_index] if row_index < len(context_list) else []
                    )
                    context_row: list[str] = (
                        [v for v in context_row_raw if isinstance(v, str)]
                        if isinstance(context_row_raw, list)
                        else []
                    )

                    parameters_list_raw = entry.get("parameters")
                    parameters_list: list = (
                        parameters_list_raw
                        if isinstance(parameters_list_raw, list)
                        else []
                    )
                    parameter_row = (
                        parameters_list[row_index]
                        if row_index < len(parameters_list)
                        else None
                    )

                    block = processor.filter(
                        src=src,
                        path=file_key,
                        tag=tag_row,
                        context=context_row,
                    )
                    if not block:
                        block = [False]

                    is_all_blocked = all(block)
                    is_all_unblocked = all(not v for v in block)
                    is_mixed_block = (not is_all_blocked) and (not is_all_unblocked)

                    parameter_list_for_schema = (
                        parameter_row if isinstance(parameter_row, list) else []
                    )
                    has_partition = any(
                        isinstance(v, dict)
                        and ("contextStr" in v or "translation" in v)
                        for v in parameter_list_for_schema
                    )
                    has_span = any(
                        isinstance(v, dict)
                        and any(
                            k in v for k in ("start", "end", "enclosure", "lineIndent")
                        )
                        for v in parameter_list_for_schema
                    )
                    is_span_schema = has_span and not has_partition
                    is_mixed_partition = is_mixed_block and not is_span_schema

                    # gold 作为派生提示：混合分区且无 red/blue/gold 时添加；无混合分区时移除派生 gold。
                    if is_mixed_partition and not any(
                        v in ("red", "blue", "gold") for v in tag_row
                    ):
                        new_tags = tag_row + ["gold"]
                    elif (
                        (not is_mixed_partition)
                        and "gold" in tag_row
                        and not any(v in ("red", "blue") for v in tag_row)
                    ):
                        new_tags = [v for v in tag_row if v != "gold"]
                    else:
                        new_tags = tag_row

                    if new_tags != tag_row:
                        tags_field_raw = entry.get("tags")
                        if isinstance(tags_field_raw, list):
                            tags_field = tags_field_raw
                        else:
                            tags_field = []
                            entry["tags"] = tags_field

                        while len(tags_field) <= row_index:
                            tags_field.append([])
                        tags_field[row_index] = new_tags

                    # 当 block 混合且 schema 兼容时生成/更新分区 parameters；不得改动 dst。
                    if is_mixed_partition:
                        parameter_base = (
                            parameter_row if isinstance(parameter_row, list) else []
                        )
                        new_parameter = processor.generate_parameter(
                            src=src,
                            context=context_row,
                            parameter=parameter_base,
                            block=block,
                        )
                        parameters_field_raw = entry.get("parameters")
                        if isinstance(parameters_field_raw, list):
                            parameters_field = parameters_field_raw
                        else:
                            parameters_field = []
                            entry["parameters"] = parameters_field

                        while len(parameters_field) <= row_index:
                            parameters_field.append(None)
                        parameters_field[row_index] = new_parameter

                    # 仅补丁更新译文列，保留 data[row] 其他列。
                    if status == Base.ProjectStatus.PROCESSED:
                        dst_to_write = snap["dst"]
                    elif (
                        status == Base.ProjectStatus.DUPLICATED
                        and self.config.deduplication_in_trans
                    ):
                        if src not in translation:
                            continue
                        dst_to_write = translation[src]
                    else:
                        continue

                    data_list = entry.get("data")
                    if not isinstance(data_list, list) or row_index >= len(data_list):
                        continue

                    row_raw = data_list[row_index]
                    if isinstance(row_raw, list):
                        row = row_raw
                    else:
                        row = []
                        data_list[row_index] = row

                    if len(row) <= index_translation:
                        row.extend([""] * (index_translation + 1 - len(row)))
                    row[index_translation] = dst_to_write

                JSONTool.save_file(abs_path, json_data, indent=0)
                continue

            # Legacy fallback：缺失 trans_ref 时，保留旧写回路径作为兜底。
            # 注意：仅重建 items 覆盖到的 file_key，避免误清空其它 entry。
            sorted_snaps = sorted(item_snapshots, key=lambda x: x["row"])
            tag_group: dict[str, list[dict]] = {}
            for snap in sorted_snaps:
                tag_group.setdefault(snap["file_key"], []).append(snap)

            for file_key, snaps_by_key in tag_group.items():
                entry_raw = files.get(file_key)
                if not isinstance(entry_raw, dict):
                    continue

                tags_out: list[list[str]] = []
                data_out: list[list[str]] = []
                context_out: list[list[str]] = []
                parameters_out: list[list[dict]] = []

                for snap in snaps_by_key:
                    status = snap["status"]
                    src = snap["src"]
                    dst = snap["dst"]
                    if (
                        status == Base.ProjectStatus.DUPLICATED
                        and self.config.deduplication_in_trans
                        and src in translation
                    ):
                        dst = translation[src]

                    row = [
                        "" for _ in range(max(index_original, index_translation) + 1)
                    ]
                    row[index_original] = src
                    row[index_translation] = dst
                    data_out.append(row)

                    extra_field: dict = snap["extra_field"]
                    tags_out.append(extra_field.get("tag", []))
                    context_out.append(extra_field.get("context", []))

                    # 当翻译状态为 已排除、过去已翻译 时，直接使用原始参数
                    if status in (
                        Base.ProjectStatus.EXCLUDED,
                        Base.ProjectStatus.PROCESSED_IN_PAST,
                    ):
                        parameter_raw = extra_field.get("parameter", [])
                        parameters_out.append(
                            [v for v in parameter_raw if isinstance(v, dict)]
                            if isinstance(parameter_raw, list)
                            else []
                        )
                    # 否则，判断与计算分区翻译功能参数
                    else:
                        parameters_out.append(
                            processor.generate_parameter(
                                src=src,
                                context=extra_field.get("context", []),
                                parameter=extra_field.get("parameter", []),
                                block=processor.filter(
                                    src=src,
                                    path=file_key,
                                    tag=extra_field.get("tag", []),
                                    context=extra_field.get("context", []),
                                ),
                            )
                        )

                entry_raw["tags"] = tags_out
                entry_raw["data"] = data_out
                entry_raw["context"] = context_out
                entry_raw["parameters"] = parameters_out

            JSONTool.save_file(abs_path, json_data, indent=0)

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
