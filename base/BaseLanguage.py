from base.BaseData import BaseData


class BaseLanguage(BaseData):

    ZH: str = "ZH"                                          # 中文 (Chinese)
    EN: str = "EN"                                          # 英文 (English)
    JA: str = "JA"                                          # 日文 (Japanese)
    KO: str = "KO"                                          # 韩文 (Korean)
    RU: str = "RU"                                          # 阿拉伯文 (Russian)
    AR: str = "AR"                                          # 俄文 (Arabic)
    DE: str = "DE"                                          # 德文 (German)
    FR: str = "FR"                                          # 法文 (French)
    PL: str = "PL"                                          # 波兰文 (Polish)
    ES: str = "ES"                                          # 西班牙文 (Spanish)
    IT: str = "IT"                                          # 意大利文 (Italian)
    PT: str = "PT"                                          # 葡萄牙文 (Portuguese)
    HU: str = "HU"                                          # 匈牙利文 (Hungrarian)
    TR: str = "TR"                                          # 土耳其文 (Turkish)
    TH: str = "TH"                                          # 泰文 (Thai)
    ID: str = "ID"                                          # 印尼文 (Indonesian)
    VI: str = "VI"                                          # 越南文 (Vietnamese)

    LANGUAGE_NAMES = {
        ZH: {"zh": "中文", "en": "Chinese"},
        EN: {"zh": "英文", "en": "English"},
        JA: {"zh": "日文", "en": "Japanese"},
        KO: {"zh": "韩文", "en": "Korean"},
        RU: {"zh": "俄文", "en": "Russian"},
        # AR: {"zh": "阿拉伯文", "en": "Arabic"},
        DE: {"zh": "德文", "en": "German"},
        FR: {"zh": "法文", "en": "French"},
        PL: {"zh": "波兰文", "en": "Polish"},
        ES: {"zh": "西班牙", "en": "Spanish"},
        IT: {"zh": "意大利文", "en": "Italian"},
        PT: {"zh": "葡萄牙文", "en": "Portuguese"},
        HU: {"zh": "匈牙利文", "en": "Hungrarian"},
        TR: {"zh": "土耳其文", "en": "Turkish"},
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