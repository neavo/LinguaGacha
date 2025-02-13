from module.Cache.CacheItem import CacheItem
from module.TextHelper import TextHelper

class RuleFilter():

    PREFIX = (
        "MapData/",
        "SE/",
        "BGS",
        "0=",
        "BGM/",
        "FIcon/",
        "<input type=",
        "width:",
        "<div ",
        "EV0"
    )

    SUFFIX = (
        ".mp3",
        ".wav",
        ".ogg",
        ".png",
        ".jpg",
        ".gif",
        ".psd",
        ".webp",
        ".heif",
        ".heic",
        ".txt",
        ".7z",
        ".gz",
        ".rar",
        ".zip",
        ".json",
    )

    def filter(item: CacheItem) -> bool:
        src: str = item.get_src()

        # 空字符串
        if src == "":
            return True

        # 格式校验
        # isdecimal
        # 字符串中的字符是否全是十进制数字。也就是说，只有那些在数字系统中被认为是“基本”的数字字符（0-9）才会返回 True。
        # isdigit
        # 字符串中的字符是否都是数字字符。它不仅检查十进制数字，还包括其他可以表示数字的字符，如数字上标、罗马数字、圆圈数字等。
        # isnumeric
        # 字符串中的字符是否表示任何类型的数字，包括整数、分数、数字字符的变种（比如上标、下标）以及其他可以被认为是数字的字符（如中文数字）。

        # 仅包含空白符、数字字符、标点符号
        if all(c.isspace() or c.isnumeric() or TextHelper.is_punctuation(c) for c in src):
            return True

        # 以扩展名结尾
        if any(src.lower().endswith(suffix) for suffix in RuleFilter.SUFFIX):
            return True

        # 以常见代码开头
        if any(src.lower().startswith(suffix) for suffix in RuleFilter.PREFIX):
            return True