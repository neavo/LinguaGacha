import os
import json
import threading
from typing import Self

from base.BaseData import BaseData
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer

class Config(BaseData):

    # 路径
    CONFIG_PATH = "./resource/config.json"

    # 配置锁
    CONFIG_LOCK = threading.Lock()

    def __init__(self) -> None:
        super().__init__()

        # Application
        self.theme: str = "light"
        self.app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH

        # PlatformPage
        self.activate_platform: int = 0
        self.platforms: list[dict] = None

        # AppSettingsPage
        self.expert_mode: bool = False
        self.proxy_url: str = ""
        self.proxy_enable: bool = False
        self.font_hinting: bool = True
        self.scale_factor: str = ""

        # BasicSettingsPage
        self.token_threshold: int = 384
        self.max_workers: int = 0
        self.rpm_threshold: int = 0
        self.request_timeout: int = 120
        self.max_round: int = 16

        # ExpertSettingsPage
        self.preceding_lines_threshold: int = 3
        self.enable_preceding_on_local: bool = False
        self.deduplication_in_bilingual: bool = True
        self.result_checker_retry_count_threshold: bool = False

        # ProjectPage
        self.source_language: BaseLanguage.Enum = BaseLanguage.Enum.JA
        self.target_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
        self.input_folder: str = "./input"
        self.output_folder: str = "./output"
        self.traditional_chinese_enable: bool = False

        # GlossaryPage
        self.glossary_enable: bool = True
        self.glossary_data: list = []

        # TextPreservePage
        self.text_preserve_enable: bool = False
        self.text_preserve_data: list = []

        # PreTranslationReplacementPage
        self.pre_translation_replacement_enable: bool = True
        self.pre_translation_replacement_data: list = []

        # PostTranslationReplacementPage
        self.post_translation_replacement_enable: bool = True
        self.post_translation_replacement_data: list = []

        # CustomPromptZHPage
        self.custom_prompt_zh_enable: bool = False
        self.custom_prompt_zh_data: str = None

        # CustomPromptENPage
        self.custom_prompt_en_enable: bool = False
        self.custom_prompt_en_data: str = None

        # LaboratoryPage
        self.auto_glossary_enable: bool = False
        self.mtool_optimizer_enable: bool = False

    def load(self) -> Self:
        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(__class__.CONFIG_PATH), exist_ok = True)
                if os.path.isfile(__class__.CONFIG_PATH):
                    with open(__class__.CONFIG_PATH, "r", encoding = "utf-8-sig") as reader:
                        config: dict = json.load(reader)
                        for k, v in config.items():
                            if hasattr(self, k):
                                setattr(self, k, v)
            except Exception as e:
                LogManager.error(f"{Localizer.get().log_read_file_fail}", e)

        return self

    def save(self) -> Self:
        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(__class__.CONFIG_PATH), exist_ok = True)
                with open(__class__.CONFIG_PATH, "w", encoding = "utf-8") as writer:
                    json.dump(self.get_vars(), writer, indent = 4, ensure_ascii = False)
            except Exception as e:
                LogManager.error(f"{Localizer.get().log_write_file_fail}", e)

        return self

    # 重置专家模式
    def reset_expert_settings(self) -> None:
        # ExpertSettingsPage
        self.preceding_lines_threshold: int = 3
        self.enable_preceding_on_local: bool = True
        self.deduplication_in_bilingual: bool = True
        self.result_checker_retry_count_threshold: bool = False

        # TextPreservePage
        self.text_preserve_enable: bool = False
        self.text_preserve_data: list = []

    # 获取平台配置
    def get_platform(self, id: int) -> dict[str, str | bool | int | float | list[str]]:
        item: dict[str, str | bool | int | float | list[str]] = None
        for item in self.platforms:
            if item.get("id", 0) == id:
                return item

    # 更新平台配置
    def set_platform(self, platform: dict) -> None:
        for i, item in enumerate(self.platforms):
            if item.get("id", 0) == platform.get("id", 0):
                self.platforms[i] = platform
                break