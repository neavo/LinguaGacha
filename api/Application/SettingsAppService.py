from collections.abc import Callable
from typing import Any

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Model.Manager import ModelManager


class SettingsAppService:
    """应用设置用例层，统一收口设置快照读取与局部更新。"""

    SUPPORTED_APP_LANGUAGES: tuple[BaseLanguage.Enum, ...] = (
        BaseLanguage.Enum.ZH,
        BaseLanguage.Enum.EN,
    )

    SETTING_KEYS: tuple[str, ...] = (
        "app_language",
        "source_language",
        "target_language",
        "project_save_mode",
        "project_fixed_path",
        "output_folder_open_on_finish",
        "request_timeout",
        "preceding_lines_threshold",
        "clean_ruby",
        "deduplication_in_trans",
        "deduplication_in_bilingual",
        "check_kana_residue",
        "check_hangeul_residue",
        "check_similarity",
        "write_translated_name_fields_to_file",
        "auto_process_prefix_suffix_preserved_text",
        "mtool_optimizer_enable",
        "glossary_default_preset",
        "text_preserve_default_preset",
        "pre_translation_replacement_default_preset",
        "post_translation_replacement_default_preset",
        "translation_custom_prompt_default_preset",
        "analysis_custom_prompt_default_preset",
        "recent_projects",
    )

    def __init__(
        self,
        config_loader: Callable[[], Config] | None = None,
        event_emitter: Any | None = None,
        localizer_language_setter: Callable[[BaseLanguage.Enum], None] | None = None,
        model_language_setter: Callable[[BaseLanguage.Enum], None] | None = None,
    ) -> None:
        self.config_loader = (
            config_loader if config_loader is not None else self.default_config_loader
        )
        self.event_emitter = (
            event_emitter if event_emitter is not None else self.default_emit
        )
        self.localizer_language_setter = (
            localizer_language_setter
            if localizer_language_setter is not None
            else Localizer.set_app_language
        )
        self.model_language_setter = (
            model_language_setter
            if model_language_setter is not None
            else self.default_set_model_language
        )

    def get_app_settings(self, request: dict[str, Any]) -> dict[str, object]:
        """读取应用设置快照，供页面首屏 hydration 使用。"""

        del request
        config = self.load_config(persist_defaults=True)
        return {"settings": self.build_settings_snapshot(config)}

    def update_app_settings(self, request: dict[str, Any]) -> dict[str, object]:
        """按显式字段更新配置，并返回最新快照。"""

        config = self.load_config()
        changed_keys: list[str] = []

        for key, value in request.items():
            if key not in self.SETTING_KEYS:
                continue

            if key in (
                "output_folder_open_on_finish",
                "mtool_optimizer_enable",
            ):
                setattr(config, key, bool(value))
            elif key == "app_language":
                setattr(config, key, self.normalize_app_language(value))
            elif key == "request_timeout":
                setattr(config, key, int(value or 0))
            elif key == "preceding_lines_threshold":
                setattr(config, key, int(value or 0))
            else:
                setattr(config, key, value)
            changed_keys.append(key)

        if changed_keys:
            config.save(raise_on_error=True)
            self.apply_runtime_settings(config, changed_keys)
            settings_snapshot = self.build_settings_snapshot(config)
            self.event_emitter(
                Base.Event.CONFIG_UPDATED,
                {
                    "keys": changed_keys,
                    "settings": settings_snapshot,
                },
            )
            return {"settings": settings_snapshot}

        return {"settings": self.build_settings_snapshot(config)}

    def build_settings_snapshot(self, config: Config) -> dict[str, object]:
        """把配置对象裁剪成页面稳定依赖的 JSON 快照。"""

        return {key: getattr(config, key) for key in self.SETTING_KEYS}

    def add_recent_project(self, request: dict[str, Any]) -> dict[str, object]:
        """把最近项目的去重与截断逻辑继续留在 Core 侧。"""

        config = self.load_config()
        path = str(request.get("path", ""))
        name = str(request.get("name", ""))
        if path:
            config.add_recent_project(path, name)
            config.save(raise_on_error=True)
            settings_snapshot = self.build_settings_snapshot(config)
            self.event_emitter(
                Base.Event.CONFIG_UPDATED,
                {
                    "keys": ["recent_projects"],
                    "settings": settings_snapshot,
                },
            )
            return {"settings": settings_snapshot}
        return {"settings": self.build_settings_snapshot(config)}

    def remove_recent_project(self, request: dict[str, Any]) -> dict[str, object]:
        """统一从配置侧移除最近项目，避免页面自己改列表。"""

        config = self.load_config()
        path = str(request.get("path", ""))
        if path:
            config.remove_recent_project(path)
            config.save(raise_on_error=True)
            settings_snapshot = self.build_settings_snapshot(config)
            self.event_emitter(
                Base.Event.CONFIG_UPDATED,
                {
                    "keys": ["recent_projects"],
                    "settings": settings_snapshot,
                },
            )
            return {"settings": settings_snapshot}
        return {"settings": self.build_settings_snapshot(config)}

    def normalize_app_language(self, value: object) -> BaseLanguage.Enum:
        """应用语言只允许落到当前已接入 UI 资源的稳定集合。"""

        normalized_value = str(value).strip().upper()
        try:
            normalized_language = BaseLanguage.Enum(normalized_value)
        except ValueError as e:
            raise ValueError("应用语言只支持 ZH 或 EN。") from e

        if normalized_language not in self.SUPPORTED_APP_LANGUAGES:
            raise ValueError("应用语言只支持 ZH 或 EN。")

        return normalized_language

    def apply_runtime_settings(
        self,
        config: Config,
        changed_keys: list[str],
    ) -> None:
        """设置写入成功后立即同步运行时依赖，避免界面与 Core 脱节。"""

        if "app_language" not in changed_keys:
            return

        app_language = self.normalize_app_language(config.app_language)
        config.app_language = app_language
        self.localizer_language_setter(app_language)
        self.model_language_setter(app_language)

    def load_config(self, persist_defaults: bool = False) -> Config:
        """统一加载并持久化默认配置，避免页面自己分散做初始化。"""

        config = self.config_loader()
        config.load()
        if persist_defaults:
            config.save()
        return config

    def default_config_loader(self) -> Config:
        """默认从真实配置单例创建读取对象。"""

        return Config()

    def default_set_model_language(self, language: BaseLanguage.Enum) -> None:
        """默认把应用语言同步给模型管理器，保持预设目录解析一致。"""

        ModelManager.get().set_app_language(language)

    def default_emit(self, event: Base.Event, data: dict[str, object]) -> None:
        """默认把设置更新继续发回现有事件总线。"""

        Base().emit(event, data)
