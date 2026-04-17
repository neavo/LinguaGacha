from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RecentProjectEntry:
    """最近工程条目在客户端内冻结，避免页面继续传递可变字典。"""

    path: str
    name: str

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "RecentProjectEntry":
        """把服务端条目统一归一化为稳定字段。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            path=str(normalized.get("path", "")),
            name=str(normalized.get("name", "")),
        )

    def to_dict(self) -> dict[str, str]:
        """把冻结条目回写为 JSON 结构，供边界层复用。"""

        return {
            "path": self.path,
            "name": self.name,
        }


@dataclass(frozen=True)
class AppSettingsSnapshot:
    """应用设置快照统一收口页面依赖的设置字段。"""

    theme: str = "LIGHT"
    app_language: str = "ZH"
    expert_mode: bool = False
    proxy_url: str = ""
    proxy_enable: bool = False
    scale_factor: str = ""
    source_language: str = "JA"
    target_language: str = "ZH"
    project_save_mode: str = "MANUAL"
    project_fixed_path: str = ""
    output_folder_open_on_finish: bool = False
    request_timeout: int = 120
    preceding_lines_threshold: int = 0
    clean_ruby: bool = False
    deduplication_in_trans: bool = True
    deduplication_in_bilingual: bool = True
    check_kana_residue: bool = True
    check_hangeul_residue: bool = True
    check_similarity: bool = True
    write_translated_name_fields_to_file: bool = True
    auto_process_prefix_suffix_preserved_text: bool = True
    mtool_optimizer_enable: bool = False
    force_thinking_enable: bool = True
    glossary_default_preset: str = ""
    text_preserve_default_preset: str = ""
    pre_translation_replacement_default_preset: str = ""
    post_translation_replacement_default_preset: str = ""
    translation_custom_prompt_default_preset: str = ""
    analysis_custom_prompt_default_preset: str = ""
    recent_projects: tuple[RecentProjectEntry, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "AppSettingsSnapshot":
        """把 HTTP 设置快照收敛为带默认值的冻结对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        recent_projects_raw = normalized.get("recent_projects", [])
        recent_projects: tuple[RecentProjectEntry, ...] = ()
        if isinstance(recent_projects_raw, list):
            recent_projects = tuple(
                RecentProjectEntry.from_dict(project)
                for project in recent_projects_raw
                if isinstance(project, dict)
            )

        return cls(
            theme=str(normalized.get("theme", "LIGHT")),
            app_language=str(normalized.get("app_language", "ZH")),
            expert_mode=bool(normalized.get("expert_mode", False)),
            proxy_url=str(normalized.get("proxy_url", "")),
            proxy_enable=bool(normalized.get("proxy_enable", False)),
            scale_factor=str(normalized.get("scale_factor", "")),
            source_language=str(normalized.get("source_language", "JA")),
            target_language=str(normalized.get("target_language", "ZH")),
            project_save_mode=str(normalized.get("project_save_mode", "MANUAL")),
            project_fixed_path=str(normalized.get("project_fixed_path", "")),
            output_folder_open_on_finish=bool(
                normalized.get("output_folder_open_on_finish", False)
            ),
            request_timeout=int(normalized.get("request_timeout", 120) or 120),
            preceding_lines_threshold=int(
                normalized.get("preceding_lines_threshold", 0) or 0
            ),
            clean_ruby=bool(normalized.get("clean_ruby", False)),
            deduplication_in_trans=bool(normalized.get("deduplication_in_trans", True)),
            deduplication_in_bilingual=bool(
                normalized.get("deduplication_in_bilingual", True)
            ),
            check_kana_residue=bool(normalized.get("check_kana_residue", True)),
            check_hangeul_residue=bool(normalized.get("check_hangeul_residue", True)),
            check_similarity=bool(normalized.get("check_similarity", True)),
            write_translated_name_fields_to_file=bool(
                normalized.get("write_translated_name_fields_to_file", True)
            ),
            auto_process_prefix_suffix_preserved_text=bool(
                normalized.get("auto_process_prefix_suffix_preserved_text", True)
            ),
            mtool_optimizer_enable=bool(
                normalized.get("mtool_optimizer_enable", False)
            ),
            force_thinking_enable=bool(normalized.get("force_thinking_enable", True)),
            glossary_default_preset=str(normalized.get("glossary_default_preset", "")),
            text_preserve_default_preset=str(
                normalized.get("text_preserve_default_preset", "")
            ),
            pre_translation_replacement_default_preset=str(
                normalized.get("pre_translation_replacement_default_preset", "")
            ),
            post_translation_replacement_default_preset=str(
                normalized.get("post_translation_replacement_default_preset", "")
            ),
            translation_custom_prompt_default_preset=str(
                normalized.get("translation_custom_prompt_default_preset", "")
            ),
            analysis_custom_prompt_default_preset=str(
                normalized.get("analysis_custom_prompt_default_preset", "")
            ),
            recent_projects=recent_projects,
        )

    def to_dict(self) -> dict[str, Any]:
        """把冻结设置快照转换回边界层可发送的 JSON 字典。"""

        return {
            "theme": self.theme,
            "app_language": self.app_language,
            "expert_mode": self.expert_mode,
            "proxy_url": self.proxy_url,
            "proxy_enable": self.proxy_enable,
            "scale_factor": self.scale_factor,
            "source_language": self.source_language,
            "target_language": self.target_language,
            "project_save_mode": self.project_save_mode,
            "project_fixed_path": self.project_fixed_path,
            "output_folder_open_on_finish": self.output_folder_open_on_finish,
            "request_timeout": self.request_timeout,
            "preceding_lines_threshold": self.preceding_lines_threshold,
            "clean_ruby": self.clean_ruby,
            "deduplication_in_trans": self.deduplication_in_trans,
            "deduplication_in_bilingual": self.deduplication_in_bilingual,
            "check_kana_residue": self.check_kana_residue,
            "check_hangeul_residue": self.check_hangeul_residue,
            "check_similarity": self.check_similarity,
            "write_translated_name_fields_to_file": (
                self.write_translated_name_fields_to_file
            ),
            "auto_process_prefix_suffix_preserved_text": (
                self.auto_process_prefix_suffix_preserved_text
            ),
            "mtool_optimizer_enable": self.mtool_optimizer_enable,
            "force_thinking_enable": self.force_thinking_enable,
            "glossary_default_preset": self.glossary_default_preset,
            "text_preserve_default_preset": self.text_preserve_default_preset,
            "pre_translation_replacement_default_preset": (
                self.pre_translation_replacement_default_preset
            ),
            "post_translation_replacement_default_preset": (
                self.post_translation_replacement_default_preset
            ),
            "translation_custom_prompt_default_preset": (
                self.translation_custom_prompt_default_preset
            ),
            "analysis_custom_prompt_default_preset": (
                self.analysis_custom_prompt_default_preset
            ),
            "recent_projects": [
                recent_project.to_dict() for recent_project in self.recent_projects
            ],
        }
