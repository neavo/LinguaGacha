from base.BaseLanguage import BaseLanguage
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH

class Localizer():
    # 统一管理当前应用语言与双语文本解析入口，避免调用侧重复分支。

    APP_LANGUAGE: BaseLanguage.Enum = BaseLanguage.Enum.ZH

    @classmethod
    def get(cls) -> LocalizerZH | LocalizerEN:
        # 根据当前应用语言返回对应的本地化文本类。
        if cls.APP_LANGUAGE == BaseLanguage.Enum.EN:
            return LocalizerEN
        else:
            return LocalizerZH

    @classmethod
    def get_app_language(cls) -> BaseLanguage.Enum:
        # 统一暴露当前应用语言，供文本解析与业务判断复用。
        return cls.APP_LANGUAGE

    @classmethod
    def set_app_language(cls, app_language: BaseLanguage.Enum) -> None:
        # 修改应用语言的唯一入口，保持状态写入单一。
        cls.APP_LANGUAGE = app_language
