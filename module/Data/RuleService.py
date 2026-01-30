import json
import os
from typing import Any

from base.LogManager import LogManager
from module.Config import Config
from module.Data.LGDatabase import LGDatabase
from module.Data.ProjectSession import ProjectSession
from module.Localizer.Localizer import Localizer


class RuleService:
    """质量规则（rules 表）访问与缓存。"""

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

    def get_rules_cached(self, rule_type: LGDatabase.RuleType) -> list[dict[str, Any]]:
        with self.session.state_lock:
            cached = self.session.rule_cache.get(rule_type)
            if isinstance(cached, list):
                return list(cached)

            db = self.session.db
            if db is None:
                return []

            data = db.get_rules(rule_type)
            self.session.rule_cache[rule_type] = data
            return list(data)

    def set_rules_cached(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        if save:
            with self.session.state_lock:
                db = self.session.db
                if db is not None:
                    db.set_rules(rule_type, data)

        with self.session.state_lock:
            self.session.rule_cache[rule_type] = data
            # rules 变更后，文本类缓存可能与存储形态不一致，直接失效
            self.session.rule_text_cache.pop(rule_type, None)

    def get_rule_text_cached(self, rule_type: LGDatabase.RuleType) -> str:
        with self.session.state_lock:
            cached = self.session.rule_text_cache.get(rule_type)
            if isinstance(cached, str):
                return cached

            db = self.session.db
            if db is None:
                return ""

            text = db.get_rule_text(rule_type)
            self.session.rule_text_cache[rule_type] = text
            return text

    def set_rule_text_cached(self, rule_type: LGDatabase.RuleType, text: str) -> None:
        with self.session.state_lock:
            db = self.session.db
            if db is not None:
                db.set_rule_text(rule_type, text)
            self.session.rule_text_cache[rule_type] = text
            # 文本类规则与列表类规则互斥，清理另一份缓存避免脏读
            self.session.rule_cache.pop(rule_type, None)

    def initialize_project_rules(self, db: LGDatabase) -> list[str]:
        """创建新工程时的规则初始化。

        返回加载成功的预设名称列表，由调用方决定是否提示 UI。
        """
        config = Config().load()
        loaded_presets: list[str] = []

        # 新工程默认使用智能文本保护（SMART）。
        # 兼容旧布尔键：同时写入 text_preserve_enable=False，避免默认值误判。
        db.set_meta("text_preserve_mode", "smart")
        db.set_meta("text_preserve_enable", False)

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
                db.set_rules(LGDatabase.RuleType.GLOSSARY, data)
                db.set_meta("glossary_enable", True)
                loaded_presets.append(Localizer.get().app_glossary_page)

        # 2. 文本保护
        if config.text_preserve_default_preset and os.path.exists(
            config.text_preserve_default_preset
        ):
            data = load_json(config.text_preserve_default_preset)
            if data is not None:
                db.set_rules(LGDatabase.RuleType.TEXT_PRESERVE, data)
                loaded_presets.append(Localizer.get().app_text_preserve_page)

        # 3. 译前替换
        if config.pre_translation_replacement_default_preset and os.path.exists(
            config.pre_translation_replacement_default_preset
        ):
            data = load_json(config.pre_translation_replacement_default_preset)
            if data is not None:
                db.set_rules(LGDatabase.RuleType.PRE_REPLACEMENT, data)
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
                db.set_rules(LGDatabase.RuleType.POST_REPLACEMENT, data)
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
                db.set_rule_text(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, text)
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
                db.set_rule_text(LGDatabase.RuleType.CUSTOM_PROMPT_EN, text)
                db.set_meta("custom_prompt_en_enable", True)
                loaded_presets.append(Localizer.get().app_custom_prompt_en_page)
            except Exception as e:
                LogManager.get().error(
                    f"Failed to load default custom prompt (EN) preset: {config.custom_prompt_en_default_preset}",
                    e,
                )

        return loaded_presets
