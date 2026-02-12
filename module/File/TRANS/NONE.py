from typing import ClassVar

from base.Base import Base
from model.Item import Item


class NONE:
    TEXT_TYPE: str = Item.TextType.NONE

    BLACKLIST_EXT: ClassVar[tuple[str, ...]] = (
        ".mp3",
        ".wav",
        ".ogg",
        "mid",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".psd",
        ".webp",
        ".heif",
        ".heic",
        ".avi",
        ".mp4",
        ".webm",
        ".txt",
        ".7z",
        ".gz",
        ".rar",
        ".zip",
        ".json",
        ".sav",
        ".mps",
        ".ttf",
        ".otf",
        ".woff",
    )

    def __init__(self, project: dict) -> None:
        super().__init__()

        # 初始化
        self.project: dict = project

    # 预处理
    def pre_process(self) -> None:
        pass

    # 后处理
    def post_process(self) -> None:
        pass

    # 检查
    def check(
        self, path: str, data: list[str], tag: list[str], context: list[str]
    ) -> tuple[str, str, list[str], str, bool]:
        src: str = data[0] if len(data) > 0 and isinstance(data[0], str) else ""
        dst: str = data[1] if len(data) > 1 and isinstance(data[1], str) else ""
        updated_tag = tag

        # 如果数据为空，则跳过
        if src == "":
            status: str = Base.ProjectStatus.EXCLUDED
            skip_internal_filter: bool = False
        # 如果包含 水蓝色 标签，则翻译
        elif any(v == "aqua" for v in updated_tag):
            status: str = Base.ProjectStatus.NONE
            skip_internal_filter: bool = True
        # 如果 第一列、第二列 都有文本，则跳过
        elif dst != "" and src != dst:
            status: str = Base.ProjectStatus.PROCESSED_IN_PAST
            skip_internal_filter: bool = False
        else:
            block: list[bool] = self.filter(src, path, updated_tag, context)
            skip_internal_filter: bool = False

            # 统一空 block 的行为：避免 all()/any() 在空列表上产生反直觉结果。
            if not block:
                block = [False]

            is_all_blocked = all(block)
            is_all_unblocked = all(not v for v in block)
            is_mixed = (not is_all_blocked) and (not is_all_unblocked)

            # gold 作为派生提示：仅在混合分区且没有颜色标签时添加。
            if is_mixed and not any(v in ("red", "blue", "gold") for v in updated_tag):
                updated_tag = updated_tag + ["gold"]
            # 无混合分区时移除派生 gold，但保留用户自定义非颜色标签。
            elif (
                (not is_mixed)
                and "gold" in updated_tag
                and not any(v in ("red", "blue") for v in updated_tag)
            ):
                updated_tag = [v for v in updated_tag if v != "gold"]

            # 如果不需要过滤的数据，则翻译，否则排除
            if any(not v for v in block):
                status: str = Base.ProjectStatus.NONE
            else:
                status: str = Base.ProjectStatus.EXCLUDED

        return src, dst, updated_tag, status, skip_internal_filter

    # 过滤
    def filter(
        self, src: str, path: str, tag: list[str], context: list[str]
    ) -> list[bool]:
        if any(v in src for v in NONE.BLACKLIST_EXT):
            return [True] * (len(context) if len(context) > 0 else 1)

        block: list[bool] = []
        for _ in range(len(context) if len(context) > 0 else 1):
            # 包含 red blue 标签，则过滤
            if any(v in ("red", "blue") for v in tag):
                block.append(True)
            # 默认，无需过滤
            else:
                block.append(False)

        return block

    # 生成参数
    def generate_parameter(
        self,
        src: str,
        context: list[str],
        parameter: object,
        block: list[bool],
    ) -> list[dict]:
        # 如果全部需要排除或者全部需要保留，则不需要启用分区翻译功能
        if all(v is True for v in block) or all(v is False for v in block):
            if not isinstance(parameter, list):
                return []
            return [v for v in parameter if isinstance(v, dict)]

        # parameters schema 探测：避免把 span 参数（如 RENPY/KAG 的 start/end 等）污染为分区结构。
        parameter_list: list = parameter if isinstance(parameter, list) else []
        has_partition = any(
            isinstance(v, dict) and ("contextStr" in v or "translation" in v)
            for v in parameter_list
        )
        has_span = any(
            isinstance(v, dict)
            and any(k in v for k in ("start", "end", "enclosure", "lineIndent"))
            for v in parameter_list
        )
        if has_span and not has_partition:
            return [v for v in parameter_list if isinstance(v, dict)]

        # 用浅拷贝避免就地污染 extra_field 引用。
        result: list[dict] = [v if isinstance(v, dict) else {} for v in parameter_list]
        for i, is_blocked in enumerate(block):
            # 索引检查
            if i >= len(result):
                result.append({})

            # 填充数据
            context_str = (
                context[i] if i < len(context) and isinstance(context[i], str) else ""
            )
            result[i]["contextStr"] = context_str
            result[i]["translation"] = src if is_blocked else ""

        return result
