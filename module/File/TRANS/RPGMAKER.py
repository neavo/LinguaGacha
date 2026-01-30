import re

from module.File.TRANS.NONE import NONE
from model.Item import Item


class RPGMAKER(NONE):
    TEXT_TYPE: str = Item.TextType.RPGMAKER

    BLACKLIST_PATH: tuple[re.Pattern] = (re.compile(r"\.js$", flags=re.IGNORECASE),)

    BLACKLIST_ADDRESS: tuple[re.Pattern] = (
        re.compile(r"^(?=.*MZ Plugin Command)(?!.*text).*", flags=re.IGNORECASE),
        re.compile(r"filename", flags=re.IGNORECASE),
        re.compile(r"/events/\d+/name", flags=re.IGNORECASE),
        re.compile(r"Tilesets/\d+/name", flags=re.IGNORECASE),
        re.compile(r"MapInfos/\d+/name", flags=re.IGNORECASE),
        re.compile(r"Animations/\d+/name", flags=re.IGNORECASE),
        re.compile(r"CommonEvents/\d+/name", flags=re.IGNORECASE),
    )

    # 过滤
    def filter(self, src: str, path: str, tag: list[str], context: list[str]) -> bool:
        if any(v in src for v in RPGMAKER.BLACKLIST_EXT):
            return [True] * len(context)

        # 路径缓存
        if getattr(self, "cached_path", None) != path:
            self.cached_path = path
            self.cached_path_blocked = any(
                v.search(path) is not None for v in RPGMAKER.BLACKLIST_PATH
            )

        if self.cached_path_blocked:
            return [True] * len(context)

        block: list[bool] = []
        for address in context:
            # 如果在标签黑名单，则需要过滤
            if any(v in ("red", "blue") for v in tag):
                block.append(True)
            # 如果在地址黑名单，则需要过滤
            elif any(
                rule.search(address) is not None for rule in RPGMAKER.BLACKLIST_ADDRESS
            ):
                block.append(True)
            # 默认，无需过滤
            else:
                block.append(False)

        return block
