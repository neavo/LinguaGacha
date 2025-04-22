from base.Base import Base
from module.Cache.CacheItem import CacheItem

class NONE():

    TEXT_TYPE: str = CacheItem.TextType.NONE

    BLACKLIST_EXT: tuple[str] = (
        ".mp3", ".wav", ".ogg", "mid",
        ".png", ".jpg", ".jpeg", ".gif", ".psd", ".webp", ".heif", ".heic",
        ".avi", ".mp4", ".webm",
        ".txt", ".7z", ".gz", ".rar", ".zip", ".json",
        ".sav", ".mps", ".ttf", ".otf", ".woff",
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
    def check(self, path: str, data: list[str], tag: list[str], context: list[str]) -> tuple[str, str, list[str], str, bool]:
        src: str = data[0] if len(data) > 0 and isinstance(data[0], str) else ""
        dst: str = data[1] if len(data) > 1 and isinstance(data[1], str) else src

        # 如果数据为空，则跳过
        if src == "":
            status: str = Base.TranslationStatus.EXCLUDED
            skip_internal_filter: bool = False
        # 如果包含 水蓝色 标签，则翻译
        elif any(v == "aqua" for v in tag):
            status: str = Base.TranslationStatus.UNTRANSLATED
            skip_internal_filter: bool = True
        # 如果 第一列、第二列 都有文本，则跳过
        elif dst != "" and src != dst:
            status: str = Base.TranslationStatus.TRANSLATED_IN_PAST
            skip_internal_filter: bool = False
        else:
            block = self.filter(src, path, tag, context)
            skip_internal_filter: bool = False

            # 如果全部数据都不需要过滤，则移除 red blue gold 标签
            if all(v == False for v in block):
                tag: list[str] = [v for v in tag if v not in ("red", "blue", "gold")]
            # 如果任意数据需要过滤，且不包含 red blue gold 标签，则添加 gold 标签
            elif any(v == True for v in block) and not any(v in ("red", "blue", "gold") for v in tag):
                tag: list[str] = tag + ["gold"]

            # 如果不需要过滤的数据，则翻译，否则排除
            if any(v == False for v in block):
                status: str = Base.TranslationStatus.UNTRANSLATED
            else:
                status: str = Base.TranslationStatus.EXCLUDED

        return src, dst, tag, status, skip_internal_filter

    # 过滤
    def filter(self, src: str, path: str, tag: list[str], context: list[str]) -> bool:
        if any(v in src for v in NONE.BLACKLIST_EXT):
            return [True] * len(context)

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
    def generate_parameter(self, src:str, context: list[str], parameter: list[dict[str, str]], block: list[bool]) -> list[dict[str, str]]:
        # 如果全部需要排除或者全部需要保留，则不需要启用分区翻译功能
        if all(v is True for v in block) or all(v is False for v in block):
            pass
        else:
            if parameter is None:
                parameter = []
            for i, v in enumerate(block):
                # 索引检查
                if i >= len(parameter):
                    parameter.append({})

                # 有效性检查
                if not isinstance(parameter[i], dict):
                    parameter[i] = {}

                # 填充数据
                parameter[i]["contextStr"] = context[i]
                parameter[i]["translation"] = src if v == True else ""

        return parameter