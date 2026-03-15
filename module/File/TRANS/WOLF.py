import re
import itertools
from typing import Pattern

from module.File.TRANS.NONE import NONE
from model.Item import Item


class WOLF(NONE):
    TEXT_TYPE: str = Item.TextType.WOLF

    WHITELIST_ADDRESS: tuple[Pattern[str], ...] = (
        re.compile(r"/Database/stringArgs/0$", flags=re.IGNORECASE),
        re.compile(r"/CommonEvent/stringArgs/\d*[1-9]\d*$", flags=re.IGNORECASE),
        re.compile(r"/CommonEventByName/stringArgs/\d*[1-9]\d*$", flags=re.IGNORECASE),
        re.compile(r"/Message/stringArgs/\d+$", flags=re.IGNORECASE),
        re.compile(r"/Picture/stringArgs/\d+$", flags=re.IGNORECASE),
        re.compile(r"/Choices/stringArgs/\d+$", flags=re.IGNORECASE),
        re.compile(r"/SetString/stringArgs/\d+$", flags=re.IGNORECASE),
        re.compile(r"/StringCondition/stringArgs/\d+$", flags=re.IGNORECASE),
    )

    BLACKLIST_ADDRESS: tuple[Pattern[str], ...] = (
        re.compile(r"/Database/stringArgs/\d*[1-9]\d*$", flags=re.IGNORECASE),
        re.compile(r"/CommonEvent/stringArgs/0$", flags=re.IGNORECASE),
        re.compile(r"/CommonEventByName/stringArgs/0$", flags=re.IGNORECASE),
        re.compile(r"/name$", flags=re.IGNORECASE),
        re.compile(r"/description$", flags=re.IGNORECASE),
        re.compile(r"/Comment/stringArgs/", flags=re.IGNORECASE),
        re.compile(r"/DebugMessage/stringArgs/", flags=re.IGNORECASE),
    )

    # 预处理
    def pre_process(self) -> None:
        self.block_text: set[str] = self.generate_block_text(self.project)

    # 后处理
    def post_process(self) -> None:
        self.block_text: set[str] = self.generate_block_text(self.project)

    # 过滤
    def filter(
        self, src: str, path: str, tag: list[str], context: list[str]
    ) -> list[bool]:
        if any(v in src for v in WOLF.BLACKLIST_EXT):
            return [True] * (len(context) if len(context) > 0 else 1)

        if not context:
            return [any(v in ("red", "blue") for v in tag)]

        block: list[bool] = []
        for address in context:
            # 如果在地址白名单，则无需过滤
            if any(rule.search(address) is not None for rule in WOLF.WHITELIST_ADDRESS):
                block.append(False)
            # 如果在地址黑名单，则需要过滤
            elif any(
                rule.search(address) is not None for rule in WOLF.BLACKLIST_ADDRESS
            ):
                block.append(True)
            # 如果在标签黑名单，则需要过滤
            elif any(v in ("red", "blue") for v in tag):
                block.append(True)
            # 如果符合指定地址规则，并且没有命中以上规则，则需要过滤
            elif re.search(r"^common/", address, flags=re.IGNORECASE) is not None:
                block.append(True)
            # 如果符合指定地址规则，并且文本在屏蔽数据中，则需要过滤
            elif (
                re.search(
                    r"DataBase.json/types/\d+/data/\d+/data/\d+/value",
                    address,
                    flags=re.IGNORECASE,
                )
                is not None
                and src in self.block_text
            ):
                block.append(True)
            # 默认，无需过滤
            else:
                block.append(False)

        return block

    # 生成屏蔽文本集合
    def generate_block_text(self, project: dict) -> set[str]:
        result: set[str] = set()

        # 处理数据
        entry: dict = {}
        files_raw = project.get("files", {})
        if not isinstance(files_raw, dict):
            return result

        files: dict[str, dict] = files_raw
        for _, entry in files.items():
            data_list_raw = entry.get("data", [])
            context_list_raw = entry.get("context", [])
            data_list: list = data_list_raw if isinstance(data_list_raw, list) else []
            context_list: list = (
                context_list_raw if isinstance(context_list_raw, list) else []
            )
            for data_raw, context_raw in itertools.zip_longest(
                data_list,
                context_list,
                fillvalue=None,
            ):
                # 处理可能为 None 的情况
                data_items: list[str] = (
                    [v for v in data_raw if isinstance(v, str)]
                    if isinstance(data_raw, list)
                    else []
                )
                context_items: list[str] = (
                    [v for v in context_raw if isinstance(v, str)]
                    if isinstance(context_raw, list)
                    else []
                )

                # 如果数据为空，则跳过
                if len(data_items) == 0 or not isinstance(data_items[0], str):
                    continue

                # 判断是否需要屏蔽
                # 不需要屏蔽 - common/110.json/commands/29/Database/stringArgs/0
                # 需要屏蔽   - common/110.json/commands/29/Database/stringArgs/1
                context_text: str = "\n".join(context_items)
                if (
                    re.search(
                        r"/Database/stringArgs/\d*[1-9]\d*$",
                        context_text,
                        flags=re.IGNORECASE,
                    )
                    is not None
                ):
                    result.add(data_items[0])

        return result
