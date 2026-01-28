import copy
import json
import os
import threading
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any
from typing import ClassVar

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Storage.AssetStore import AssetStore
from module.Storage.DataStore import DataStore


class DataManager(Base):
    """全局数据中间件（单入口）

    设计目标：
    - 对外只暴露 DataManager.get().get_xxx()/set_xxx() 形式的 API
    - 隐藏 DataStore/SQLite 细节，统一缓存与落库策略
    - 工程加载后 meta 立即可用；items 按需加载；rules 懒加载缓存
    """

    instance: ClassVar["DataManager | None"] = None
    lock: ClassVar[threading.Lock] = threading.Lock()

    # 对外提供统一的规则枚举入口，避免 UI 直接依赖 DataStore
    RuleType = DataStore.RuleType

    RULE_META_KEYS: ClassVar[set[str]] = {
        "glossary_enable",
        "text_preserve_enable",
        "pre_translation_replacement_enable",
        "post_translation_replacement_enable",
        "custom_prompt_zh_enable",
        "custom_prompt_en_enable",
    }

    ASSET_DECOMPRESS_CACHE_MAX: ClassVar[int] = 32

    def __init__(self) -> None:
        super().__init__()

        self.state_lock = threading.RLock()

        # 工程上下文
        self.db: DataStore | None = None
        self.lg_path: str | None = None

        # meta 强缓存（工程加载后一次性读取）
        self.meta_cache: dict[str, Any] = {}

        # rules 懒加载缓存
        self.rule_cache: dict[DataStore.RuleType, Any] = {}
        self.rule_text_cache: dict[DataStore.RuleType, str] = {}

        # items 按需缓存（缓存 dict，避免共享 Item 可变对象）
        self.item_cache: list[dict[str, Any]] | None = None
        self.item_cache_index: dict[int, int] = {}

        # assets 解压缓存（小容量 LRU）
        self.asset_decompress_cache: OrderedDict[str, bytes] = OrderedDict()

        # 监听翻译活动以失效 items 缓存，避免读到中间态
        self.subscribe(Base.Event.TRANSLATION_RUN, self.on_translation_activity)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.on_translation_activity)
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_translation_activity)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED, self.on_translation_activity
        )

    @classmethod
    def get(cls) -> "DataManager":
        if cls.instance is None:
            with cls.lock:
                if cls.instance is None:
                    cls.instance = cls()
        return cls.instance

    # ===================== 生命周期 =====================

    def load_project(self, lg_path: str) -> None:
        """加载工程并初始化缓存（meta 立即可用）。"""
        with self.state_lock:
            if self.is_loaded():
                self.unload_project()

            if not Path(lg_path).exists():
                raise FileNotFoundError(f"工程文件不存在: {lg_path}")

            self.lg_path = lg_path
            self.db = DataStore(lg_path)

            # 更新最后访问时间（短连接写入即可）
            self.db.set_meta("updated_at", datetime.now().isoformat())

            # 载入 meta 强缓存
            self.meta_cache = self.db.get_all_meta()

            # 清理其它缓存（避免跨工程串数据）
            self.rule_cache.clear()
            self.rule_text_cache.clear()
            self.clear_item_cache()
            self.asset_decompress_cache.clear()

        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload_project(self) -> None:
        """卸载工程并清理缓存。"""
        old_path: str | None = None
        with self.state_lock:
            old_path = self.lg_path

            if self.db is not None:
                self.db.close()

            self.db = None
            self.lg_path = None

            self.meta_cache = {}
            self.rule_cache.clear()
            self.rule_text_cache.clear()
            self.clear_item_cache()
            self.asset_decompress_cache.clear()

        if old_path:
            self.emit(Base.Event.PROJECT_UNLOADED, {"path": old_path})

    def is_loaded(self) -> bool:
        with self.state_lock:
            return self.db is not None and self.lg_path is not None

    def get_lg_path(self) -> str | None:
        with self.state_lock:
            return self.lg_path

    def open_db(self) -> None:
        """打开长连接（翻译期间用，提升高频写入性能）。"""
        with self.state_lock:
            if self.db is None:
                return
            self.db.open()

    def close_db(self) -> None:
        """关闭长连接（触发 WAL checkpoint 清理）。"""
        with self.state_lock:
            if self.db is None:
                return
            self.db.close()

    def on_translation_activity(self, event: Base.Event, data: dict) -> None:
        # 翻译过程中 items 会频繁写入 DB；items 缓存不追实时，统一失效更安全。
        self.clear_item_cache()

    # ===================== meta =====================

    def get_meta(self, key: str, default: Any = None) -> Any:
        with self.state_lock:
            if key in self.meta_cache:
                value = self.meta_cache.get(key)
                return (
                    copy.deepcopy(value) if isinstance(value, (dict, list)) else value
                )

            if self.db is None:
                return default

            value = self.db.get_meta(key, default)
            self.meta_cache[key] = value
            return copy.deepcopy(value) if isinstance(value, (dict, list)) else value

    def set_meta(self, key: str, value: Any) -> None:
        with self.state_lock:
            if self.db is not None:
                self.db.set_meta(key, value)
            self.meta_cache[key] = value

        if key in self.RULE_META_KEYS:
            self.emit_quality_rule_update(meta_keys=[key])

    def get_project_status(self) -> Base.ProjectStatus:
        raw = self.get_meta("project_status", Base.ProjectStatus.NONE.value)
        if isinstance(raw, Base.ProjectStatus):
            return raw
        if isinstance(raw, str):
            try:
                return Base.ProjectStatus(raw)
            except Exception:
                return Base.ProjectStatus.NONE
        return Base.ProjectStatus.NONE

    def set_project_status(self, status: Base.ProjectStatus) -> None:
        self.set_meta("project_status", status.value)

    def get_translation_extras(self) -> dict:
        extras = self.get_meta("translation_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_translation_extras(self, extras: dict) -> None:
        self.set_meta("translation_extras", extras)

    # ===================== rules =====================

    def get_rules_cached(self, rule_type: DataStore.RuleType) -> list[dict[str, Any]]:
        with self.state_lock:
            cached = self.rule_cache.get(rule_type)
            if isinstance(cached, list):
                return list(cached)

            if self.db is None:
                return []

            data = self.db.get_rules(rule_type)
            self.rule_cache[rule_type] = data
            return list(data)

    def set_rules_cached(
        self,
        rule_type: DataStore.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        if save:
            with self.state_lock:
                if self.db is not None:
                    self.db.set_rules(rule_type, data)

        with self.state_lock:
            self.rule_cache[rule_type] = data
            # rules 变更后，文本类缓存可能与存储形态不一致，直接失效
            self.rule_text_cache.pop(rule_type, None)

        if save:
            self.emit_quality_rule_update(rule_types=[rule_type])

    def get_rule_text_cached(self, rule_type: DataStore.RuleType) -> str:
        with self.state_lock:
            cached = self.rule_text_cache.get(rule_type)
            if isinstance(cached, str):
                return cached

            if self.db is None:
                return ""

            text = self.db.get_rule_text(rule_type)
            self.rule_text_cache[rule_type] = text
            return text

    def set_rule_text_cached(self, rule_type: DataStore.RuleType, text: str) -> None:
        with self.state_lock:
            if self.db is not None:
                self.db.set_rule_text(rule_type, text)
            self.rule_text_cache[rule_type] = text
            # 文本类规则与列表类规则互斥，清理另一份缓存避免脏读
            self.rule_cache.pop(rule_type, None)

        self.emit_quality_rule_update(rule_types=[rule_type])

    def emit_quality_rule_update(
        self,
        rule_types: list[DataStore.RuleType] | None = None,
        meta_keys: list[str] | None = None,
    ) -> None:
        # 统一规则变更通知，避免组件主动拉取造成耦合
        payload: dict[str, Any] = {}
        if rule_types:
            payload["rule_types"] = [rule_type.value for rule_type in rule_types]
        if meta_keys:
            payload["meta_keys"] = meta_keys
        self.emit(Base.Event.QUALITY_RULE_UPDATE, payload)

    def get_glossary(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(DataStore.RuleType.GLOSSARY)

    def set_glossary(self, data: list[dict[str, Any]], save: bool = True) -> None:
        self.set_rules_cached(DataStore.RuleType.GLOSSARY, data, save)

    def get_glossary_enable(self) -> bool:
        return bool(self.get_meta("glossary_enable", True))

    def set_glossary_enable(self, enable: bool) -> None:
        self.set_meta("glossary_enable", bool(enable))

    def get_text_preserve(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(DataStore.RuleType.TEXT_PRESERVE)

    def set_text_preserve(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(DataStore.RuleType.TEXT_PRESERVE, data, True)

    def get_text_preserve_enable(self) -> bool:
        return bool(self.get_meta("text_preserve_enable", True))

    def set_text_preserve_enable(self, enable: bool) -> None:
        self.set_meta("text_preserve_enable", bool(enable))

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(DataStore.RuleType.PRE_REPLACEMENT)

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(DataStore.RuleType.PRE_REPLACEMENT, data, True)

    def get_pre_replacement_enable(self) -> bool:
        return bool(self.get_meta("pre_translation_replacement_enable", True))

    def set_pre_replacement_enable(self, enable: bool) -> None:
        self.set_meta("pre_translation_replacement_enable", bool(enable))

    def get_post_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(DataStore.RuleType.POST_REPLACEMENT)

    def set_post_replacement(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(DataStore.RuleType.POST_REPLACEMENT, data, True)

    def get_post_replacement_enable(self) -> bool:
        return bool(self.get_meta("post_translation_replacement_enable", True))

    def set_post_replacement_enable(self, enable: bool) -> None:
        self.set_meta("post_translation_replacement_enable", bool(enable))

    def get_custom_prompt_zh(self) -> str:
        return self.get_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_ZH)

    def set_custom_prompt_zh(self, text: str) -> None:
        self.set_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_ZH, text)

    def get_custom_prompt_zh_enable(self) -> bool:
        return bool(self.get_meta("custom_prompt_zh_enable", False))

    def set_custom_prompt_zh_enable(self, enable: bool) -> None:
        self.set_meta("custom_prompt_zh_enable", bool(enable))

    def get_custom_prompt_en(self) -> str:
        return self.get_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_EN)

    def set_custom_prompt_en(self, text: str) -> None:
        self.set_rule_text_cached(DataStore.RuleType.CUSTOM_PROMPT_EN, text)

    def get_custom_prompt_en_enable(self) -> bool:
        return bool(self.get_meta("custom_prompt_en_enable", False))

    def set_custom_prompt_en_enable(self, enable: bool) -> None:
        self.set_meta("custom_prompt_en_enable", bool(enable))

    def initialize_project_rules(self, db: DataStore) -> None:
        """创建新工程时的规则初始化（复用现有预设逻辑）。"""
        config = Config().load()
        loaded_presets: list[str] = []

        def load_json(path: str) -> list[dict[str, Any]] | None:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, list) else None
            except Exception as e:
                LogManager.get().error(f"Failed to load preset: {path}", e)
                return None

        # 1. 术语表
        if config.glossary_default_preset and os.path.exists(
            config.glossary_default_preset
        ):
            data = load_json(config.glossary_default_preset)
            if data is not None:
                db.set_rules(DataStore.RuleType.GLOSSARY, data)
                db.set_meta("glossary_enable", True)
                loaded_presets.append(Localizer.get().app_glossary_page)

        # 2. 文本保护
        if config.text_preserve_default_preset and os.path.exists(
            config.text_preserve_default_preset
        ):
            data = load_json(config.text_preserve_default_preset)
            if data is not None:
                db.set_rules(DataStore.RuleType.TEXT_PRESERVE, data)
                db.set_meta("text_preserve_enable", True)
                loaded_presets.append(Localizer.get().app_text_preserve_page)

        # 3. 译前替换
        if config.pre_translation_replacement_default_preset and os.path.exists(
            config.pre_translation_replacement_default_preset
        ):
            data = load_json(config.pre_translation_replacement_default_preset)
            if data is not None:
                db.set_rules(DataStore.RuleType.PRE_REPLACEMENT, data)
                db.set_meta("pre_translation_replacement_enable", True)
                loaded_presets.append(
                    Localizer.get().app_pre_translation_replacement_page
                )

        # 4. 译后替换
        if config.post_translation_replacement_default_preset and os.path.exists(
            config.post_translation_replacement_default_preset
        ):
            data = load_json(config.post_translation_replacement_default_preset)
            if data is not None:
                db.set_rules(DataStore.RuleType.POST_REPLACEMENT, data)
                db.set_meta("post_translation_replacement_enable", True)
                loaded_presets.append(
                    Localizer.get().app_post_translation_replacement_page
                )

        # 5. 自定义提示词（中文）
        if config.custom_prompt_zh_default_preset and os.path.exists(
            config.custom_prompt_zh_default_preset
        ):
            try:
                with open(
                    config.custom_prompt_zh_default_preset, "r", encoding="utf-8-sig"
                ) as f:
                    text = f.read().strip()
                db.set_rule_text(DataStore.RuleType.CUSTOM_PROMPT_ZH, text)
                db.set_meta("custom_prompt_zh_enable", True)
                loaded_presets.append(Localizer.get().app_custom_prompt_zh_page)
            except Exception as e:
                LogManager.get().error(
                    f"Failed to load default custom prompt (ZH) preset: {config.custom_prompt_zh_default_preset}",
                    e,
                )

        # 6. 自定义提示词（英文）
        if config.custom_prompt_en_default_preset and os.path.exists(
            config.custom_prompt_en_default_preset
        ):
            try:
                with open(
                    config.custom_prompt_en_default_preset, "r", encoding="utf-8-sig"
                ) as f:
                    text = f.read().strip()
                db.set_rule_text(DataStore.RuleType.CUSTOM_PROMPT_EN, text)
                db.set_meta("custom_prompt_en_enable", True)
                loaded_presets.append(Localizer.get().app_custom_prompt_en_page)
            except Exception as e:
                LogManager.get().error(
                    f"Failed to load default custom prompt (EN) preset: {config.custom_prompt_en_default_preset}",
                    e,
                )

        if loaded_presets:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_default_preset_loaded_toast.format(
                        NAME=" | ".join(loaded_presets)
                    ),
                },
            )

    # ===================== items =====================

    def clear_item_cache(self) -> None:
        with self.state_lock:
            self.item_cache = None
            self.item_cache_index = {}

    def load_item_cache_if_needed(self) -> None:
        with self.state_lock:
            if self.item_cache is not None:
                return
            if self.db is None:
                self.item_cache = []
                self.item_cache_index = {}
                return

            items = self.db.get_all_items()
            self.item_cache = items
            self.item_cache_index = {}
            for idx, item in enumerate(items):
                item_id = item.get("id")
                if isinstance(item_id, int):
                    self.item_cache_index[item_id] = idx

    def get_all_items(self) -> list[Item]:
        self.load_item_cache_if_needed()
        with self.state_lock:
            cache = self.item_cache or []
            return [Item.from_dict(d) for d in cache]

    def save_item(self, item: Item) -> int:
        item_dict = item.to_dict()

        with self.state_lock:
            if self.db is None:
                raise RuntimeError("工程未加载")
            item_id = self.db.set_item(item_dict)
            item.set_id(item_id)

            if self.item_cache is not None:
                idx = self.item_cache_index.get(item_id)
                if idx is None:
                    self.item_cache.append(item.to_dict())
                    self.item_cache_index[item_id] = len(self.item_cache) - 1
                else:
                    self.item_cache[idx] = item.to_dict()

        return item_id

    def replace_all_items(self, items: list[Item]) -> list[int]:
        items_dict = [item.to_dict() for item in items]

        with self.state_lock:
            if self.db is None:
                raise RuntimeError("工程未加载")
            ids = self.db.set_items(items_dict)

            # 同步回写 ID
            for item, item_id in zip(items, ids):
                if isinstance(item_id, int):
                    item.set_id(item_id)

            # 刷新缓存（保持与 DB 一致）
            self.item_cache = [item.to_dict() for item in items]
            self.item_cache_index = {}
            for idx, item in enumerate(self.item_cache):
                item_id = item.get("id")
                if isinstance(item_id, int):
                    self.item_cache_index[item_id] = idx

        return ids

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[DataStore.RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        with self.state_lock:
            if self.db is None:
                raise RuntimeError("工程未加载")
            self.db.update_batch(items=items, rules=rules, meta=meta)

            # 1) 同步 meta 缓存
            if meta:
                for k, v in meta.items():
                    self.meta_cache[k] = v

            # 2) 同步 rules 缓存
            if rules:
                for rule_type, rule_data in rules.items():
                    self.rule_cache[rule_type] = rule_data
                    self.rule_text_cache.pop(rule_type, None)

            # 3) 同步 items 缓存（仅在已加载全量缓存时做增量更新）
            if items and self.item_cache is not None:
                for item in items:
                    item_id = item.get("id")
                    if not isinstance(item_id, int):
                        continue
                    idx = self.item_cache_index.get(item_id)
                    if idx is None:
                        continue
                    self.item_cache[idx] = item

        # 事务提交成功后再发事件
        if rules:
            self.emit_quality_rule_update(rule_types=list(rules.keys()))
        if meta:
            keys = [k for k in meta.keys() if k in self.RULE_META_KEYS]
            if keys:
                self.emit_quality_rule_update(meta_keys=keys)

    def get_items_for_translation(
        self,
        config: Config,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        """按翻译模式获取条目列表（翻译器入口使用）。"""
        from module.File.FileManager import FileManager

        with self.state_lock:
            if self.db is None:
                return []
            db = self.db

        return FileManager(config).get_items_for_translation(mode, db=db)

    # ===================== assets =====================

    def get_all_asset_paths(self) -> list[str]:
        with self.state_lock:
            if self.db is None:
                return []
            return self.db.get_all_asset_paths()

    def get_asset(self, rel_path: str) -> bytes | None:
        with self.state_lock:
            if self.db is None:
                return None
            return self.db.get_asset(rel_path)

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        with self.state_lock:
            if rel_path in self.asset_decompress_cache:
                data = self.asset_decompress_cache.pop(rel_path)
                self.asset_decompress_cache[rel_path] = data
                return data

        compressed = self.get_asset(rel_path)
        if compressed is None:
            return None

        try:
            decompressed = AssetStore.decompress(compressed)
        except Exception as e:
            self.error(f"解压资产失败: {rel_path}", e)
            return None

        with self.state_lock:
            self.asset_decompress_cache[rel_path] = decompressed
            while len(self.asset_decompress_cache) > self.ASSET_DECOMPRESS_CACHE_MAX:
                self.asset_decompress_cache.popitem(last=False)

        return decompressed
