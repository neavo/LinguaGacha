import threading
from functools import lru_cache
from typing import Any

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.PromptPathResolver import PromptPathResolver
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
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
        cls.get_suffix_thinking.cache_clear()
        cls.get_analysis_base.cache_clear()
        cls.get_analysis_prefix.cache_clear()
        cls.get_analysis_thinking.cache_clear()
        cls.get_analysis_suffix.cache_clear()

    @classmethod
    def read_prompt_text(
        cls,
        task_type: PromptPathResolver.TaskType,
        language: BaseLanguage.Enum,
        file_name: str,
    ) -> str:
        return PromptPathResolver.read_template(task_type, file_name, language)

    @classmethod
    @lru_cache(maxsize=None)
    def get_base(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.TRANSLATION, language, "base.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_prefix(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.TRANSLATION, language, "prefix.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_suffix(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.TRANSLATION, language, "suffix.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_suffix_thinking(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.TRANSLATION, language, "thinking.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_analysis_base(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.ANALYSIS, language, "base.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_analysis_prefix(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.ANALYSIS, language, "prefix.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_analysis_thinking(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.ANALYSIS, language, "thinking.txt"
        )

    @classmethod
    @lru_cache(maxsize=None)
    def get_analysis_suffix(cls, language: BaseLanguage.Enum) -> str:
        return cls.read_prompt_text(
            PromptPathResolver.TaskType.ANALYSIS, language, "suffix.txt"
        )

    def get_prompt_ui_language(self) -> BaseLanguage.Enum:
        """提示词模板和说明文字始终跟随当前 UI 语言。"""
        return Localizer.get_app_language()

    def is_prompt_ui_zh(self) -> bool:
        return self.get_prompt_ui_language() == BaseLanguage.Enum.ZH

    def resolve_prompt_context(
        self,
    ) -> tuple[BaseLanguage.Enum, str, str, str]:
        """统一推导提示词 UI 语言与占位文本，避免运行时继续绑死 target_language。"""
        languages = BaseLanguage.get_languages()
        prompt_language = self.get_prompt_ui_language()

        if self.config.target_language == BaseLanguage.ALL:
            raise ValueError("target_language does not support ALL")
        if self.config.target_language not in languages:
            raise ValueError(f"invalid target_language: {self.config.target_language}")

        if prompt_language == BaseLanguage.Enum.ZH:
            source_placeholder = __class__.SOURCE_PLACEHOLDER_ZH
            if self.config.source_language in languages:
                source_language = BaseLanguage.get_name_zh(self.config.source_language)
            else:
                source_language = source_placeholder
            target_language = BaseLanguage.get_name_zh(self.config.target_language)
        else:
            source_placeholder = __class__.SOURCE_PLACEHOLDER_EN
            if self.config.source_language in languages:
                source_language = BaseLanguage.get_name_en(self.config.source_language)
            else:
                source_language = source_placeholder
            target_language = BaseLanguage.get_name_en(self.config.target_language)

        if not source_language:
            source_language = source_placeholder
        if not target_language:
            raise ValueError(f"invalid target_language: {self.config.target_language}")

        return prompt_language, source_placeholder, source_language, target_language

    # 获取自定义提示词数据
    def get_custom_prompt_data(self, task_type: PromptPathResolver.TaskType) -> str:
        snapshot = self.quality_snapshot
        if snapshot is not None:
            if task_type == PromptPathResolver.TaskType.TRANSLATION:
                return snapshot.translation_prompt
            return snapshot.analysis_prompt

        if task_type == PromptPathResolver.TaskType.TRANSLATION:
            return DataManager.get().get_translation_prompt()
        return DataManager.get().get_analysis_prompt()

    # 获取自定义提示词启用状态
    def get_custom_prompt_enable(self, task_type: PromptPathResolver.TaskType) -> bool:
        snapshot = self.quality_snapshot
        if snapshot is not None:
            if task_type == PromptPathResolver.TaskType.TRANSLATION:
                return snapshot.translation_prompt_enable
            return snapshot.analysis_prompt_enable

        if task_type == PromptPathResolver.TaskType.TRANSLATION:
            return DataManager.get().get_translation_prompt_enable()
        return DataManager.get().get_analysis_prompt_enable()

    def resolve_translation_prompt_base(
        self, prompt_language: BaseLanguage.Enum
    ) -> str:
        """翻译任务只看翻译提示词开关与正文。"""
        if self.get_custom_prompt_enable(PromptPathResolver.TaskType.TRANSLATION):
            return self.get_custom_prompt_data(PromptPathResolver.TaskType.TRANSLATION)
        return __class__.get_base(prompt_language)

    def resolve_analysis_prompt_base(self, prompt_language: BaseLanguage.Enum) -> str:
        """分析任务只看分析提示词开关与正文。"""
        if self.get_custom_prompt_enable(PromptPathResolver.TaskType.ANALYSIS):
            return self.get_custom_prompt_data(PromptPathResolver.TaskType.ANALYSIS)
        return __class__.get_analysis_base(prompt_language)

    @staticmethod
    def join_prompt_sections(
        prefix: str,
        base: str,
        thinking: str,
        suffix: str,
    ) -> str:
        """统一拼接提示词段落，保证输出块始终在末尾。"""
        parts = ["\n".join([prefix, base])]
        if thinking:
            parts.append(thinking)
        parts.append(suffix)
        return "\n\n".join(parts)

    def get_glossary_source_data(
        self,
    ) -> tuple[dict[str, Any], ...] | list[dict[str, Any]]:
        """统一读取术语来源，避免快照和 DataManager 分支在多处重复。"""
        if self.quality_snapshot is not None:
            return self.quality_snapshot.get_glossary_entries()
        return DataManager.get().get_glossary()

    def get_matched_glossary_entries(
        self,
        srcs: list[str],
    ) -> list[dict[str, Any]]:
        """按大小写规则筛选命中的术语，供不同提示词格式复用。"""
        full_text = "\n".join(srcs)
        full_text_lower = full_text.lower()
        matched_entries: list[dict[str, str]] = []

        for entry in self.get_glossary_source_data():
            src = str(entry.get("src", ""))
            is_case_sensitive = bool(entry.get("case_sensitive", False))
            if is_case_sensitive and src in full_text:
                matched_entries.append(entry)
            elif not is_case_sensitive and src.lower() in full_text_lower:
                matched_entries.append(entry)

        return matched_entries

    # 获取主提示词
    def build_main(self) -> str:
        prompt_language, _source_placeholder, source_language, target_language = (
            self.resolve_prompt_context()
        )

        with __class__.LOCK:
            # 前缀
            prefix = __class__.get_prefix(prompt_language)

            # 主体
            base = self.resolve_translation_prompt_base(prompt_language)

            # 强制思考
            thinking = __class__.get_suffix_thinking(prompt_language)

            # 后缀
            suffix_output = __class__.get_suffix(prompt_language)

        full_prompt = self.join_prompt_sections(prefix, base, thinking, suffix_output)
        full_prompt = full_prompt.replace("{source_language}", source_language)
        full_prompt = full_prompt.replace("{target_language}", target_language)

        return full_prompt

    def build_glossary_analysis_main(self) -> str:
        """构建术语分析任务的主提示词。"""
        prompt_language, _source_placeholder, _source_language, target_language = (
            self.resolve_prompt_context()
        )

        with __class__.LOCK:
            prefix = __class__.get_analysis_prefix(prompt_language)
            base = self.resolve_analysis_prompt_base(prompt_language)
            thinking = __class__.get_analysis_thinking(prompt_language)
            suffix = __class__.get_analysis_suffix(prompt_language)

        # 分析任务与翻译任务保持同样的三段式结构
        full_prompt = self.join_prompt_sections(prefix, base, thinking, suffix)
        return full_prompt.replace("{target_language}", target_language)

    # 构造参考上文
    def build_preceding(self, precedings: list[Item]) -> str:
        if not precedings:
            return ""
        elif self.is_prompt_ui_zh():
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
        result: list[str] = []
        for item in self.get_matched_glossary_entries(srcs):
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

        if self.is_prompt_ui_zh():
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
        result: list[str] = []
        for item in self.get_matched_glossary_entries(srcs):
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

        # 只有在提示词中明确包含 控制符 时才添加相应示例
        main_lower = main.lower()
        has_instruction = (
            "控制符" in main
            or "控制字符" in main
            or "control code" in main_lower
            or "control character" in main_lower
        )
        if not has_instruction:
            return ""

        # 判断提示词语言
        if self.is_prompt_ui_zh():
            prefix: str = "控制字符示例："
        else:
            prefix: str = "Control Characters Samples:"

        return prefix + "\n" + f"{', '.join(unique_samples)}"

    # 构建输入
    def build_inputs(self, srcs: list[str]) -> str:
        inputs = "\n".join(
            JSONTool.dumps({str(i): line}) for i, line in enumerate(srcs)
        )

        if self.is_prompt_ui_zh():
            return "输入：\n" + "```jsonline\n" + f"{inputs}\n" + "```"
        else:
            return "Input:\n" + "```jsonline\n" + f"{inputs}\n" + "```"

    def build_analysis_inputs(self, srcs: list[str]) -> str:
        """分析任务只需要纯文本原文，避免额外结构干扰模型抽取术语。"""
        if not srcs:
            return ""

        inputs = "\n".join(srcs)
        if self.is_prompt_ui_zh():
            return "输入：\n" + inputs
        else:
            return "Input:\n" + inputs

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

        # system=稳定指令（规则/格式约束）；user=本次任务动态数据。
        instruction_text = self.build_main()
        user_parts: list[str] = []

        # 参考上文
        result = self.build_preceding(precedings)
        if result != "":
            user_parts.append(result)
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
                user_parts.append(result)

                console_log.append(result)

        # 控制字符示例
        # 触发条件只检查 system 指令文本，避免 user 数据误触发。
        result = self.build_control_characters_samples(instruction_text, samples)
        if result != "":
            user_parts.append(result)
            console_log.append(result)

        # 输入
        result = self.build_inputs(srcs)
        if result != "":
            user_parts.append(result)

        messages.append({"role": "system", "content": instruction_text})
        messages.append({"role": "user", "content": "\n\n".join(user_parts)})

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

    def generate_glossary_prompt(
        self,
        srcs: list[str],
    ) -> tuple[list[dict[str, str]], list[str]]:
        """生成术语分析任务提示词。

        为什么单独建方法：
        - 分析任务使用独立提示词模板，不应混入翻译专用的控制符说明
        - 分析任务只看当前原文，避免上文和已有术语影响抽取结果
        """

        messages: list[dict[str, str]] = []
        console_log: list[str] = []

        instruction_text = self.build_glossary_analysis_main()
        inputs_text = self.build_analysis_inputs(srcs)

        messages.append({"role": "system", "content": instruction_text})
        messages.append({"role": "user", "content": inputs_text})
        return messages, console_log
