from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.SessionContext import SessionContext
from module.Storage.AssetStore import AssetStore
from module.Storage.DataStore import DataStore

class DataAccessLayer:
    """统一数据访问层"""

    _prepare_mode_flag: bool = False

    @classmethod
    def is_project_mode(cls) -> bool:
        """检查是否处于工程模式"""
        return SessionContext.get().is_loaded()

    @classmethod
    def is_prepare_mode(cls) -> bool:
        """检查是否处于准备模式（如工程创建、导入资产阶段）"""
        return cls._prepare_mode_flag

    @classmethod
    def prepare_mode_context(cls):
        """准备模式上下文管理器 (用于 ProjectStore 等场景)"""

        class Context:
            def __enter__(self):
                DataAccessLayer._prepare_mode_flag = True

            def __exit__(self, exc_type, exc_val, exc_tb):
                DataAccessLayer._prepare_mode_flag = False

        return Context()

    @classmethod
    def get_db(cls) -> DataStore | None:
        """获取当前工程的数据库（仅工程模式可用）"""
        return SessionContext.get().get_db()

    # ========== 统一的翻译条目操作 ==========

    @classmethod
    def get_all_items(cls, config: Config = None) -> list[Item]:
        """获取所有翻译条目"""
        db = cls.get_db()
        if db is None:
            return []
        return [Item.from_dict(d) for d in db.get_all_items()]

    @classmethod
    def set_items(cls, items: list[Item], config: Config = None) -> list[Item]:
        """保存所有翻译条目"""
        db = cls.get_db()
        if db is None:
            return items
        ids = db.set_items([item.to_dict() for item in items])
        for i, item in enumerate(items):
            item.set_id(ids[i])
        return items

    @classmethod
    def set_item(cls, item: Item, config: Config = None) -> Item:
        """保存单个翻译条目"""
        db = cls.get_db()
        if db is None:
            return item
        item_id = db.set_item(item.to_dict())
        item.set_id(item_id)
        return item

    @classmethod
    def get_item_count(cls, config: Config = None) -> int:
        """获取条目总数"""
        db = cls.get_db()
        if db is None:
            return 0
        return db.get_item_count()

    @classmethod
    def clear_items(cls, config: Config = None) -> None:
        """清空所有条目"""
        db = cls.get_db()
        if db is not None:
            db.clear_items()

    # ========== 统一的规则操作 ==========

    @classmethod
    def get_glossary_data(cls, config: Config = None) -> list[dict[str, str]]:
        """获取术语表数据"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is None:
                return []
            return db.get_rules(DataStore.RuleType.GLOSSARY)

        if config is None:
            config = Config().load()
        return config.glossary_data or []

    @classmethod
    def get_pre_replacement_data(cls, config: Config = None) -> list[dict[str, str]]:
        """获取翻译前替换规则"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is None:
                return []
            return db.get_rules(DataStore.RuleType.PRE_REPLACEMENT)

        if config is None:
            config = Config().load()
        return config.pre_translation_replacement_data or []

    @classmethod
    def get_post_replacement_data(cls, config: Config = None) -> list[dict[str, str]]:
        """获取翻译后替换规则"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is None:
                return []
            return db.get_rules(DataStore.RuleType.POST_REPLACEMENT)

        if config is None:
            config = Config().load()
        return config.post_translation_replacement_data or []

    @classmethod
    def get_text_preserve_data(cls, config: Config = None) -> list[dict[str, str]]:
        """获取文本保护规则"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is None:
                return []
            return db.get_rules(DataStore.RuleType.TEXT_PRESERVE)

        if config is None:
            config = Config().load()
        return config.text_preserve_data or []

    @classmethod
    def set_glossary_data(cls, data: list[dict[str, str]]) -> None:
        """保存术语表数据"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_rules(DataStore.RuleType.GLOSSARY, data)
            return

        config = Config().load()
        config.glossary_data = data
        config.save()

    @classmethod
    def set_pre_replacement_data(cls, data: list[dict[str, str]]) -> None:
        """保存翻译前替换规则"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_rules(DataStore.RuleType.PRE_REPLACEMENT, data)
            return

        config = Config().load()
        config.pre_translation_replacement_data = data
        config.save()

    @classmethod
    def set_post_replacement_data(cls, data: list[dict[str, str]]) -> None:
        """保存翻译后替换规则"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_rules(DataStore.RuleType.POST_REPLACEMENT, data)
            return

        config = Config().load()
        config.post_translation_replacement_data = data
        config.save()

    @classmethod
    def set_text_preserve_data(cls, data: list[dict[str, str]]) -> None:
        """保存文本保护规则"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_rules(DataStore.RuleType.TEXT_PRESERVE, data)
            return

        config = Config().load()
        config.text_preserve_data = data
        config.save()

    @classmethod
    def get_glossary_enable(cls) -> bool:
        """获取术语表启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                return db.get_meta("glossary_enable", True)
            return True

        return Config().load().glossary_enable

    @classmethod
    def set_glossary_enable(cls, enable: bool) -> None:
        """设置术语表启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_meta("glossary_enable", enable)
            return

        config = Config().load()
        config.glossary_enable = enable
        config.save()

    @classmethod
    def get_text_preserve_enable(cls) -> bool:
        """获取文本保护启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                return db.get_meta("text_preserve_enable", True)
            return True

        return Config().load().text_preserve_enable

    @classmethod
    def set_text_preserve_enable(cls, enable: bool) -> None:
        """设置文本保护启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_meta("text_preserve_enable", enable)
            return

        config = Config().load()
        config.text_preserve_enable = enable
        config.save()

    @classmethod
    def get_pre_replacement_enable(cls) -> bool:
        """获取翻译前替换启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                return db.get_meta("pre_translation_replacement_enable", True)
            return True

        return Config().load().pre_translation_replacement_enable

    @classmethod
    def set_pre_replacement_enable(cls, enable: bool) -> None:
        """设置翻译前替换启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_meta("pre_translation_replacement_enable", enable)
            return

        config = Config().load()
        config.pre_translation_replacement_enable = enable
        config.save()

    @classmethod
    def get_post_replacement_enable(cls) -> bool:
        """获取翻译后替换启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                return db.get_meta("post_translation_replacement_enable", True)
            return True

        return Config().load().post_translation_replacement_enable

    @classmethod
    def set_post_replacement_enable(cls, enable: bool) -> None:
        """设置翻译后替换启用状态"""
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                db.set_meta("post_translation_replacement_enable", enable)
            return

        config = Config().load()
        config.post_translation_replacement_enable = enable
        config.save()

    # ========== 自定义提示词操作 ==========

    @classmethod
    def get_custom_prompt_data(cls, language: BaseLanguage.Enum) -> str:
        """获取自定义提示词数据

        Args:
            language: 语言类型（ZH 或 EN）
        """
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                rule_type = (
                    DataStore.RuleType.CUSTOM_PROMPT_ZH
                    if language == BaseLanguage.Enum.ZH
                    else DataStore.RuleType.CUSTOM_PROMPT_EN
                )
                return db.get_rule_text(rule_type)
            return ""

        config = Config().load()
        if language == BaseLanguage.Enum.ZH:
            return config.custom_prompt_zh_data or ""
        return config.custom_prompt_en_data or ""

    @classmethod
    def set_custom_prompt_data(cls, language: BaseLanguage.Enum, data: str) -> None:
        """保存自定义提示词数据

        Args:
            language: 语言类型（ZH 或 EN）
            data: 提示词内容
        """
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                rule_type = (
                    DataStore.RuleType.CUSTOM_PROMPT_ZH
                    if language == BaseLanguage.Enum.ZH
                    else DataStore.RuleType.CUSTOM_PROMPT_EN
                )
                db.set_rule_text(rule_type, data)
            return

        config = Config().load()
        if language == BaseLanguage.Enum.ZH:
            config.custom_prompt_zh_data = data
        else:
            config.custom_prompt_en_data = data
        config.save()

    @classmethod
    def get_custom_prompt_enable(cls, language: BaseLanguage.Enum) -> bool:
        """获取自定义提示词启用状态

        Args:
            language: 语言类型（ZH 或 EN）
        """
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                meta_key = (
                    "custom_prompt_zh_enable"
                    if language == BaseLanguage.Enum.ZH
                    else "custom_prompt_en_enable"
                )
                return db.get_meta(meta_key, False)
            return False

        config = Config().load()
        if language == BaseLanguage.Enum.ZH:
            return config.custom_prompt_zh_enable
        return config.custom_prompt_en_enable

    @classmethod
    def set_custom_prompt_enable(
        cls, language: BaseLanguage.Enum, enable: bool
    ) -> None:
        """设置自定义提示词启用状态

        Args:
            language: 语言类型（ZH 或 EN）
            enable: 是否启用
        """
        if cls.is_project_mode():
            db = cls.get_db()
            if db is not None:
                meta_key = (
                    "custom_prompt_zh_enable"
                    if language == BaseLanguage.Enum.ZH
                    else "custom_prompt_en_enable"
                )
                db.set_meta(meta_key, enable)
            return

        config = Config().load()
        if language == BaseLanguage.Enum.ZH:
            config.custom_prompt_zh_enable = enable
        else:
            config.custom_prompt_en_enable = enable
        config.save()

    # ========== 资产操作 ==========

    @classmethod
    def get_all_asset_paths(cls) -> list[str]:
        """获取所有资产的相对路径列表（仅工程模式）"""
        if not cls.is_project_mode():
            return []

        db = cls.get_db()
        if db is None:
            return []
        return db.get_all_asset_paths()

    @classmethod
    def get_asset_content(cls, rel_path: str) -> bytes | None:
        """获取资产内容（已解压）

        Args:
            rel_path: 资产相对路径

        Returns:
            解压后的文件内容，如果不存在返回 None
        """
        if not cls.is_project_mode():
            return None

        db = cls.get_db()
        if db is None:
            return None

        compressed = db.get_asset(rel_path)
        if compressed is None:
            return None

        return AssetStore.decompress(compressed)

    @classmethod
    def get_asset_text(cls, rel_path: str, encoding: str = "utf-8") -> str | None:
        """获取资产文本内容

        Args:
            rel_path: 资产相对路径
            encoding: 文本编码

        Returns:
            文本内容，如果不存在返回 None
        """
        content = cls.get_asset_content(rel_path)
        if content is None:
            return None
        return content.decode(encoding)

    @classmethod
    def get_assets_by_extension(cls, extension: str) -> list[tuple[str, bytes]]:
        """获取指定扩展名的所有资产

        Args:
            extension: 文件扩展名（如 ".txt"）

        Returns:
            [(相对路径, 解压后内容), ...]
        """
        if not cls.is_project_mode():
            return []

        all_paths = cls.get_all_asset_paths()
        result = []

        for path in all_paths:
            if path.lower().endswith(extension.lower()):
                content = cls.get_asset_content(path)
                if content is not None:
                    result.append((path, content))

        return result
