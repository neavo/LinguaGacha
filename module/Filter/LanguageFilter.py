from base.BaseLanguage import BaseLanguage
from module.Cache.CacheItem import CacheItem
from module.Text.TextHelper import TextHelper

class LanguageFilter():

    def filter(src: str, source_language: str) -> bool:
        # 获取语言判断函数
        if source_language == BaseLanguage.ZH:
            func = TextHelper.CJK.any
        elif source_language == BaseLanguage.EN:
            func = TextHelper.Latin.any
        else:
            func = getattr(TextHelper, source_language).any

        # 返回值 True 表示需要过滤（即需要排除）
        if callable(func) != True:
            return False
        else:
            return not func(src)