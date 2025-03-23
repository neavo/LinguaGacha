from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerBase import LocalizerBase

class Localizer():

    APP_LANGUAGE = BaseLanguage.ZH

    @classmethod
    def get(cls) -> LocalizerBase | LocalizerEN:
        if cls.APP_LANGUAGE == BaseLanguage.EN:
            return LocalizerEN
        else:
            return LocalizerBase

    @classmethod
    def get_app_language(cls) -> str:
        return cls.APP_LANGUAGE

    @classmethod
    def set_app_language(cls, app_language: str) -> None:
        cls.APP_LANGUAGE = app_language