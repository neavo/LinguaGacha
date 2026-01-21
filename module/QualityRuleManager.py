import threading
from typing import Any
from typing import ClassVar

from base.Base import Base
from module.Storage.DataStore import DataStore
from module.Storage.StorageContext import StorageContext


class QualityRuleManager(Base):
    """
    质量规则管理器 (单例)

    职责：
    1. 统一提供规则数据的读写接口 (Glossary, Replacement, etc.)
    2. 维护规则数据的内存缓存，提升读取性能

    设计：
    - 数据源：优先读取当前激活的 DataStore (.lg)
    - 缓存：在内存中持有当前项目的规则副本，切换项目时自动清空
    """

    instance: ClassVar["QualityRuleManager | None"] = None
    lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(self) -> None:
        super().__init__()
        # 缓存结构: { RuleType: list[dict] | dict }
        self._cache: dict[str, Any] = {}

        # 监听项目加载/卸载事件，用于清理缓存
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_changed)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_changed)

    @classmethod
    def get(cls) -> "QualityRuleManager":
        """获取单例实例"""
        if cls.instance is None:
            with cls.lock:
                if cls.instance is None:
                    cls.instance = cls()
        return cls.instance

    # ========== 缓存管理 ==========

    def on_project_changed(self, event: Base.Event, event_data: dict) -> None:
        """项目切换时清空缓存"""
        self.clear_cache()

    def clear_cache(self) -> None:
        """清空所有内存缓存"""
        self._cache.clear()

    # ========== 核心业务接口 ==========

    def get_glossary(self) -> list[dict[str, Any]]:
        """获取术语表"""
        return self.get_rules_cached(DataStore.RuleType.GLOSSARY)

    def set_glossary(self, data: list[dict[str, Any]], save: bool = True) -> None:
        """
        保存术语表
        :param data: 术语表数据
        :param save: 是否保存到数据库，默认为 True。如果为 False，则仅更新内存缓存。
        """
        self.set_rules_cached(DataStore.RuleType.GLOSSARY, data, save)

    def get_glossary_enable(self) -> bool:
        """获取术语表启用状态"""
        return self.get_meta_cached("glossary_enable", True)

    def set_glossary_enable(self, enable: bool) -> None:
        """设置术语表启用状态"""
        self.set_meta_cached("glossary_enable", enable)

    def get_text_preserve(self) -> list[dict[str, Any]]:
        """获取文本保护规则"""
        return self.get_rules_cached(DataStore.RuleType.TEXT_PRESERVE)

    def set_text_preserve(self, data: list[dict[str, Any]]) -> None:
        """保存文本保护规则"""
        self.set_rules_cached(DataStore.RuleType.TEXT_PRESERVE, data)

    def get_text_preserve_enable(self) -> bool:
        """获取文本保护启用状态"""
        return self.get_meta_cached("text_preserve_enable", True)

    def set_text_preserve_enable(self, enable: bool) -> None:
        """设置文本保护启用状态"""
        self.set_meta_cached("text_preserve_enable", enable)

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        """获取翻译前替换规则"""
        return self.get_rules_cached(DataStore.RuleType.PRE_REPLACEMENT)

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> None:
        """保存翻译前替换规则"""
        self.set_rules_cached(DataStore.RuleType.PRE_REPLACEMENT, data)

    def get_pre_replacement_enable(self) -> bool:
        """获取翻译前替换启用状态"""
        return self.get_meta_cached("pre_translation_replacement_enable", True)

    def set_pre_replacement_enable(self, enable: bool) -> None:
        """设置翻译前替换启用状态"""
        self.set_meta_cached("pre_translation_replacement_enable", enable)

    def get_post_replacement(self) -> list[dict[str, Any]]:
        """获取翻译后替换规则"""
        return self.get_rules_cached(DataStore.RuleType.POST_REPLACEMENT)

    def set_post_replacement(self, data: list[dict[str, Any]]) -> None:
        """保存翻译后替换规则"""
        self.set_rules_cached(DataStore.RuleType.POST_REPLACEMENT, data)

    def get_post_replacement_enable(self) -> bool:
        """获取翻译后替换启用状态"""
        return self.get_meta_cached("post_translation_replacement_enable", True)

    def set_post_replacement_enable(self, enable: bool) -> None:
        """设置翻译后替换启用状态"""
        self.set_meta_cached("post_translation_replacement_enable", enable)

    def get_custom_prompt_zh(self) -> str:
        """获取自定义提示词（中文）"""
        return self.get_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_ZH)

    def set_custom_prompt_zh(self, text: str) -> None:
        """保存自定义提示词（中文）"""
        self.set_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_ZH, text)

    def get_custom_prompt_zh_enable(self) -> bool:
        """获取自定义提示词（中文）启用状态"""
        return self.get_meta_cached("custom_prompt_zh_enable", False)

    def set_custom_prompt_zh_enable(self, enable: bool) -> None:
        """设置自定义提示词（中文）启用状态"""
        self.set_meta_cached("custom_prompt_zh_enable", enable)

    def get_custom_prompt_en(self) -> str:
        """获取自定义提示词（英文）"""
        return self.get_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_EN)

    def set_custom_prompt_en(self, text: str) -> None:
        """保存自定义提示词（英文）"""
        self.set_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_EN, text)

    def get_custom_prompt_en_enable(self) -> bool:
        """获取自定义提示词（英文）启用状态"""
        return self.get_meta_cached("custom_prompt_en_enable", False)

    def set_custom_prompt_en_enable(self, enable: bool) -> None:
        """设置自定义提示词（英文）启用状态"""
        self.set_meta_cached("custom_prompt_en_enable", enable)

    # ========== 内部实现 (缓存 + DB) ==========
    def get_db(self) -> DataStore | None:
        """获取当前激活的数据库"""
        return StorageContext.get().get_db()

    def get_rules_cached(self, rule_type: DataStore.RuleType) -> list[dict[str, Any]]:
        """从缓存或 DB 获取列表类规则"""
        # 1. 查缓存
        if rule_type in self._cache:
            # 返回副本以确保线程安全（避免迭代时被修改）
            return list(self._cache[rule_type])

        # 2. 查 DB
        db = self.get_db()
        if not db:
            return []

        data = db.get_rules(rule_type)

        # 3. 写缓存
        self._cache[rule_type] = data

        # 返回副本
        return list(data)

    def set_rules_cached(
        self,
        rule_type: DataStore.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        """写入 DB 并更新缓存"""
        # 1. 写 DB
        if save:
            db = self.get_db()
            if db:
                db.set_rules(rule_type, data)

        # 2. 更新缓存
        self._cache[rule_type] = data

    def get_rule_text_cached(self, rule_type: DataStore.RuleType) -> str:
        """从缓存或 DB 获取文本类规则"""
        # 1. 查缓存
        if rule_type in self._cache:
            return self._cache[rule_type]

        # 2. 查 DB
        db = self.get_db()
        if not db:
            return ""

        text = db.get_rule_text(rule_type)

        # 3. 写缓存
        self._cache[rule_type] = text
        return text

    def set_rule_text_cached(self, rule_type: DataStore.RuleType, text: str) -> None:
        """写入 DB 并更新缓存"""
        # 1. 写 DB
        db = self.get_db()
        if db:
            db.set_rule_text(rule_type, text)

        # 2. 更新缓存
        self._cache[rule_type] = text

    def get_meta_cached(self, key: str, default: Any) -> Any:
        """从缓存或 DB 获取元数据"""
        # 1. 查缓存
        if key in self._cache:
            return self._cache[key]

        # 2. 查 DB
        db = self.get_db()
        if not db:
            return default

        value = db.get_meta(key, default)

        # 3. 写缓存
        self._cache[key] = value
        return value

    def set_meta_cached(self, key: str, value: Any) -> None:
        """写入 DB 并更新缓存"""
        # 1. 写 DB
        db = self.get_db()
        if db:
            db.set_meta(key, value)

        # 2. 更新缓存
        self._cache[key] = value

    # ========== 初始化逻辑 ==========
    def initialize_project_rules(self, db: DataStore) -> None:
        """
        初始化项目规则 (用于新项目创建时)
        默认为空，无需预加载
        """
        pass
