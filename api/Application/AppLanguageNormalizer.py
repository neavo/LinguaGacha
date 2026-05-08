from base.BaseLanguage import BaseLanguage


class AppLanguageNormalizer:
    """应用 UI 语言归一化规则，供运行时同步复用。"""

    SUPPORTED_APP_LANGUAGES: tuple[BaseLanguage.Enum, ...] = (
        BaseLanguage.Enum.ZH,
        BaseLanguage.Enum.EN,
    )

    @classmethod
    def normalize(cls, value: object) -> BaseLanguage.Enum:
        """只允许落到当前已接入 UI 资源的稳定语言集合。"""

        normalized_value = str(value).strip().upper()
        try:
            normalized_language = BaseLanguage.Enum(normalized_value)
        except ValueError as e:
            raise ValueError("应用语言只支持 ZH 或 EN。") from e

        if normalized_language not in cls.SUPPORTED_APP_LANGUAGES:
            raise ValueError("应用语言只支持 ZH 或 EN。")

        return normalized_language
