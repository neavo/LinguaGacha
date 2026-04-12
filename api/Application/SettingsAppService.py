from collections.abc import Callable
from typing import Any

from base.Base import Base
from module.Config import Config


class SettingsAppService:
    """应用设置用例层，统一收口设置快照读取与局部更新。"""

    SETTING_KEYS: tuple[str, ...] = (
        "theme",
        "app_language",
        "expert_mode",
        "proxy_url",
        "proxy_enable",
        "scale_factor",
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
        "force_thinking_enable",
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
    ) -> None:
        self.config_loader = (
            config_loader if config_loader is not None else self.default_config_loader
        )
        self.event_emitter = (
            event_emitter if event_emitter is not None else self.default_emit
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

            if key == "expert_mode":
                config.reset_expert_settings()
                setattr(config, key, bool(value))
            elif key in (
                "proxy_enable",
                "output_folder_open_on_finish",
                "mtool_optimizer_enable",
                "force_thinking_enable",
            ):
                setattr(config, key, bool(value))
            elif key == "request_timeout":
                setattr(config, key, int(value or 0))
            elif key == "preceding_lines_threshold":
                setattr(config, key, int(value or 0))
            else:
                setattr(config, key, value)
            changed_keys.append(key)

        if changed_keys:
            config.save()
            self.event_emitter(Base.Event.CONFIG_UPDATED, {"keys": changed_keys})

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
            config.save()
            self.event_emitter(Base.Event.CONFIG_UPDATED, {"keys": ["recent_projects"]})
        return {"settings": self.build_settings_snapshot(config)}

    def remove_recent_project(self, request: dict[str, Any]) -> dict[str, object]:
        """统一从配置侧移除最近项目，避免页面自己改列表。"""

        config = self.load_config()
        path = str(request.get("path", ""))
        if path:
            config.remove_recent_project(path)
            config.save()
            self.event_emitter(Base.Event.CONFIG_UPDATED, {"keys": ["recent_projects"]})
        return {"settings": self.build_settings_snapshot(config)}

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

    def default_emit(self, event: Base.Event, data: dict[str, object]) -> None:
        """默认把设置更新继续发回现有事件总线。"""

        Base().emit(event, data)
