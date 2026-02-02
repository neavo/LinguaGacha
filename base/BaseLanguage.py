from enum import StrEnum


class BaseLanguage:
    class Enum(StrEnum):
        ZH = "ZH"  # 中文 (Chinese)
        EN = "EN"  # 英文 (English)
        JA = "JA"  # 日文 (Japanese)
        KO = "KO"  # 韩文 (Korean)
        RU = "RU"  # 阿拉伯文 (Russian)
        AR = "AR"  # 俄文 (Arabic)
        DE = "DE"  # 德文 (German)
        FR = "FR"  # 法文 (French)
        PL = "PL"  # 波兰文 (Polish)
        ES = "ES"  # 西班牙文 (Spanish)
        IT = "IT"  # 意大利文 (Italian)
        PT = "PT"  # 葡萄牙文 (Portuguese)
        HU = "HU"  # 匈牙利文 (Hungrarian)
        TR = "TR"  # 土耳其文 (Turkish)
        TH = "TH"  # 泰文 (Thai)
        ID = "ID"  # 印尼文 (Indonesian)
        VI = "VI"  # 越南文 (Vietnamese)

    LANGUAGE_NAMES: dict[Enum, dict[str, str]] = {
        Enum.ZH: {"zh": "中文", "en": "Chinese"},
        Enum.EN: {"zh": "英文", "en": "English"},
        Enum.JA: {"zh": "日文", "en": "Japanese"},
        Enum.KO: {"zh": "韩文", "en": "Korean"},
        Enum.RU: {"zh": "俄文", "en": "Russian"},
        Enum.AR: {"zh": "阿拉伯文", "en": "Arabic"},
        Enum.DE: {"zh": "德文", "en": "German"},
        Enum.FR: {"zh": "法文", "en": "French"},
        Enum.PL: {"zh": "波兰文", "en": "Polish"},
        Enum.ES: {"zh": "西班牙", "en": "Spanish"},
        Enum.IT: {"zh": "意大利文", "en": "Italian"},
        Enum.PT: {"zh": "葡萄牙文", "en": "Portuguese"},
        Enum.HU: {"zh": "匈牙利文", "en": "Hungrarian"},
        Enum.TR: {"zh": "土耳其文", "en": "Turkish"},
        Enum.TH: {"zh": "泰文", "en": "Thai"},
        Enum.ID: {"zh": "印尼文", "en": "Indonesian"},
        Enum.VI: {"zh": "越南文", "en": "Vietnamese"},
    }

    @classmethod
    def is_cjk(cls, language: Enum) -> bool:
        return language in (cls.Enum.ZH, cls.Enum.JA, cls.Enum.KO)

    @classmethod
    def get_name_zh(cls, language: Enum) -> str:
        return cls.LANGUAGE_NAMES.get(language, {}).get("zh") or ""

    @classmethod
    def get_name_en(cls, language: Enum) -> str:
        return cls.LANGUAGE_NAMES.get(language, {}).get("en", "")

    @classmethod
    def get_languages(cls) -> list[Enum]:
        return list(cls.LANGUAGE_NAMES.keys())
