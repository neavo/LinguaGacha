from base.Base import Base

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
        Base.Language.TH : "Thai",
        Base.Language.ID : "Indonesian",
        Base.Language.VI : "Vietnamese",
    }

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

    def get_base_renpy(self, language: str) -> str:
        if getattr(self, "base_renpy", None) is None:
            with open(f"resource/prompt/{language.lower()}/base_renpy.txt", "r", encoding = "utf-8-sig") as reader:
                self.base_renpy = reader.read().strip()

        return self.base_renpy

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
    def build_main(self, renpy: bool) -> str:
        if self.target_language == Base.Language.ZH:
            prompt_language = Base.Language.ZH
        else:
            prompt_language = Base.Language.EN

        if prompt_language == Base.Language.ZH:
            custom_prompt_enable = self.config.get("custom_prompt_zh_enable")
            custom_prompt_data = self.config.get("custom_prompt_zh_data")
        else:
            custom_prompt_enable = self.config.get("custom_prompt_en_enable")
            custom_prompt_data = self.config.get("custom_prompt_en_data")

        self.get_base(prompt_language)
        self.get_base_renpy(prompt_language)
        self.get_prefix(prompt_language)
        self.get_suffix(prompt_language)
        self.get_suffix_glossary(prompt_language)

        # 判断使用哪个版本的提示词
        if custom_prompt_enable == True:
            base = custom_prompt_data
        elif renpy == True:
            base = self.base_renpy
        else:
            base = self.base

        # 判断是否启用自动术语表
        if self.auto_glossary_enable == False:
            suffix = self.suffix
        else:
            suffix = self.suffix_glossary

        return (self.prefix + "\n" + base + "\n" + suffix).replace("{target_language}", PromptBuilder.TARGET_LANGUAGE_MAPPING.get(self.target_language))

    # 构造术语表
    def build_glossary(self, input_dict: dict) -> str:
        # 将输入字典中的所有值转换为集合
        lines = set(line for line in input_dict.values())

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
    def build_glossary_sakura(self, input_dict: dict) -> str:
        # 将输入字典中的所有值转换为集合
        lines = set(line for line in input_dict.values())

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