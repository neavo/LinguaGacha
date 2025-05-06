import re
import json

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.Config import Config
from module.Localizer.Localizer import Localizer

class TextPreserver(Base):

    # 占位符文本
    PLACEHOLDER: str = "{PLACEHOLDER}"

    # 正则表达式
    RE_BLANK: re.Pattern = re.compile(r"\s+", re.IGNORECASE)
    RE_CHECK: dict[str | CacheItem.TextType, re.Pattern] = {}
    RE_SAMPLE: dict[str | CacheItem.TextType, re.Pattern] = {}
    RE_PREFIX: dict[str | CacheItem.TextType, re.Pattern] = {}
    RE_SUFFIX: dict[str | CacheItem.TextType, re.Pattern] = {}

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config: Config = config
        self.placeholders: set[str] = set()
        self.prefix_codes: dict[str, list[str]] = {}
        self.suffix_codes: dict[str, list[str]] = {}

    @classmethod
    def reset(cls) -> None:
        cls.RE_CHECK.clear()
        cls.RE_SAMPLE.clear()
        cls.RE_PREFIX.clear()
        cls.RE_SUFFIX.clear()

    def get_data(self, custom_enable: bool, text_type: CacheItem.TextType) -> list[dict[str, str]]:
        result: list[dict[str, str]] = []

        if custom_enable == True:
            result = self.config.text_preserve_data
        else:
            path: str = f"./resource/text_preserve_preset/{Localizer.get_app_language().lower()}/{text_type.lower()}.json"
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    result: list[dict[str, str]] = json.load(reader)
            except:
                result: list[dict[str, str]] = []

        return [v.get("src") for v in result if v.get("src") != ""]

    def get_re_check(self, custom_enable: bool, text_type: CacheItem.TextType) -> re.Pattern:
        key = "CUSTOM" if custom_enable == True else text_type

        if key not in __class__.RE_CHECK:
            data: list[dict[str, str]] = self.get_data(custom_enable, text_type)
            if len(data) == 0:
                __class__.RE_CHECK[key] = None
            else:
                __class__.RE_CHECK[key] = re.compile(rf"(?:{"|".join(self.get_data(custom_enable, text_type))})+", re.IGNORECASE)

        return __class__.RE_CHECK.get(key)

    def get_re_sample(self, custom_enable: bool, text_type: CacheItem.TextType) -> re.Pattern:
        key = "CUSTOM" if custom_enable == True else text_type

        if key not in __class__.RE_SAMPLE:
            data: list[dict[str, str]] = self.get_data(custom_enable, text_type)
            if len(data) == 0:
                __class__.RE_SAMPLE[key] = None
            else:
                __class__.RE_SAMPLE[key] = re.compile(rf"{"|".join(self.get_data(custom_enable, text_type))}", re.IGNORECASE)

        return __class__.RE_SAMPLE.get(key)

    def get_re_prefix(self, custom_enable: bool, text_type: CacheItem.TextType) -> re.Pattern:
        key = "CUSTOM" if custom_enable == True else text_type

        if key not in __class__.RE_PREFIX:
            data: list[dict[str, str]] = self.get_data(custom_enable, text_type)
            if len(data) == 0:
                __class__.RE_PREFIX[key] = None
            else:
                __class__.RE_PREFIX[key] = re.compile(rf"^(?:{"|".join(self.get_data(custom_enable, text_type))})+", re.IGNORECASE)

        return __class__.RE_PREFIX.get(key)

    def get_re_suffix(self, custom_enable: bool, text_type: CacheItem.TextType) -> re.Pattern:
        key = "CUSTOM" if custom_enable == True else text_type

        if key not in __class__.RE_SUFFIX:
            data: list[dict[str, str]] = self.get_data(custom_enable, text_type)
            if len(data) == 0:
                __class__.RE_SUFFIX[key] = None
            else:
                __class__.RE_SUFFIX[key] = re.compile(rf"(?:{"|".join(self.get_data(custom_enable, text_type))})+$", re.IGNORECASE)

        return __class__.RE_SUFFIX.get(key)

    # 按规则提取文本
    def extract(self, rule: re.Pattern, k: str, src_dict: dict[str, str]) -> list[str]:
        codes: list[str] = []

        def repl(match: re.Match) -> str:
            codes.append(match.group(0))
            return ""
        src_dict[k] = rule.sub(repl, src_dict.get(k))

        return codes

    # 预处理
    def pre_process(self, src_dict: dict[str, str], item_dict: dict[str, CacheItem]) -> tuple[dict[str, str], list[str]]:
        samples: set[str] = set()

        for k, item in zip(src_dict.keys(), item_dict.values()):
            # 查找与替换前缀代码段
            rule: re.Pattern = self.get_re_prefix(
                custom_enable = self.config.text_preserve_enable,
                text_type = item.get_text_type(),
            )
            if rule is not None:
                self.prefix_codes[k] = self.extract(rule, k, src_dict)

            # 查找与替换后缀代码段
            rule: re.Pattern = self.get_re_suffix(
                custom_enable = self.config.text_preserve_enable,
                text_type = item.get_text_type(),
            )
            if rule is not None:
                self.suffix_codes[k] = self.extract(rule, k, src_dict)

            # 如果处理后的文本为空，则记录 ID，并将文本替换为占位符
            if src_dict.get(k) == "":
                src_dict[k] = TextPreserver.PLACEHOLDER
                self.placeholders.add(k)

            # 查找控制字符示例
            rule: re.Pattern = self.get_re_sample(
                custom_enable = self.config.text_preserve_enable,
                text_type = item.get_text_type(),
            )
            if rule is not None:
                samples.update([v.group(0) for v in rule.finditer(src_dict.get(k))])

            # 补充
            if item.get_text_type() == CacheItem.TextType.MD:
                samples.add("Markdown Code")

        return src_dict, [v.strip() for v in samples if v.strip() != ""]

    # 后处理
    def post_process(self, src_dict: dict[str, str], dst_dict: dict[str, str]) -> dict[str, str]:
        for k in dst_dict.keys():
            # 检查一下返回值的有效性
            if k not in src_dict:
                continue

            # 如果 ID 在占位符集合中，则将文本置为空
            if k in self.placeholders:
                dst_dict[k] = ""

            # 移除模型可能额外添加的头尾空白符
            dst_dict[k] = dst_dict.get(k).strip()

            # 还原前缀代码段
            if k in self.prefix_codes:
                dst_dict[k] = "".join(self.prefix_codes.get(k)) + dst_dict.get(k)

            # 还原后缀代码段
            if k in self.suffix_codes:
                dst_dict[k] = dst_dict.get(k) + "".join(self.suffix_codes.get(k))

        return dst_dict

    # 检查代码段
    def check(self, src: str, dst: str, text_type: CacheItem.TextType) -> bool:
        x: list[str] = []
        y: list[str] = []
        rule: re.Pattern = self.get_re_check(
            custom_enable = self.config.text_preserve_enable,
            text_type = text_type,
        )
        if rule is not None:
            x = [v.group(0) for v in rule.finditer(src)]
            y = [v.group(0) for v in rule.finditer(dst)]

        x = [TextPreserver.RE_BLANK.sub("", v) for v in x if TextPreserver.RE_BLANK.sub("", v) != ""]
        y = [TextPreserver.RE_BLANK.sub("", v) for v in y if TextPreserver.RE_BLANK.sub("", v) != ""]

        return x == y