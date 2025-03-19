from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem

class LanguageFilter():

    def filter(item: str | CacheItem, source_language: str) -> bool:
        # 格式为字符串时，自动创建 CacheItem 对象
        if isinstance(item, str):
            item = CacheItem({
                "src": item,
            })

        # 获取语言判断函数
        if source_language == Base.Language.ZH:
            func = TextHelper.CJK.any
        elif source_language == Base.Language.EN:
            func = TextHelper.Latin.any
        else:
            func = getattr(TextHelper, source_language).any

        # 返回值 True 表示需要过滤（即需要排除）
        if callable(func) != True:
            return False
        else:
            return not func(item.get_src())