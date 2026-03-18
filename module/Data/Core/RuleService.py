from typing import Any

from base.BasePath import BasePath
from base.LogManager import LogManager
from module.Config import Config
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Core.ProjectSession import ProjectSession
from module.Localizer.Localizer import Localizer
from module.PromptPathResolver import PromptPathResolver
from module.QualityRulePathResolver import QualityRulePathResolver


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
        db.set_meta("text_preserve_mode", "smart")

        def load_quality_rule_preset(
            preset_dir_name: str,
            virtual_id: str,
        ) -> list[dict[str, Any]] | None:
            try:
                data = QualityRulePathResolver.read_preset(preset_dir_name, virtual_id)
                if not isinstance(data, list):
                    return None
                return [entry for entry in data if isinstance(entry, dict)]
            except Exception as e:
                LogManager.get().error(
                    f"Failed to load quality preset: {preset_dir_name} -> {virtual_id}",
                    e,
                )
                return None

        default_rule_specs = [
            (
                BasePath.GLOSSARY_DIR_NAME,
                config.glossary_default_preset,
                LGDatabase.RuleType.GLOSSARY,
                "glossary_enable",
                Localizer.get().app_glossary_page,
            ),
            (
                BasePath.TEXT_PRESERVE_DIR_NAME,
                config.text_preserve_default_preset,
                LGDatabase.RuleType.TEXT_PRESERVE,
                "text_preserve_mode",
                Localizer.get().app_text_preserve_page,
            ),
            (
                BasePath.PRE_TRANSLATION_REPLACEMENT_DIR_NAME,
                config.pre_translation_replacement_default_preset,
                LGDatabase.RuleType.PRE_REPLACEMENT,
                "pre_translation_replacement_enable",
                Localizer.get().app_pre_translation_replacement_page,
            ),
            (
                BasePath.POST_TRANSLATION_REPLACEMENT_DIR_NAME,
                config.post_translation_replacement_default_preset,
                LGDatabase.RuleType.POST_REPLACEMENT,
                "post_translation_replacement_enable",
                Localizer.get().app_post_translation_replacement_page,
            ),
        ]

        for (
            preset_dir_name,
            virtual_id,
            rule_type,
            meta_key,
            page_name,
        ) in default_rule_specs:
            if not virtual_id:
                continue

            data = load_quality_rule_preset(preset_dir_name, virtual_id)
            if data is None:
                continue

            db.set_rules(rule_type, data)
            if meta_key == "text_preserve_mode":
                db.set_meta(meta_key, "custom")
            else:
                db.set_meta(meta_key, True)
            loaded_presets.append(page_name)

        prompt_defaults = [
            (
                PromptPathResolver.TaskType.TRANSLATION,
                config.translation_custom_prompt_default_preset,
                LGDatabase.RuleType.TRANSLATION_PROMPT,
                "translation_prompt_enable",
                Localizer.get().app_translation_prompt_page,
            ),
            (
                PromptPathResolver.TaskType.ANALYSIS,
                config.analysis_custom_prompt_default_preset,
                LGDatabase.RuleType.ANALYSIS_PROMPT,
                "analysis_prompt_enable",
                Localizer.get().app_analysis_prompt_page,
            ),
        ]

        for task_type, virtual_id, rule_type, meta_key, page_name in prompt_defaults:
            if not virtual_id:
                continue

            try:
                text = PromptPathResolver.get_default_preset_text(task_type, virtual_id)
                db.set_rule_text(rule_type, text)
                db.set_meta(meta_key, True)
                loaded_presets.append(page_name)
            except Exception as e:
                LogManager.get().error(
                    f"Failed to load default prompt preset: task={task_type.value} preset={virtual_id}",
                    e,
                )

        return loaded_presets
