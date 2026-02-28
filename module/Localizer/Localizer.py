from dataclasses import dataclass

from base.BaseLanguage import BaseLanguage
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH

class Localizer():
    # 统一管理当前应用语言与双语文本解析入口，避免调用侧重复分支。

    @dataclass(frozen=True)
    class UnionText:
        # 统一的中英双语文本载体，按当前语言解析并自动回退。
        zh: str | None = None
        en: str | None = None

        def resolve(self) -> str | None:
            # 优先返回当前语言文本，当前语言缺失时回退到另一种语言。
            app_language = Localizer.get_app_language()
            if app_language == BaseLanguage.Enum.EN:
                if self.en is not None:
                    return self.en
                return self.zh
            if self.zh is not None:
                return self.zh
            return self.en

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
