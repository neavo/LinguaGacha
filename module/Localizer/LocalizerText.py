from dataclasses import dataclass

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer


@dataclass(frozen=True)
class LocalizerText:
    # 简单的 UI 文本载体，避免调用处手写分支判断语言。
    zh: str | None = None
    en: str | None = None

    def resolve(self) -> str | None:
        # 依据当前 UI 语言返回文本，缺失时回退到另一语言。
        app_language = Localizer.get_app_language()
        if app_language == BaseLanguage.Enum.EN:
            if self.en is not None:
                return self.en
            return self.zh
        if self.zh is not None:
            return self.zh
        return self.en
