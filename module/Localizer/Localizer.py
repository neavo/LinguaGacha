from base.Base import Base
from module.Localizer.LocalizerZH import LocalizerZH
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerBase import LocalizerBase

class Localizer():

    APP_LANGUAGE = Base.Language.ZH

    @classmethod
    def get(cls) -> LocalizerEN | LocalizerZH | LocalizerBase:
        if cls.APP_LANGUAGE == Base.Language.EN:
            return LocalizerEN
        else:
            return LocalizerZH

    @classmethod
    def get_app_language(cls) -> str:
        return cls.APP_LANGUAGE

    @classmethod
    def set_app_language(cls, app_language: str) -> None:
        cls.APP_LANGUAGE = app_language