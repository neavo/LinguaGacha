import threading
from functools import lru_cache

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.QualityRuleSnapshot import QualityRuleSnapshot
from module.Utils.JSONTool import JSONTool


class PromptBuilder(Base):
    # 类线程锁
    LOCK: threading.Lock = threading.Lock()

    # "原文/Source" 提示词占位文本（用于 source_language=ALL 时）
    SOURCE_PLACEHOLDER_ZH: str = "原文"
    SOURCE_PLACEHOLDER_EN: str = "Source"

    def __init__(
        self, config: Config, quality_snapshot: QualityRuleSnapshot | None = None
    ) -> None:
        super().__init__()

        # 初始化
        self.config: Config = config
        self.quality_snapshot: QualityRuleSnapshot | None = quality_snapshot

    @classmethod
    def reset(cls) -> None:
        cls.get_base.cache_clear()
        cls.get_prefix.cache_clear()
        cls.get_suffix.cache_clear()
        cls.get_suffix_glossary.cache_clear()

    @classmethod
    @lru_cache(maxsize=None)
    def get_base(cls, language: BaseLanguage.Enum) -> str:
        with open(
            f"resource/preset/prompt/{language.lower()}/base.txt",
            "r",
            encoding="utf-8-sig",
        ) as reader:
            return reader.read().strip()

    @classmethod
    @lru_cache(maxsize=None)
    def get_prefix(cls, language: BaseLanguage.Enum) -> str:
        with open(
            f"resource/preset/prompt/{language.lower()}/prefix.txt",
            "r",
            encoding="utf-8-sig",
        ) as reader:
            return reader.read().strip()

    @classmethod
    @lru_cache(maxsize=None)
    def get_suffix(cls, language: BaseLanguage.Enum) -> str:
        with open(
            f"resource/preset/prompt/{language.lower()}/suffix.txt",
            "r",
            encoding="utf-8-sig",
        ) as reader:
            return reader.read().strip()

    @classmethod
    @lru_cache(maxsize=None)
    def get_suffix_glossary(cls, language: BaseLanguage.Enum) -> str:
        with open(
            f"resource/preset/prompt/{language.lower()}/suffix_glossary.txt",
            "r",
            encoding="utf-8-sig",
        ) as reader:
            return reader.read().strip()

    # 获取自定义提示词数据
    def get_custom_prompt_data(self, language: BaseLanguage.Enum) -> str:
        snapshot = self.quality_snapshot
        if snapshot is not None:
            if language == BaseLanguage.Enum.ZH:
                return snapshot.custom_prompt_zh
            return snapshot.custom_prompt_en

        if language == BaseLanguage.Enum.ZH:
            return DataManager.get().get_custom_prompt_zh()
        return DataManager.get().get_custom_prompt_en()

    # 获取自定义提示词启用状态
    def get_custom_prompt_enable(self, language: BaseLanguage.Enum) -> bool:
        snapshot = self.quality_snapshot
        if snapshot is not None:
            if language == BaseLanguage.Enum.ZH:
                return snapshot.custom_prompt_zh_enable
            return snapshot.custom_prompt_en_enable

        if language == BaseLanguage.Enum.ZH:
            return DataManager.get().get_custom_prompt_zh_enable()
        return DataManager.get().get_custom_prompt_en_enable()

    # 获取主提示词
    def build_main(self) -> str:
        languages = BaseLanguage.get_languages()

        # 设计约束：ALL 只用于原文语言（关闭语言过滤），译文语言必须是具体语言。
        if self.config.target_language == BaseLanguage.ALL:
            raise ValueError("target_language does not support ALL")
        if self.config.target_language not in languages:
            raise ValueError(f"invalid target_language: {self.config.target_language}")

        # 判断提示词语言
        if self.config.target_language == BaseLanguage.Enum.ZH:
            prompt_language = BaseLanguage.Enum.ZH
            source_placeholder = __class__.SOURCE_PLACEHOLDER_ZH
            if self.config.source_language == BaseLanguage.ALL:
                source_language = source_placeholder
            elif self.config.source_language in languages:
                source_language = BaseLanguage.get_name_zh(self.config.source_language)
            else:
                source_language = source_placeholder
            target_language = BaseLanguage.get_name_zh(self.config.target_language)
        else:
            prompt_language = BaseLanguage.Enum.EN
            source_placeholder = __class__.SOURCE_PLACEHOLDER_EN
            if self.config.source_language == BaseLanguage.ALL:
                source_language = source_placeholder
            elif self.config.source_language in languages:
                source_language = BaseLanguage.get_name_en(self.config.source_language)
            else:
                source_language = source_placeholder
            target_language = BaseLanguage.get_name_en(self.config.target_language)

        # 兜底：保证替换文本非空。
        if not source_language:
            source_language = source_placeholder
        if not target_language:
            raise ValueError(f"invalid target_language: {self.config.target_language}")

        with __class__.LOCK:
            # 前缀
            prefix = __class__.get_prefix(prompt_language)

            # 基本（从工程读取自定义提示词）
            if (
                prompt_language == BaseLanguage.Enum.ZH
                and self.get_custom_prompt_enable(BaseLanguage.Enum.ZH)
            ):
                base = self.get_custom_prompt_data(BaseLanguage.Enum.ZH)
            elif (
                prompt_language == BaseLanguage.Enum.EN
                and self.get_custom_prompt_enable(BaseLanguage.Enum.EN)
            ):
                base = self.get_custom_prompt_data(BaseLanguage.Enum.EN)
            else:
                base = __class__.get_base(prompt_language)

            # 后缀
            if not self.config.auto_glossary_enable:
                suffix = __class__.get_suffix(prompt_language)
            else:
                suffix = __class__.get_suffix_glossary(prompt_language)

        # 组装提示词
        full_prompt = prefix + "\n" + base + "\n" + suffix
        full_prompt = full_prompt.replace("{source_language}", source_language)
        full_prompt = full_prompt.replace("{target_language}", target_language)

        return full_prompt

    # 构造参考上文
    def build_preceding(self, precedings: list[Item]) -> str:
        if not precedings:
            return ""
        elif self.config.target_language == BaseLanguage.Enum.ZH:
            return (
                "参考上文："
                + "\n"
                + "\n".join(
                    [item.get_src().strip().replace("\n", "\\n") for item in precedings]
                )
            )
        else:
            return (
                "Preceding Context:"
                + "\n"
                + "\n".join(
                    [item.get_src().strip().replace("\n", "\\n") for item in precedings]
                )
            )

    # 构造术语表
    def build_glossary(self, srcs: list[str]) -> str:
        full = "\n".join(srcs)
        full_lower = full.lower()  # 用于不区分大小写的匹配

        # 筛选匹配的术语
        glossary: list[dict[str, str]] = []
        glossary_data = (
            self.quality_snapshot.get_glossary_entries()
            if self.quality_snapshot is not None
            else DataManager.get().get_glossary()
        )

        for v in glossary_data:
            src = v.get("src", "")
            is_case_sensitive = v.get("case_sensitive", False)

            # 根据 case_sensitive 决定匹配方式
            if is_case_sensitive:
                # 大小写敏感：直接使用 in
                if src in full:
                    glossary.append(v)
            else:
                # 大小写不敏感：转换为小写后匹配
                if src.lower() in full_lower:
                    glossary.append(v)

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
        if not result:
            return ""

        if self.config.target_language == BaseLanguage.Enum.ZH:
            return (
                "术语表 <术语原文> -> <术语译文> #<术语信息>:"
                + "\n"
                + "\n".join(result)
            )
        else:
            return (
                "Glossary <Original Term> -> <Translated Term> #<Term Information>:"
                + "\n"
                + "\n".join(result)
            )

    # 构造术语表
    def build_glossary_sakura(self, srcs: list[str]) -> str:
        full = "\n".join(srcs)
        full_lower = full.lower()  # 用于不区分大小写的匹配

        # 筛选匹配的术语
        glossary: list[dict[str, str]] = []
        glossary_data = (
            self.quality_snapshot.get_glossary_entries()
            if self.quality_snapshot is not None
            else DataManager.get().get_glossary()
        )

        for v in glossary_data:
            src = v.get("src", "")
            is_case_sensitive = v.get("case_sensitive", False)

            # 根据 case_sensitive 决定匹配方式
            if is_case_sensitive:
                # 大小写敏感：直接使用 in
                if src in full:
                    glossary.append(v)
            else:
                # 大小写不敏感：转换为小写后匹配
                if src.lower() in full_lower:
                    glossary.append(v)

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
        if not result:
            return ""

        return "\n".join(result)

    # 构建控制字符示例
    def build_control_characters_samples(self, main: str, samples: list[str]) -> str:
        # 去重并过滤空字符串
        unique_samples = {v.strip() for v in samples if v.strip()}

        if not unique_samples:
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

        return prefix + "\n" + f"{', '.join(unique_samples)}"

    # 构建输入
    def build_inputs(self, srcs: list[str]) -> str:
        inputs = "\n".join(
            JSONTool.dumps({str(i): line}) for i, line in enumerate(srcs)
        )

        if self.config.target_language == BaseLanguage.Enum.ZH:
            return "输入：\n" + "```jsonline\n" + f"{inputs}\n" + "```"
        else:
            return "Input:\n" + "```jsonline\n" + f"{inputs}\n" + "```"

    # 生成提示词
    def generate_prompt(
        self,
        srcs: list[str],
        samples: list[str],
        precedings: list[Item],
    ) -> tuple[list[dict], list[str]]:
        # 初始化
        messages: list[dict[str, str]] = []
        console_log: list[str] = []

        # 基础提示词
        content = self.build_main()

        # 参考上文
        result = self.build_preceding(precedings)
        if result != "":
            content = content + "\n" + result
            console_log.append(result)

        # 术语表
        glossary_enable = (
            self.quality_snapshot.glossary_enable
            if self.quality_snapshot is not None
            else DataManager.get().get_glossary_enable()
        )
        if glossary_enable:
            result = self.build_glossary(srcs)
            if result != "":
                content = content + "\n" + result

                console_log.append(result)

        # 控制字符示例
        result = self.build_control_characters_samples(content, samples)
        if result != "":
            content = content + "\n" + result
            console_log.append(result)

        # 输入
        result = self.build_inputs(srcs)
        if result != "":
            content = content + "\n" + result

        # 构建提示词列表
        messages.append(
            {
                "role": "user",
                "content": content,
            }
        )

        return messages, console_log

    # 生成提示词 - Sakura
    def generate_prompt_sakura(self, srcs: list[str]) -> tuple[list[dict], list[str]]:
        # 初始化
        messages: list[dict[str, str]] = []
        console_log: list[str] = []

        # 构建系统提示词
        messages.append(
            {
                "role": "system",
                "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
            }
        )

        # 术语表
        content = "将下面的日文文本翻译成中文：\n" + "\n".join(srcs)
        glossary_enable = (
            self.quality_snapshot.glossary_enable
            if self.quality_snapshot is not None
            else DataManager.get().get_glossary_enable()
        )
        if glossary_enable:
            result = self.build_glossary_sakura(srcs)
            if result != "":
                content = (
                    "根据以下术语表（可以为空）：\n"
                    + result
                    + "\n"
                    + "将下面的日文文本根据对应关系和备注翻译成中文：\n"
                    + "\n".join(srcs)
                )
                console_log.append(result)

        # 构建提示词列表
        messages.append(
            {
                "role": "user",
                "content": content,
            }
        )

        return messages, console_log
