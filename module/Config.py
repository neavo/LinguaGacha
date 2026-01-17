import dataclasses
import json
import os
import threading
from enum import StrEnum
from typing import Any
from typing import ClassVar
from typing import Self

from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer

@dataclasses.dataclass
class Config():

    class Theme(StrEnum):

        DARK = "DARK"
        LIGHT = "LIGHT"

    # Application
    theme: str = Theme.LIGHT
    app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH

    # PlatformPage
    activate_platform: int = 0
    platforms: list[dict[str, Any]] = None

    # AppSettingsPage
    expert_mode: bool = False
    proxy_url: str = ""
    proxy_enable: bool = False
    font_hinting: bool = True
    scale_factor: str = ""

    # BasicSettingsPage
    input_token_threshold: int = 384
    output_token_threshold: int = 4096
    max_workers: int = 0
    rpm_threshold: int = 0
    request_timeout: int = 120
    max_round: int = 16

    # ExpertSettingsPage
    preceding_lines_threshold: int = 0
    enable_preceding_on_local: bool = False
    clean_ruby: bool = False
    deduplication_in_trans: bool = True
    deduplication_in_bilingual: bool = True
    write_translated_name_fields_to_file: bool = True
    auto_process_prefix_suffix_preserved_text: bool = True

    # ProjectPage
    source_language: BaseLanguage.Enum = BaseLanguage.Enum.JA
    target_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
    input_folder: str = "./input"
    output_folder: str = "./output"
    output_folder_open_on_finish: bool = False
    traditional_chinese_enable: bool = False

    # GlossaryPage
    glossary_enable: bool = True
    glossary_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # TextPreservePage
    text_preserve_enable: bool = False
    text_preserve_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # PreTranslationReplacementPage
    pre_translation_replacement_enable: bool = True
    pre_translation_replacement_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # PostTranslationReplacementPage
    post_translation_replacement_enable: bool = True
    post_translation_replacement_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # CustomPromptZHPage
    custom_prompt_zh_enable: bool = False
    custom_prompt_zh_data: str = None

    # CustomPromptENPage
    custom_prompt_en_enable: bool = False
    custom_prompt_en_data: str = None

    # LaboratoryPage
    auto_glossary_enable: bool = False
    mtool_optimizer_enable: bool = False

    # 类属性
    CONFIG_LOCK: ClassVar[threading.Lock] = threading.Lock()

    @staticmethod
    def get_config_path() -> str:
        """根据环境获取配置文件路径。"""
        data_dir = os.environ.get("LINGUAGACHA_DATA_DIR")
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR")
        # 便携式环境（AppImage, macOS .app）使用 data_dir/config.json
        if data_dir and app_dir and data_dir != app_dir:
            return os.path.join(data_dir, "config.json")
        # 默认：使用应用目录下的 resource/config.json
        return os.path.join(app_dir or ".", "resource", "config.json")

    def load(self, path: str = None) -> Self:
        if path is None:
            path = __class__.get_config_path()

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok = True)
                if os.path.isfile(path):
                    with open(path, "r", encoding = "utf-8-sig") as reader:
                        config: dict = json.load(reader)
                        for k, v in config.items():
                            if hasattr(self, k):
                                setattr(self, k, v)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_read_file_fail}", e)

        # 便携式环境下调整默认路径
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR", ".")
        data_dir = os.environ.get("LINGUAGACHA_DATA_DIR", ".")
        if data_dir != app_dir:
            # 便携式环境中，将默认相对路径解析到 data_dir
            if self.input_folder == "./input":
                self.input_folder = os.path.join(data_dir, "input")
            if self.output_folder == "./output":
                self.output_folder = os.path.join(data_dir, "output")

        return self

    def save(self, path: str = None) -> Self:
        if path is None:
            path = __class__.get_config_path()

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok = True)
                with open(path, "w", encoding = "utf-8") as writer:
                    json.dump(dataclasses.asdict(self), writer, indent = 4, ensure_ascii = False)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_write_file_fail}", e)

        return self

    # 重置专家模式
    def reset_expert_settings(self) -> None:
        # ExpertSettingsPage
        self.preceding_lines_threshold: int = 0
        self.enable_preceding_on_local: bool = False
        self.clean_ruby: bool = True
        self.deduplication_in_trans: bool = True
        self.deduplication_in_bilingual: bool = True
        self.write_translated_name_fields_to_file: bool = True
        self.auto_process_prefix_suffix_preserved_text: bool = True

        # TextPreservePage
        self.text_preserve_enable: bool = False
        self.text_preserve_data: list[Any] = []

    # 获取平台配置
    def get_platform(self, id: int) -> dict[str, Any]:
        item: dict[str, str | bool | int | float | list[str]] = None
        for item in self.platforms:
            if item.get("id", 0) == id:
                return item

    # 更新平台配置
    def set_platform(self, platform: dict[str, Any]) -> None:
        for i, item in enumerate(self.platforms):
            if item.get("id", 0) == platform.get("id", 0):
                self.platforms[i] = platform
                break
