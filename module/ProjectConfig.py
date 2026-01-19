"""项目级别配置

存储在 .lg 文件内部，与特定翻译项目相关：
- 原文/译文语言
- 翻译引擎（模型 ID）
- 术语表、替换规则
- 自定义提示词
"""

import dataclasses
from typing import Any

from base.BaseLanguage import BaseLanguage
from module.Storage.LGDatabase import LGDatabase

@dataclasses.dataclass
class ProjectConfig:
    """项目级别配置"""

    # 基础设置
    source_language: BaseLanguage.Enum = BaseLanguage.Enum.JA
    target_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
    traditional_chinese_enable: bool = False

    # 翻译引擎（存储模型 ID，实际模型配置在 AppConfig 中）
    activate_model_id: str = ""

    # 输出设置
    output_folder: str = ""
    output_folder_open_on_finish: bool = False

    # 专家设置
    preceding_lines_threshold: int = 0
    enable_preceding_on_local: bool = False
    clean_ruby: bool = False
    deduplication_in_trans: bool = True
    deduplication_in_bilingual: bool = True
    write_translated_name_fields_to_file: bool = True
    auto_process_prefix_suffix_preserved_text: bool = True

    # 规则开关
    glossary_enable: bool = True
    text_preserve_enable: bool = False
    pre_translation_replacement_enable: bool = True
    post_translation_replacement_enable: bool = True
    custom_prompt_zh_enable: bool = False
    custom_prompt_en_enable: bool = False

    # 实验室功能
    auto_glossary_enable: bool = False
    mtool_optimizer_enable: bool = False

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProjectConfig":
        """从字典创建"""
        class_fields = {f.name for f in dataclasses.fields(cls)}
        filtered_data = {k: v for k, v in data.items() if k in class_fields}
        return cls(**filtered_data)

    def save_to_db(self, db: LGDatabase) -> None:
        """保存到数据库"""
        for key, value in self.to_dict().items():
            db.set_meta(f"config.{key}", value)

    @classmethod
    def load_from_db(cls, db: LGDatabase) -> "ProjectConfig":
        """从数据库加载"""
        config = cls()
        all_meta = db.get_all_meta()

        for field in dataclasses.fields(cls):
            key = f"config.{field.name}"
            if key in all_meta:
                setattr(config, field.name, all_meta[key])

        return config
