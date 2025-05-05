import re
from module.Cache.CacheItem import CacheItem
from module.Text.TextHelper import TextHelper

class RuleFilter():

    PREFIX: tuple[str] = (
        "MapData/".lower(),
        "SE/".lower(),
        "BGS".lower(),
        "0=".lower(),
        "BGM/".lower(),
        "FIcon/".lower(),
    )

    SUFFIX: tuple[str] = (
        ".mp3", ".wav", ".ogg", "mid",
        ".png", ".jpg", ".jpeg", ".gif", ".psd", ".webp", ".heif", ".heic",
        ".avi", ".mp4", ".webm",
        ".txt", ".7z", ".gz", ".rar", ".zip", ".json",
        ".sav", ".mps", ".ttf", ".otf", ".woff",
    )

    RE_ALL: tuple[re.Pattern] = (
        re.compile(r"^EV\d+$", flags = re.IGNORECASE),
        re.compile(r"^DejaVu Sans$", flags = re.IGNORECASE),                        # RenPy 默认字体名称
        re.compile(r"^Opendyslexic$", flags = re.IGNORECASE),                       # RenPy 默认字体名称
        re.compile(r"^\{#file_time\}", flags = re.IGNORECASE),                      # RenPy 存档时间
    )

    def filter(src: str, skip_internal_filter: bool) -> bool:
        # 如果跳过内部过滤为 True，则直接返回 False，即不需要过滤
        if skip_internal_filter == True:
            return False

        flags = []
        for line in src.splitlines():
            line = line.strip().lower()

            # 空字符串
            if line.strip() == "":
                flags.append(True)
                continue

            # 格式校验
            # isdecimal
            # 字符串中的字符是否全是十进制数字。也就是说，只有那些在数字系统中被认为是“基本”的数字字符（0-9）才会返回 True。
            # isdigit
            # 字符串中的字符是否都是数字字符。它不仅检查十进制数字，还包括其他可以表示数字的字符，如数字上标、罗马数字、圆圈数字等。
            # isnumeric
            # 字符串中的字符是否表示任何类型的数字，包括整数、分数、数字字符的变种（比如上标、下标）以及其他可以被认为是数字的字符（如中文数字）。
            # 仅包含空白符、数字字符、标点符号
            if all(c.isspace() or c.isnumeric() or TextHelper.is_punctuation(c) for c in line):
                flags.append(True)
                continue

            # 以目标前缀开头
            if any(line.startswith(v) for v in RuleFilter.PREFIX):
                flags.append(True)
                continue

            # 以目标后缀结尾
            if any(line.endswith(v) for v in RuleFilter.SUFFIX):
                flags.append(True)
                continue

            # 符合目标规则
            if any(v.search(line) is not None for v in RuleFilter.RE_ALL):
                flags.append(True)
                continue

            # 都不匹配
            flags.append(False)

        # 返回值 True 表示需要过滤（即需要排除）
        if flags == []:
            return False
        else:
            return all(flags)