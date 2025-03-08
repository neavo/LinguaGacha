from base.Base import Base
from module.Localizer.LocalizerZH import LocalizerZH
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerBase import LocalizerBase

class Localizer():

    @classmethod
    def get(cls) -> LocalizerBase:
        if cls.app_language == Base.Language.EN:
            return LocalizerEN
        else:
            return LocalizerZH

    @classmethod
    def get_app_language(cls) -> str:
        return cls.app_language

    @classmethod
    def set_app_language(cls, app_language: str) -> None:
        cls.app_language = app_language