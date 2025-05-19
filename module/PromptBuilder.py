import json
from functools import lru_cache

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Cache.CacheItem import CacheItem
from module.Config import Config

class PromptBuilder(Base):

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config: Config = config

    @classmethod
    def reset(cls) -> None:
        cls.get_base.cache_clear()
        cls.get_prefix.cache_clear()
        cls.get_suffix.cache_clear()
        cls.get_suffix_glossary.cache_clear()

    @classmethod
    @lru_cache(maxsize = None)
    def get_base(cls, language: BaseLanguage.Enum) -> str:
        with open(f"resource/prompt/{language.lower()}/base.txt", "r", encoding = "utf-8-sig") as reader:
            return reader.read().strip()

    @classmethod
    @lru_cache(maxsize = None)
    def get_prefix(cls, language: BaseLanguage.Enum) -> str:
        with open(f"resource/prompt/{language.lower()}/prefix.txt", "r", encoding = "utf-8-sig") as reader:
            return reader.read().strip()

    @classmethod
    @lru_cache(maxsize = None)
    def get_suffix(cls, language: BaseLanguage.Enum) -> str:
        with open(f"resource/prompt/{language.lower()}/suffix.txt", "r", encoding = "utf-8-sig") as reader:
            return reader.read().strip()

    @classmethod
    @lru_cache(maxsize = None)
    def get_suffix_glossary(cls, language: BaseLanguage.Enum) -> str:
        with open(f"resource/prompt/{language.lower()}/suffix_glossary.txt", "r", encoding = "utf-8-sig") as reader:
            return reader.read().strip()

    # 获取主提示词
    def build_main(self) -> str:
        # 判断提示词语言
        if self.config.target_language == BaseLanguage.Enum.ZH:
            prompt_language = BaseLanguage.Enum.ZH
            source_language = BaseLanguage.get_name_zh(self.config.source_language)
            target_language = BaseLanguage.get_name_zh(self.config.target_language)
        else:
            prompt_language = BaseLanguage.Enum.EN
            source_language = BaseLanguage.get_name_en(self.config.source_language)
            target_language = BaseLanguage.get_name_en(self.config.target_language)

        # 判断是否是否自定义提示词
        if prompt_language == BaseLanguage.Enum.ZH and self.config.custom_prompt_zh_enable == True:
            base = self.config.custom_prompt_zh_data
        elif prompt_language == BaseLanguage.Enum.EN and self.config.custom_prompt_en_enable == True:
            base = self.config.custom_prompt_en_data
        else:
            base = __class__.get_base(prompt_language)

        # 判断是否启用自动术语表
        if self.config.auto_glossary_enable == False:
            suffix = __class__.get_suffix(prompt_language)
        else:
            suffix = __class__.get_suffix_glossary(prompt_language)

        # 组装提示词
        full_prompt = __class__.get_prefix(prompt_language) + "\n" + base + "\n" + suffix
        full_prompt = full_prompt.replace("{source_language}", source_language)
        full_prompt = full_prompt.replace("{target_language}", target_language)

        return full_prompt

    # 构造参考上文
    def build_preceding(self, precedings: list[CacheItem]) -> str:
        if len(precedings) == 0:
            return ""
        elif self.config.target_language == BaseLanguage.Enum.ZH:
            return (
                "参考上文："
                + "\n" + "\n".join([item.get_src().strip().replace("\n", "\\n") for item in precedings])
            )
        else:
            return (
                "Preceding Context:"
                + "\n" + "\n".join([item.get_src().strip().replace("\n", "\\n") for item in precedings])
            )

    # 构造术语表
    def build_glossary(self, srcs: list[str]) -> str:
        full = "\n".join(srcs)
        glossary: list[dict[str, str]] = [
            v
            for v in self.config.glossary_data if v.get("src") in full
        ]

        # 构建文本
        result = []
        for item in glossary:
            src = item.get("src", "")
            dst = item.get("dst", "")
            info = item.get("info", "")

            if info == "":
                result.append(f"{src} -> {dst}")
            else:
                result.append(f"{src} -> {dst} #{info}")

        # 返回结果
        if result == []:
            return ""
        elif self.config.target_language == BaseLanguage.Enum.ZH:
            return (
                "术语表："
                + "\n" + "\n".join(result)
            )
        else:
            return (
                "Glossary:"
                + "\n" + "\n".join(result)
            )

    # 构造术语表
    def build_glossary_sakura(self, srcs: list[str]) -> str:
        full = "\n".join(srcs)
        glossary: list[dict[str, str]] = [
            v
            for v in self.config.glossary_data if v.get("src") in full
        ]

        # 构建文本
        result = []
        for item in glossary:
            src = item.get("src", "")
            dst = item.get("dst", "")
            info = item.get("info", "")

            if info == "":
                result.append(f"{src}->{dst}")
            else:
                result.append(f"{src}->{dst} #{info}")

        # 返回结果
        if result == []:
            return ""
        else:
            return "\n".join(result)

    # 构建控制字符示例
    def build_control_characters_samples(self, main: str, samples: list[str]) -> str:
        samples = {v.strip() for v in samples if v.strip() != ""}

        if len(samples) == 0:
            return ""

        if (
            "控制字符必须在译文中原样保留" not in main
            and "code must be preserved in the translation as they are" not in main
        ):
            return ""

        # 判断提示词语言
        if self.config.target_language == BaseLanguage.Enum.ZH:
            prefix: str = "控制字符示例："
        else:
            prefix: str = "Control Characters Samples:"

        return prefix + "\n" + f"{", ".join(samples)}"

    # 构建输入
    def build_inputs(self, srcs: list[str]) -> str:
        inputs = "\n".join(
            json.dumps({str(i): line}, indent = None, ensure_ascii = False)
            for i, line in enumerate(srcs)
        )

        if self.config.target_language == BaseLanguage.Enum.ZH:
            return (
                "输入："
                "\n" + "```jsonline"
                "\n" + f"{inputs}"
                "\n" + "```"
            )
        else:
            return (
                "Input:"
                "\n" + "```jsonline"
                "\n" + f"{inputs}"
                "\n" + "```"
            )

    # 生成提示词
    def generate_prompt(self, srcs: list[str], samples: list[str], precedings: list[CacheItem], local_flag: bool) -> tuple[list[dict], list[str]]:
        # 初始化
        messages: list[dict[str, str]] = []
        extra_log: list[str] = []

        # 基础提示词
        content = self.build_main()

        # 参考上文
        if local_flag == False or self.config.enable_preceding_on_local == True:
            result = self.build_preceding(precedings)
            if result != "":
                content = content + "\n" + result
                extra_log.append(result)

        # 术语表
        if self.config.glossary_enable == True:
            result = self.build_glossary(srcs)
            if result != "":
                content = content + "\n" + result
                extra_log.append(result)

        # 控制字符示例
        result = self.build_control_characters_samples(content, samples)
        if result != "":
            content = content + "\n" + result
            extra_log.append(result)

        # 输入
        result = self.build_inputs(srcs)
        if result != "":
            content = content + "\n" + result

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": content,
        })

        return messages, extra_log

    # 生成提示词 - Sakura
    def generate_prompt_sakura(self, srcs: list[str]) -> tuple[list[dict], list[str]]:
        # 初始化
        messages: list[dict[str, str]] = []
        extra_log: list[str] = []

        # 构建系统提示词
        messages.append({
            "role": "system",
            "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。"
        })

        # 术语表
        content = "将下面的日文文本翻译成中文：\n" + "\n".join(srcs)
        if self.config.glossary_enable == True:
            result = self.build_glossary_sakura(srcs)
            if result != "":
                content = (
                    "根据以下术语表（可以为空）：\n" + result
                    + "\n" + "将下面的日文文本根据对应关系和备注翻译成中文：\n" + "\n".join(srcs)
                )
                extra_log.append(result)

        # 构建提示词列表
        messages.append({
            "role": "user",
            "content": content,
        })

        return messages, extra_log
