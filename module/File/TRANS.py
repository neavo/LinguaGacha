import os
import re
import shutil
import itertools

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem

# NONE
class NONE():

    TEXT_TYPE: str = CacheItem.TextType.NONE

    BLACKLIST_EXT: tuple[str] = (
        ".mp3", ".wav", ".ogg", "mid",
        ".png", ".jpg", ".jpeg", ".gif", ".psd", ".webp", ".heif", ".heic",
        ".avi", ".mp4", ".webm",
        ".txt", ".ttf", ".otf", ".7z", ".gz", ".rar", ".zip", ".json",
        ".sav", ".mps",
    )

    def __init__(self, project: dict) -> None:
        super().__init__()

        # 初始化
        self.project: dict = project

    # 预处理
    def pre_process(self) -> None:
        pass

    # 后处理
    def post_process(self, items: list[CacheItem]) -> None:
        pass

    # 检查
    def check(self, path: str, data: list[str], tag: list[str], context: list[str]) -> tuple[str, str, list[str], str]:
        # 如果数据为空，则跳过
        if len(data) == 0 or not isinstance(data[0], str):
            src: str = ""
            dst: str = ""
            status: str = Base.TranslationStatus.EXCLUDED
        # 如果包含 水蓝色 标签，则翻译
        elif any(v == "aqua" for v in tag):
            src: str = data[0]
            dst: str = data[0]
            status: str = Base.TranslationStatus.UNTRANSLATED
        # 如果 第一列、第二列 都有文本，则跳过
        elif len(data) >= 2 and isinstance(data[1], str) and data[1].strip() != "":
            src: str = data[0]
            dst: str = data[1]
            status: str = Base.TranslationStatus.TRANSLATED_IN_PAST
        else:
            src: str = data[0]
            dst: str = data[0]
            status: str = Base.TranslationStatus.UNTRANSLATED

        return src, dst, tag, status

    # 过滤
    def filter(self, src: str, path: str, tag: list[str], context: list[str]) -> bool:
        return [False] * len(context)

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

# WOLF
class WOLF(NONE):

    TEXT_TYPE: str = CacheItem.TextType.WOLF

    WHITELIST_ADDRESS: tuple[re.Pattern] = (
        re.compile(r"Database/0$", flags = re.IGNORECASE),
        # re.compile(r"Message/0(\d+)*$", flags = re.IGNORECASE),
        # re.compile(r"Choices/0(\d+)*$", flags = re.IGNORECASE),
        # re.compile(r"SetString/0(\d+)*$", flags = re.IGNORECASE),
        re.compile(r"CommonEventByName/\d+/(\d+)((/\d+)?)*$", flags = re.IGNORECASE),
    )

    BLACKLIST_ADDRESS: tuple[re.Pattern] = (
        re.compile(r"^Game.dat", flags = re.IGNORECASE),
        re.compile(r"DataBase[\\/]", flags = re.IGNORECASE),
        re.compile(r"optionArgs[\\/]", flags = re.IGNORECASE),
        # re.compile(r"CommonEvent[\\/]", flags = re.IGNORECASE),
        re.compile(r"DebugMessage[\\/]", flags = re.IGNORECASE),
        re.compile(r"StringCondition[\\/]", flags = re.IGNORECASE),
    )

    # 预处理
    def pre_process(self) -> None:
        # 生成屏蔽文本集合
        self.block_text = self.generate_block_text(self.project)

    # 后处理
    def post_process(self, items: list[CacheItem]) -> None:
        # 生成屏蔽文本集合
        self.block_text = self.generate_block_text(self.project)

        # 对 db 数据进行去重
        self.deduplicate_db_text(items)

    # 检查
    def check(self, path: str, data: list[str], tag: list[str], context: list[str]) -> tuple[str, str, list[str], str]:
        # 如果数据为空，则跳过
        if len(data) == 0 or not isinstance(data[0], str):
            src: str = ""
            dst: str = ""
            status: str = Base.TranslationStatus.EXCLUDED
        # 如果包含 水蓝色 标签，则翻译
        elif any(v == "aqua" for v in tag):
            src: str = data[0]
            dst: str = data[0]
            status: str = Base.TranslationStatus.UNTRANSLATED
        # 如果 第一列、第二列 都有文本，则跳过
        elif len(data) >= 2 and isinstance(data[1], str) and data[1].strip() != "":
            src: str = data[0]
            dst: str = data[1]
            status: str = Base.TranslationStatus.TRANSLATED_IN_PAST
        else:
            src: str = data[0]
            dst: str = data[0]
            block = self.filter(src, path, tag, context)
            if any(v == True for v in block) and not any(v in ("red", "blue", "gold") for v in tag):
                tag: list[str] = tag + ["gold"]
            if any(v == False for v in block):
                status: str = Base.TranslationStatus.UNTRANSLATED
            else:
                status: str = Base.TranslationStatus.EXCLUDED

        return src, dst, tag, status

    # 过滤
    def filter(self, src: str, path: str, tag: list[str], context: list[str]) -> bool:
        if any(v in src for v in WOLF.BLACKLIST_EXT):
            return [True] * len(context)

        block: list[bool] = []
        for address in context:
            # 如果在地址白名单，则无需过滤
            if any(rule.search(address) is not None for rule in WOLF.WHITELIST_ADDRESS):
                block.append(False)
            # 如果在标签黑名单，则需要过滤
            elif any(v in ("red", "blue") for v in tag):
                block.append(True)
            # 如果在地址黑名单，则需要过滤
            elif any(rule.search(address) is not None for rule in WOLF.BLACKLIST_ADDRESS):
                block.append(True)
            # 如果是指定地址，并且文本在屏蔽文本集合，则需要过滤
            elif re.search(r"db/\d+?/fldSet/\d+?/idx/\d+?/val", address, flags = re.IGNORECASE) is not None and src in self.block_text:
                block.append(True)
            # 默认，无需过滤
            else:
                block.append(False)

        return block

    # 生成屏蔽文本集合
    def generate_block_text(self, project: dict) -> set[str]:
        result: set[str] = set()

        # 处理数据
        path: str = ""
        entry: dict = {}
        files: dict = project.get("files", {})
        for path, entry in files.items():
            for data, context in itertools.zip_longest(
                entry.get("data", []),
                entry.get("context", []),
                fillvalue = None
            ):
                # 处理可能为 None 的情况
                data: list[str] = data if data is not None else []
                context: list[str] = context if context is not None else []

                # 如果数据为空，则跳过
                if len(data) == 0 or not isinstance(data[0], str):
                    continue

                # 判断是否需要屏蔽
                context: str = "\n".join(context)
                if re.search(r"DataBase[\\/]", context, flags = re.IGNORECASE) is not None:
                    result.add(data[0])

        return result

    # 对 db 数据进行去重
    def deduplicate_db_text(self, items: list[CacheItem]) -> list[CacheItem]:
        cache: dict[str, str] = {}
        for item in items:
            # 如果不是 db 数据，则跳过
            if "db/" not in item.get_tag():
                continue

            # 如果不是 已翻译 状态，则跳过
            if item.get_status() != Base.TranslationStatus.TRANSLATED:
                continue

            src: str = item.get_src().strip().strip("\u3000")
            dst: str = item.get_dst().strip().strip("\u3000")
            if src not in cache:
                cache[src] = dst
            else:
                item.set_dst(cache.get(src))

# RENPY
class RENPY(NONE):

    TEXT_TYPE: str = CacheItem.TextType.RENPY

# RPGMaker
class RPGMaker(NONE):

    TEXT_TYPE: str = CacheItem.TextType.RPGMAKER

    BLACKLIST_PATH: tuple[re.Pattern] = (
        re.compile(r"\.js$", flags = re.IGNORECASE),
    )

    BLACKLIST_ADDRESS: tuple[re.Pattern] = (
        re.compile(r"^(?=.*MZ Plugin Command)(?!.*text).*", flags = re.IGNORECASE),
        re.compile(r"filename", flags = re.IGNORECASE),
        re.compile(r"Tilesets/\d+/name", flags = re.IGNORECASE),
        re.compile(r"MapInfos/\d+/name", flags = re.IGNORECASE),
        re.compile(r"Animations/\d+/name", flags = re.IGNORECASE),
        re.compile(r"CommonEvents/\d+/name", flags = re.IGNORECASE),
        re.compile(r"Map\d+/events/\d+/name", flags = re.IGNORECASE),
    )

    # 检查
    def check(self, path: str, data: list[str], tag: list[str], context: list[str]) -> tuple[str, str, list[str], str]:
        # 如果数据为空，则跳过
        if len(data) == 0 or not isinstance(data[0], str):
            src: str = ""
            dst: str = ""
            status: str = Base.TranslationStatus.EXCLUDED
        # 如果包含 水蓝色 标签，则翻译
        elif any(v == "aqua" for v in tag):
            src: str = data[0]
            dst: str = data[0]
            status: str = Base.TranslationStatus.UNTRANSLATED
        # 如果 第一列、第二列 都有文本，则跳过
        elif len(data) >= 2 and isinstance(data[1], str) and data[1].strip() != "":
            src: str = data[0]
            dst: str = data[1]
            status: str = Base.TranslationStatus.TRANSLATED_IN_PAST
        else:
            src: str = data[0]
            dst: str = data[0]
            block = self.filter(src, path, tag, context)
            if any(v == True for v in block) and not any(v in ("red", "blue", "gold") for v in tag):
                tag: list[str] = tag + ["gold"]
            if any(v == False for v in block):
                status: str = Base.TranslationStatus.UNTRANSLATED
            else:
                status: str = Base.TranslationStatus.EXCLUDED

        return src, dst, tag, status

    # 过滤
    def filter(self, src: str, path: str, tag: list[str], context: list[str]) -> bool:
        if any(v in src for v in RPGMaker.BLACKLIST_EXT):
            return [True] * len(context)

        if any(v.search(path) is not None for v in RPGMaker.BLACKLIST_PATH):
            return [True] * len(context)

        block: list[bool] = []
        for address in context:
            # 如果在标签黑名单，则需要过滤
            if any(v in ("red", "blue") for v in tag):
                block.append(True)
            # 如果在地址黑名单，则需要过滤
            elif any(rule.search(address) is not None for rule in RPGMaker.BLACKLIST_ADDRESS):
                block.append(True)
            # 默认，无需过滤
            else:
                block.append(False)

        return block

# TRANS
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
                engine: str = project.get("gameEngine", "")

                # 获取处理实体
                if engine.lower() == "wolf":
                    processor: NONE = WOLF(project)
                elif engine.lower() == "renpy":
                    processor: NONE = RENPY(project)
                elif engine.lower() in ("2k", "rmjdb", "rmvx", "rmvxace", "rmmv", "rmmz"):
                    processor: NONE = RPGMaker(project)
                else:
                    processor: NONE = NONE(project)

                # 执行预处理
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
                        src, dst, tag, status = processor.check(path, data, tag, context)
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
                    engine: str = project.get("gameEngine", "")

                    # 获取处理实体
                    if engine.lower() == "wolf":
                        processor: NONE = WOLF(project)
                    elif engine.lower() == "renpy":
                        processor: NONE = RENPY(project)
                    elif engine.lower() in ("2k", "rmjdb", "rmvx", "rmvxace", "rmmv", "rmmz"):
                        processor: NONE = RPGMaker(project)
                    else:
                        processor: NONE = NONE(project)

                    # 执行预处理
                    processor.post_process(items)

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