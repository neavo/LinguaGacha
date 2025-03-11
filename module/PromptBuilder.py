from base.Base import Base
from module.Cache.CacheItem import CacheItem

class PromptBuilder(Base):

    # 伪回复文本
    FAKE_REPLY_ZH = "我完全理解了翻译任务的要求，我将遵循您的指示进行翻译，以下是对原文的翻译："
    FAKE_REPLY_EN = "I fully understand the requirements of the translation task, and I will follow your instructions to translate. Here is the translation of the original text:"

	# 目标语言映射
    TARGET_LANGUAGE_MAPPING = {
        Base.Language.ZH : "中文",
        Base.Language.EN : "English",
        Base.Language.JA : "Japanese",
        Base.Language.KO : "Korean",
        Base.Language.RU : "Russian",
        Base.Language.DE : "German",
        Base.Language.FR : "French",
        Base.Language.ES : "Spanish",
        Base.Language.IT : "Italian",
        Base.Language.PT : "Portuguese",
        Base.Language.TH : "Thai",
        Base.Language.ID : "Indonesian",
        Base.Language.VI : "Vietnamese",
    }

    # 代码示例文本
    CODE_SAMPLE_ZH = "，特别是 {code_sample} 形式的代码段"
    CODE_SAMPLE_EN = ", especially code segments in the format of {code_sample} "

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.target_language = config.get("target_language")
        self.auto_glossary_enable = config.get("auto_glossary_enable")
        self.glossary_data = config.get("glossary_data")

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
    def build_main(self, samples: list[str]) -> tuple[str, str]:
        # 判断提示词语言
        if self.target_language == Base.Language.ZH:
            prompt_language = Base.Language.ZH
        else:
            prompt_language = Base.Language.EN

        self.get_base(prompt_language)
        self.get_prefix(prompt_language)
        self.get_suffix(prompt_language)
        self.get_suffix_glossary(prompt_language)

        # 判断是否是否自定义提示词
        if prompt_language == Base.Language.ZH and self.config.get("custom_prompt_zh_enable") == True:
            base = self.config.get("custom_prompt_zh_data")
        elif prompt_language == Base.Language.EN and self.config.get("custom_prompt_en_enable") == True:
            base = self.config.get("custom_prompt_en_data")
        else:
            base = self.base

        # 添加或移除代码示例文本
        extra_log = ""
        if len(samples) > 0:
            if prompt_language == Base.Language.ZH:
                base = base.replace(
                    "但其中的非英文文本词语需要翻译。",
                    f"特别是 {"、".join(samples)} 形式的代码段，"
                    f"但其中的非英文文本词语需要翻译。",
                )
                extra_log = f"已添加代码示例：\n{"、".join(samples)}"
            elif len(samples) == 1:
                base = base.replace(
                    "However, translate any non-English words that appear within these elements.",
                    f"especially code segments in the format of {samples[0]}. "
                    f"However, translate any non-English words that appear within these elements.",
                )
                extra_log = f"Code samples added:\n{samples[0]}"
            elif len(samples) >= 2:
                base = base.replace(
                    "However, translate any non-English words that appear within these elements.",
                    f"especially code segments in the format of {f"{", ".join(samples[:-1])} and {samples[-1]}"}. "
                    f"However, translate any non-English words that appear within these elements.",
                )
                extra_log = f"Code samples added:\n{f"{", ".join(samples[:-1])} and {samples[-1]}"}"

        # 判断是否启用自动术语表
        if self.auto_glossary_enable == False:
            suffix = self.suffix
        else:
            suffix = self.suffix_glossary

        return (
            (self.prefix + "\n" + base + "\n" + suffix).replace("{target_language}", PromptBuilder.TARGET_LANGUAGE_MAPPING.get(self.target_language)),
            extra_log,
        )

    # 构造参考上文
    def build_preceding(self, preceding_items: list[CacheItem]) -> str:
        if preceding_items == []:
            return ""
        elif self.target_language == Base.Language.ZH:
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
        elif self.target_language == Base.Language.ZH:
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

    # 构造伪回复
    def build_fake_reply(self) -> str:
        if self.target_language == Base.Language.ZH:
            return PromptBuilder.FAKE_REPLY_ZH
        else:
            return PromptBuilder.FAKE_REPLY_EN