import rapidjson as json

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Cache.CacheItem import CacheItem

class PromptBuilder(Base):

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")
        self.glossary_data: list[dict] = config.get("glossary_data")
        self.glossary_enable: bool = config.get("glossary_enable")
        self.auto_glossary_enable: bool = config.get("auto_glossary_enable")

    def get_base(self, language: str) -> str:
        if getattr(self, "base", None) is None:
            with open(f"resource/prompt/{language.lower()}/base.txt", "r", encoding = "utf-8-sig") as reader:
                self.base = reader.read().strip()

        return self.base

    def get_prefix(self, language: str) -> str:
        if getattr(self, "prefix", None) is None:
            with open(f"resource/prompt/{language.lower()}/prefix.txt", "r", encoding = "utf-8-sig") as reader:
                self.prefix = reader.read().strip()

        return self.prefix

    def get_suffix(self, language: str) -> str:
        if getattr(self, "suffix", None) is None:
            with open(f"resource/prompt/{language.lower()}/suffix.txt", "r", encoding = "utf-8-sig") as reader:
                self.suffix = reader.read().strip()

        return self.suffix

    def get_suffix_glossary(self, language: str) -> str:
        if getattr(self, "suffix_glossary", None) is None:
            with open(f"resource/prompt/{language.lower()}/suffix_glossary.txt", "r", encoding = "utf-8-sig") as reader:
                self.suffix_glossary = reader.read().strip()

        return self.suffix_glossary

    # 获取主提示词
    def build_main(self) -> str:
        # 判断提示词语言
        if self.target_language == BaseLanguage.ZH:
            prompt_language = BaseLanguage.ZH
            source_language = BaseLanguage.get_name_zh(self.source_language)
            target_language = BaseLanguage.get_name_zh(self.target_language)
        else:
            prompt_language = BaseLanguage.EN
            source_language = BaseLanguage.get_name_en(self.source_language)
            target_language = BaseLanguage.get_name_en(self.target_language)

        self.get_base(prompt_language)
        self.get_prefix(prompt_language)
        self.get_suffix(prompt_language)
        self.get_suffix_glossary(prompt_language)

        # 判断是否是否自定义提示词
        if prompt_language == BaseLanguage.ZH and self.config.get("custom_prompt_zh_enable") == True:
            base = self.config.get("custom_prompt_zh_data")
        elif prompt_language == BaseLanguage.EN and self.config.get("custom_prompt_en_enable") == True:
            base = self.config.get("custom_prompt_en_data")
        else:
            base = self.base

        # 判断是否启用自动术语表
        if self.auto_glossary_enable == False:
            suffix = self.suffix
        else:
            suffix = self.suffix_glossary

        # 组装提示词
        full_prompt = self.prefix + "\n" + base + "\n" + suffix
        full_prompt = full_prompt.replace("{source_language}", source_language)
        full_prompt = full_prompt.replace("{target_language}", target_language)

        return full_prompt

    # 构造参考上文
    def build_preceding(self, preceding_items: list[CacheItem]) -> str:
        if preceding_items == []:
            return ""
        elif self.target_language == BaseLanguage.ZH:
            return (
                "参考上文（仅用于参考，无需翻译）："
                + "\n" + "\n".join([item.get_src().strip().replace("\n", "\\n") for item in preceding_items])
            )
        else:
            return (
                "Preceding Text (for reference only, no translation needed):"
                + "\n" + "\n".join([item.get_src().strip().replace("\n", "\\n") for item in preceding_items])
            )

    # 构造术语表
    def build_glossary(self, src_dict: dict) -> str:
        # 将输入字典中的所有值转换为集合
        lines = set(line for line in src_dict.values())

        # 筛选在输入词典中出现过的条目
        result = [
            v for v in self.glossary_data
            if any(v.get("src") in lines for lines in lines)
        ]

        # 构建文本
        dict_lines = []
        for item in result:
            src = item.get("src", "")
            dst = item.get("dst", "")
            info = item.get("info", "")

            if info == "":
                dict_lines.append(f"{src} -> {dst}")
            else:
                dict_lines.append(f"{src} -> {dst} #{info}")

        # 返回结果
        if dict_lines == []:
            return ""
        elif self.target_language == BaseLanguage.ZH:
            return (
                "术语表："
                + "\n" + "\n".join(dict_lines)
            )
        else:
            return (
                "Glossary:"
                + "\n" + "\n".join(dict_lines)
            )

    # 构造术语表
    def build_glossary_sakura(self, src_dict: dict) -> str:
        # 将输入字典中的所有值转换为集合
        lines = set(line for line in src_dict.values())

        # 筛选在输入词典中出现过的条目
        result = [
            v for v in self.glossary_data
            if any(v.get("src") in lines for lines in lines)
        ]

        # 构建文本
        dict_lines = []
        for item in result:
            src = item.get("src", "")
            dst = item.get("dst", "")
            info = item.get("info", "")

            if info == "":
                dict_lines.append(f"{src}->{dst}")
            else:
                dict_lines.append(f"{src}->{dst} #{info}")

        # 返回结果
        if dict_lines == []:
            return ""
        else:
            return "\n".join(dict_lines)

    # 构建控制字符示例
    def build_control_characters_samples(self, main: str, samples: list[str]) -> str:
        if len(samples) == 0:
            return ""

        if (
            "控制字符必须在译文中原样保留" not in main
            and "code must be preserved in the translation as they are" not in main
        ):
            return ""

        # 判断提示词语言
        if self.target_language == BaseLanguage.ZH:
            prefix: str = "控制字符示例："
        else:
            prefix: str = "Control Characters Samples:"

        return prefix + "\n" + f"{", ".join(samples)}"

    # 构建输入
    def build_inputs(self, src_dict: dict) -> str:
        inputs: str = "\n".join(
            json.dumps({k: v}, indent = None, ensure_ascii = False) for k, v in src_dict.items()
        )

        if self.target_language == BaseLanguage.ZH:
            return (
                "输入："
                "\n" + "```jsonline"
                f"{inputs}"
                "\n" + "```"
            )
        else:
            return (
                "Input:"
                "\n" + "```jsonline"
                f"{inputs}"
                "\n" + "```"
            )

    # 生成提示词
    def generate_prompt(self, src_dict: dict, preceding_items: list[CacheItem], samples: list[str]) -> tuple[list[dict], list[str]]:
        # 初始化
        messages: list[dict[str, str]] = []
        extra_log: list[str] = []

        # 基础提示词
        content = self.build_main()

        # 参考上文
        if len(preceding_items) > 0:
            result = self.build_preceding(preceding_items)
            if result != "":
                content = content + "\n" + result
                extra_log.append(result)

        # 术语表
        if self.glossary_enable == True:
            result = self.build_glossary(src_dict)
            if result != "":
                content = content + "\n" + result
                extra_log.append(result)

        # 控制字符示例
        result = self.build_control_characters_samples(content, samples)
        if result != "":
            content = content + "\n" + result
            extra_log.append(result)

        # 输入
        result = self.build_inputs(src_dict)
        if result != "":
            content = content + "\n" + result
            # extra_log.append(result)

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": content,
        })

        return messages, extra_log

    # 生成提示词 - Sakura
    def generate_prompt_sakura(self, src_dict: dict) -> tuple[list[dict], list[str]]:
        # 初始化
        messages: list[dict[str, str]] = []
        extra_log: list[str] = []

        # 构建系统提示词
        messages.append({
            "role": "system",
            "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。"
        })

        # 术语表
        content = "将下面的日文文本翻译成中文：\n" + "\n".join(src_dict.values())
        if self.glossary_enable == True:
            result = self.build_glossary_sakura(src_dict)
            if result != "":
                content = (
                    "根据以下术语表（可以为空）：\n" + result
                    + "\n" + "将下面的日文文本根据对应关系和备注翻译成中文：\n" + "\n".join(src_dict.values())
                )
                extra_log.append(result)

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": content,
        })

        return messages, extra_log
