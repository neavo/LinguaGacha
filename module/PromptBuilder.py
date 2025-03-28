from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Cache.CacheItem import CacheItem

class PromptBuilder(Base):

    # 伪回复文本
    FAKE_REPLY_ZH = "我完全理解了翻译任务的要求"
    FAKE_REPLY_EN = "I fully understand the requirements of the translation task"

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language = config.get("source_language")
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

    # 构造伪回复
    def build_fake_reply(self) -> str:
        if self.target_language == BaseLanguage.ZH:
            return PromptBuilder.FAKE_REPLY_ZH
        else:
            return PromptBuilder.FAKE_REPLY_EN

    # 构建控制字符示例
    def build_control_characters_samples(self, samples: list[str]) -> str:
        if len(samples) == 0:
            return ""

        # 判断提示词语言
        if self.target_language == BaseLanguage.ZH:
            prefix: str = "控制字符示例："
        else:
            prefix: str = "Control Characters Samples:"

        return prefix + "\n" + f"{", ".join(samples)}"