import re
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem

class RuleFilter():

    PREFIX = (
        "MapData/".lower(),
        "SE/".lower(),
        "BGS".lower(),
        "0=".lower(),
        "BGM/".lower(),
        "FIcon/".lower(),
    )

    SUFFIX = (
        ".mp3".lower(),
        ".wav".lower(),
        ".ogg".lower(),
        ".png".lower(),
        ".jpg".lower(),
        ".gif".lower(),
        ".psd".lower(),
        ".webp".lower(),
        ".heif".lower(),
        ".heic".lower(),
        ".avi".lower(),
        ".mp4".lower(),
        ".webm".lower(),
        ".txt".lower(),
        ".ttf".lower(),
        ".otf".lower(),
        ".7z".lower(),
        ".gz".lower(),
        ".rar".lower(),
        ".zip".lower(),
        ".json".lower(),
    )

    RE_ALL = (
        r"^EV\d+$",
        r"^<.+:.+>$",
        r"^\{#file_time\}",                     # RenPy 存档时间
        r"^DejaVu Sans$",                       # RenPy 默认字体名称
        r"^Opendyslexic$",                      # RenPy 默认字体名称
    )

    def filter(item: str | CacheItem) -> bool:
        # 格式为字符串时，自动创建 CacheItem 对象
        if isinstance(item, str):
            item = CacheItem({
                "src": item,
            })

        flags = []
        for line in item.get_src().splitlines():
            line = line.strip().lower()

            # 空字符串
            if line == "":
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
            if any(re.findall(v, line, flags = re.IGNORECASE) != [] for v in RuleFilter.RE_ALL):
                flags.append(True)
                continue

            # 都不匹配
            flags.append(False)

        # 返回值 True 表示需要过滤（即需要排除）
        if flags == []:
            return False
        else:
            return all(flags)