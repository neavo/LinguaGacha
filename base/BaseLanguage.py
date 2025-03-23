from base.BaseData import BaseData


class BaseLanguage(BaseData):

    ZH: str = "ZH"                                          # 中文 (Chinese)
    EN: str = "EN"                                          # 英语 (English)
    JA: str = "JA"                                          # 日语 (Japanese)
    KO: str = "KO"                                          # 韩语 (Korean)
    RU: str = "RU"                                          # 俄语 (Russian)
    DE: str = "DE"                                          # 德语 (German)
    FR: str = "FR"                                          # 法语 (French)
    PL: str = "PL"                                          # 法语 (French)
    ES: str = "ES"                                          # 西班牙语 (Spanish)
    IT: str = "IT"                                          # 意大利语 (Italian)
    PT: str = "PT"                                          # 葡萄牙语 (Portuguese)
    HU: str = "HU"                                          # 匈牙利语 (Hungrarian)
    TH: str = "TH"                                          # 泰语 (Thai)
    ID: str = "ID"                                          # 印尼语 (Indonesian)
    VI: str = "VI"                                          # 越南语 (Vietnamese)

    LANGUAGE_NAMES = {
        ZH: {"zh": "中文", "en": "Chinese"},
        EN: {"zh": "英文", "en": "English"},
        JA: {"zh": "日文", "en": "Japanese"},
        KO: {"zh": "韩文", "en": "Korean"},
        RU: {"zh": "俄文", "en": "Russian"},
        DE: {"zh": "德文", "en": "German"},
        FR: {"zh": "法文", "en": "French"},
        # PL: {"zh": "波兰文", "en": "Polish"},
        ES: {"zh": "西班牙", "en": "Spanish"},
        IT: {"zh": "意大利文", "en": "Italian"},
        PT: {"zh": "葡萄牙文", "en": "Portuguese"},
        HU: {"zh": "匈牙利文", "en": "Hungrarian"},
        TH: {"zh": "泰文", "en": "Thai"},
        ID: {"zh": "印尼文", "en": "Indonesian"},
        VI: {"zh": "越南文", "en": "Vietnamese"},
    }

    @classmethod
    def is_cjk(cls, language: str) -> bool:
        return language in (cls.ZH, cls.JA, cls.KO)

    @classmethod
    def get_name_zh(cls, language: str) -> str:
        return cls.LANGUAGE_NAMES.get(language, {}).get("zh" "")

    @classmethod
    def get_name_en(cls, language: str) -> str:
        return cls.LANGUAGE_NAMES.get(language, {}).get("en", "")

    @classmethod
    def get_languages(cls) -> list[str]:
        return list(cls.LANGUAGE_NAMES.keys())