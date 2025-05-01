from base.BaseLanguage import BaseLanguage
from module.Localizer.LocalizerZH import LocalizerZH
from module.Localizer.LocalizerEN import LocalizerEN

class Localizer():

    APP_LANGUAGE = BaseLanguage.Enum.ZH

    @classmethod
    def get(cls) -> LocalizerZH | LocalizerEN:
        if cls.APP_LANGUAGE == BaseLanguage.Enum.EN:
            return LocalizerEN
        else:
            return LocalizerZH

    @classmethod
    def get_app_language(cls) -> str:
        return cls.APP_LANGUAGE

    @classmethod
    def set_app_language(cls, app_language: BaseLanguage) -> None:
        cls.APP_LANGUAGE = app_language