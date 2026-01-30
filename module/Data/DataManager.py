import threading
from contextlib import AbstractContextManager
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from typing import ClassVar

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.AssetService import AssetService
from module.Data.BatchService import BatchService
from module.Data.ExportPathService import ExportPathService
from module.Data.ItemService import ItemService
from module.Data.LGDatabase import LGDatabase
from module.Data.MetaService import MetaService
from module.Data.ProjectSession import ProjectSession
from module.Data.RuleService import RuleService
from module.Data.Type import RULE_META_KEYS
from module.Localizer.Localizer import Localizer


class DataManager(Base):
    """全局数据中间件（单入口）。

    设计目标：
    - 对外只暴露 DataManager.get().get_xxx()/set_xxx() 形式的 API
    - 对内将具体实现下沉到独立 Service，DataManager 仅做委派与事件出口
    """

    instance: ClassVar["DataManager | None"] = None
    lock: ClassVar[threading.Lock] = threading.Lock()

    # 对外提供统一的规则枚举入口，避免业务侧直接依赖数据库实现
    RuleType = LGDatabase.RuleType

    class TextPreserveMode(StrEnum):
        OFF = "off"  # 完全关闭：不使用内置或自定义规则
        SMART = "smart"  # 智能：使用内置预置规则
        CUSTOM = "custom"  # 自定义：使用项目内自定义规则

    def __init__(self) -> None:
        super().__init__()

        self.session = ProjectSession()
        self.state_lock = self.session.state_lock

        self.meta_service = MetaService(self.session)
        self.rule_service = RuleService(self.session)
        self.item_service = ItemService(self.session)
        self.asset_service = AssetService(self.session)
        self.batch_service = BatchService(self.session)
        # 避免与 FileManager/文件解析模块形成循环依赖：这里使用延迟导入。
        from module.Data.ProjectService import ProjectService
        from module.Data.TranslationItemService import TranslationItemService

        self.translation_item_service = TranslationItemService(self.session)
        self.project_service = ProjectService()
        self.export_path_service = ExportPathService()

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

            self.session.lg_path = lg_path
            self.session.db = LGDatabase(lg_path)

            # 更新最后访问时间（短连接写入即可）
            self.session.db.set_meta("updated_at", datetime.now().isoformat())

            # 载入 meta 强缓存
            self.meta_service.refresh_cache_from_db()

            # 清理其它缓存（避免跨工程串数据）
            self.session.rule_cache.clear()
            self.session.rule_text_cache.clear()
            self.item_service.clear_item_cache()
            self.asset_service.clear_decompress_cache()

        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload_project(self) -> None:
        """卸载工程并清理缓存。"""
        old_path: str | None = None
        with self.state_lock:
            old_path = self.session.lg_path

            if self.session.db is not None:
                self.session.db.close()

            self.session.db = None
            self.session.lg_path = None
            self.session.clear_all_caches()

        if old_path:
            self.emit(Base.Event.PROJECT_UNLOADED, {"path": old_path})

    def is_loaded(self) -> bool:
        with self.state_lock:
            return self.session.db is not None and self.session.lg_path is not None

    def get_lg_path(self) -> str | None:
        with self.state_lock:
            return self.session.lg_path

    def open_db(self) -> None:
        """打开长连接（翻译期间用，提升高频写入性能）。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return
            db.open()

    def close_db(self) -> None:
        """关闭长连接（触发 WAL checkpoint 清理）。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return
            db.close()

    def on_translation_activity(self, event: Base.Event, data: dict) -> None:
        # 翻译过程中 items 会频繁写入 DB；items 缓存不追实时，统一失效更安全。
        self.item_service.clear_item_cache()

    # ===================== meta =====================

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.meta_service.get_meta(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        self.meta_service.set_meta(key, value)
        if key in RULE_META_KEYS:
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

    def get_rules_cached(self, rule_type: LGDatabase.RuleType) -> list[dict[str, Any]]:
        return self.rule_service.get_rules_cached(rule_type)

    def set_rules_cached(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        self.rule_service.set_rules_cached(rule_type, data, save)
        if save:
            self.emit_quality_rule_update(rule_types=[rule_type])

    def get_rule_text_cached(self, rule_type: LGDatabase.RuleType) -> str:
        return self.rule_service.get_rule_text_cached(rule_type)

    def set_rule_text_cached(self, rule_type: LGDatabase.RuleType, text: str) -> None:
        self.rule_service.set_rule_text_cached(rule_type, text)
        self.emit_quality_rule_update(rule_types=[rule_type])

    def emit_quality_rule_update(
        self,
        rule_types: list[LGDatabase.RuleType] | None = None,
        meta_keys: list[str] | None = None,
    ) -> None:
        payload: dict[str, Any] = {}
        if rule_types:
            payload["rule_types"] = [rule_type.value for rule_type in rule_types]
        if meta_keys:
            payload["meta_keys"] = meta_keys
        self.emit(Base.Event.QUALITY_RULE_UPDATE, payload)

    def get_glossary(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.GLOSSARY)

    def set_glossary(self, data: list[dict[str, Any]], save: bool = True) -> None:
        self.set_rules_cached(LGDatabase.RuleType.GLOSSARY, data, save)

    def get_glossary_enable(self) -> bool:
        return bool(self.get_meta("glossary_enable", True))

    def set_glossary_enable(self, enable: bool) -> None:
        self.set_meta("glossary_enable", bool(enable))

    def get_text_preserve(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.TEXT_PRESERVE)

    def set_text_preserve(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(LGDatabase.RuleType.TEXT_PRESERVE, data, True)

    def get_text_preserve_mode(self) -> TextPreserveMode:
        raw = self.get_meta("text_preserve_mode", None)
        if isinstance(raw, str):
            try:
                return __class__.TextPreserveMode(raw)
            except Exception:
                pass

        # 兼容旧工程：
        # - True -> custom
        # - False -> smart
        # 旧工程默认语义：未显式开启自定义规则时，使用内置智能规则（SMART）。
        legacy = self.get_meta("text_preserve_enable", False)
        return (
            __class__.TextPreserveMode.CUSTOM
            if bool(legacy)
            else __class__.TextPreserveMode.SMART
        )

    def set_text_preserve_mode(self, mode: TextPreserveMode | str) -> None:
        try:
            normalized = (
                mode
                if isinstance(mode, __class__.TextPreserveMode)
                else __class__.TextPreserveMode(str(mode))
            )
        except Exception:
            normalized = __class__.TextPreserveMode.OFF

        # 新语义的唯一权威来源
        self.set_meta("text_preserve_mode", normalized.value)

        # 写入旧键用于兼容与避免默认值误判。
        # 注意：旧布尔无法表达 OFF，这里将 OFF 映射为 False。
        legacy_enable = normalized == __class__.TextPreserveMode.CUSTOM
        self.set_meta("text_preserve_enable", legacy_enable)

    def get_text_preserve_enable(self) -> bool:
        # 兼容旧接口：仅表示“是否使用自定义规则”。
        return self.get_text_preserve_mode() == __class__.TextPreserveMode.CUSTOM

    def set_text_preserve_enable(self, enable: bool) -> None:
        # 兼容旧接口：False 映射为 SMART（与历史一致）。
        self.set_text_preserve_mode(
            __class__.TextPreserveMode.CUSTOM
            if enable
            else __class__.TextPreserveMode.SMART
        )

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.PRE_REPLACEMENT)

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(LGDatabase.RuleType.PRE_REPLACEMENT, data, True)

    def get_pre_replacement_enable(self) -> bool:
        return bool(self.get_meta("pre_translation_replacement_enable", True))

    def set_pre_replacement_enable(self, enable: bool) -> None:
        self.set_meta("pre_translation_replacement_enable", bool(enable))

    def get_post_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.POST_REPLACEMENT)

    def set_post_replacement(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(LGDatabase.RuleType.POST_REPLACEMENT, data, True)

    def get_post_replacement_enable(self) -> bool:
        return bool(self.get_meta("post_translation_replacement_enable", True))

    def set_post_replacement_enable(self, enable: bool) -> None:
        self.set_meta("post_translation_replacement_enable", bool(enable))

    def get_custom_prompt_zh(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH)

    def set_custom_prompt_zh(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, text)

    def get_custom_prompt_zh_enable(self) -> bool:
        return bool(self.get_meta("custom_prompt_zh_enable", False))

    def set_custom_prompt_zh_enable(self, enable: bool) -> None:
        self.set_meta("custom_prompt_zh_enable", bool(enable))

    def get_custom_prompt_en(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_EN)

    def set_custom_prompt_en(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_EN, text)

    def get_custom_prompt_en_enable(self) -> bool:
        return bool(self.get_meta("custom_prompt_en_enable", False))

    def set_custom_prompt_en_enable(self, enable: bool) -> None:
        self.set_meta("custom_prompt_en_enable", bool(enable))

    # ===================== items =====================

    def clear_item_cache(self) -> None:
        self.item_service.clear_item_cache()

    def get_all_items(self) -> list[Item]:
        return self.item_service.get_all_items()

    def save_item(self, item: Item) -> int:
        return self.item_service.save_item(item)

    def replace_all_items(self, items: list[Item]) -> list[int]:
        return self.item_service.replace_all_items(items)

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[LGDatabase.RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self.batch_service.update_batch(items=items, rules=rules, meta=meta)

        if rules:
            self.emit_quality_rule_update(rule_types=list(rules.keys()))
        if meta:
            keys = [k for k in meta.keys() if k in RULE_META_KEYS]
            if keys:
                self.emit_quality_rule_update(meta_keys=keys)

    def get_items_for_translation(
        self,
        config: Config,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        return self.translation_item_service.get_items_for_translation(config, mode)

    # ===================== assets =====================

    def get_all_asset_paths(self) -> list[str]:
        return self.asset_service.get_all_asset_paths()

    def get_asset(self, rel_path: str) -> bytes | None:
        return self.asset_service.get_asset(rel_path)

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        return self.asset_service.get_asset_decompressed(rel_path)

    # ===================== export path =====================

    def timestamp_suffix_context(self) -> AbstractContextManager[None]:
        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return self.export_path_service.timestamp_suffix_context(lg_path)

    def export_custom_suffix_context(self, suffix: str) -> AbstractContextManager[None]:
        return self.export_path_service.custom_suffix_context(suffix)

    def get_translated_path(self) -> str:
        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return self.export_path_service.get_translated_path(lg_path)

    def get_bilingual_path(self) -> str:
        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return self.export_path_service.get_bilingual_path(lg_path)

    # ===================== project =====================

    def get_supported_extensions(self) -> set[str]:
        return set(self.project_service.SUPPORTED_EXTENSIONS)

    def collect_source_files(self, source_path: str) -> list[str]:
        return self.project_service.collect_source_files(source_path)

    def create_project(
        self,
        source_path: str,
        output_path: str,
        progress_callback: Any | None = None,
    ) -> None:
        old_callback = self.project_service.progress_callback
        self.project_service.set_progress_callback(progress_callback)
        try:
            loaded_presets = self.project_service.create(
                source_path,
                output_path,
                init_rules=self.rule_service.initialize_project_rules,
            )
        finally:
            self.project_service.set_progress_callback(old_callback)

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

    def get_project_preview(self, lg_path: str) -> dict:
        return self.project_service.get_project_preview(lg_path)
