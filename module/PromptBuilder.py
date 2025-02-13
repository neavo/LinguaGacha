from base.Base import Base

class PromptBuilder(Base):

    def __init__(self) -> None:
        super().__init__()

    def get_base() -> str:
        if getattr(PromptBuilder, "base", None) == None:
            with open("resource/prompt/base.txt", "r", encoding = "utf-8-sig") as reader:
                PromptBuilder.base = reader.read().strip()

        return PromptBuilder.base

    def get_prefix() -> str:
        if getattr(PromptBuilder, "prefix", None) == None:
            with open("resource/prompt/prefix.txt", "r", encoding = "utf-8-sig") as reader:
                PromptBuilder.prefix = reader.read().strip()

        return PromptBuilder.prefix

    def get_suffix() -> str:
        if getattr(PromptBuilder, "suffix", None) == None:
            with open("resource/prompt/suffix.txt", "r", encoding = "utf-8-sig") as reader:
                PromptBuilder.suffix = reader.read().strip()

        return PromptBuilder.suffix

    def get_suffix_auto_glossary() -> str:
        if getattr(PromptBuilder, "suffix_auto_glossary", None) == None:
            with open("resource/prompt/suffix_auto_glossary.txt", "r", encoding = "utf-8-sig") as reader:
                PromptBuilder.suffix_auto_glossary = reader.read().strip()

        return PromptBuilder.suffix_auto_glossary

    # 获取系统提示词
    def build_base(config: dict, custom_prompt: bool, auto_glossary: bool) -> str:
        PromptBuilder.get_base()
        PromptBuilder.get_prefix()
        PromptBuilder.get_suffix()
        PromptBuilder.get_suffix_auto_glossary()

        if config.get("target_language") == Base.Language.ZH:
            target_language = "中文"
        elif config.get("target_language") == Base.Language.EN:
            target_language = "英文"
        elif config.get("target_language") == Base.Language.JA:
            target_language = "日文"
        elif config.get("target_language") == Base.Language.KO:
            target_language = "韩文"
        elif config.get("target_language") == Base.Language.RU:
            target_language = "俄文"

        # 判断是否启用自定义提示词
        if custom_prompt == False:
            base = PromptBuilder.base
        else:
            base = config.get("custom_prompt_data")

        # 判断是否启用自动术语表
        if auto_glossary == False:
            suffix = PromptBuilder.suffix
        else:
            suffix = PromptBuilder.suffix_auto_glossary

        return (PromptBuilder.prefix + "\n" + base + "\n" + suffix).replace("{target_language}", target_language)

    # 构造术语表
    def build_glossary(config: dict, input_dict: dict) -> tuple[str, str]:
        # 将输入字典中的所有值转换为集合
        lines = set(line for line in input_dict.values())

        # 筛选在输入词典中出现过的条目
        result = [
            v for v in config.get("glossary_data")
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
        else:
            return (
                "术语表："
                + "\n" + "\n".join(dict_lines)
            )

    # 构造术语表
    def build_glossary_sakura(config: dict, input_dict: dict) -> tuple[str, str]:
        # 将输入字典中的所有值转换为集合
        lines = set(line for line in input_dict.values())

        # 筛选在输入词典中出现过的条目
        result = [
            v for v in config.get("glossary_data")
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