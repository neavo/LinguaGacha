from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.StatusTag import StatusTagType


class ProofreadingLabels:
    """Proofreading 的文案/颜色映射单一来源。

    这里不缓存映射结果，原因是语言可能在运行时切换：每次调用都走 Localizer.get()
    能确保 UI 文案始终与当前语言一致。
    """

    WARNING_KANA: str = "KANA"
    WARNING_HANGEUL: str = "HANGEUL"
    WARNING_TEXT_PRESERVE: str = "TEXT_PRESERVE"
    WARNING_SIMILARITY: str = "SIMILARITY"
    WARNING_GLOSSARY: str = "GLOSSARY"
    WARNING_RETRY_THRESHOLD: str = "RETRY_THRESHOLD"

    @staticmethod
    def get_status_label(status: Base.ProjectStatus) -> str:
        mapping: dict[Base.ProjectStatus, str] = {
            Base.ProjectStatus.NONE: Localizer.get().proofreading_page_status_none,
            Base.ProjectStatus.PROCESSED: Localizer.get().proofreading_page_status_processed,
            Base.ProjectStatus.PROCESSED_IN_PAST: Localizer.get().proofreading_page_status_processed_in_past,
            Base.ProjectStatus.ERROR: Localizer.get().proofreading_page_status_error,
            Base.ProjectStatus.EXCLUDED: Localizer.get().proofreading_page_status_excluded,
            Base.ProjectStatus.LANGUAGE_SKIPPED: Localizer.get().proofreading_page_status_non_target_source_language,
        }
        return mapping.get(status, str(status))

    @staticmethod
    def resolve_warning_code(warning: object) -> str:
        raw_value = getattr(warning, "value", warning)
        return str(raw_value)

    @classmethod
    def get_warning_label(cls, warning: object) -> str:
        code = cls.resolve_warning_code(warning)
        mapping: dict[str, str] = {
            cls.WARNING_KANA: Localizer.get().issue_kana_residue,
            cls.WARNING_HANGEUL: Localizer.get().issue_hangeul_residue,
            cls.WARNING_TEXT_PRESERVE: Localizer.get().proofreading_page_warning_text_preserve,
            cls.WARNING_SIMILARITY: Localizer.get().proofreading_page_warning_similarity,
            cls.WARNING_GLOSSARY: Localizer.get().proofreading_page_warning_glossary,
            cls.WARNING_RETRY_THRESHOLD: Localizer.get().proofreading_page_warning_retry,
        }
        return mapping.get(code, code)

    @staticmethod
    def get_status_tag_spec(status: Base.ProjectStatus) -> tuple[str, StatusTagType]:
        mapping: dict[Base.ProjectStatus, tuple[str, StatusTagType]] = {
            Base.ProjectStatus.NONE: (
                Localizer.get().proofreading_page_status_none,
                StatusTagType.INFO,
            ),
            Base.ProjectStatus.PROCESSED: (
                Localizer.get().proofreading_page_status_processed,
                StatusTagType.SUCCESS,
            ),
            Base.ProjectStatus.PROCESSED_IN_PAST: (
                Localizer.get().proofreading_page_status_processed_in_past,
                StatusTagType.INFO,
            ),
            Base.ProjectStatus.ERROR: (
                Localizer.get().proofreading_page_status_error,
                StatusTagType.ERROR,
            ),
            Base.ProjectStatus.EXCLUDED: (
                Localizer.get().proofreading_page_status_excluded,
                StatusTagType.WARNING,
            ),
            Base.ProjectStatus.LANGUAGE_SKIPPED: (
                Localizer.get().proofreading_page_status_non_target_source_language,
                StatusTagType.INFO,
            ),
        }
        return mapping.get(status, (str(status), StatusTagType.INFO))

    @staticmethod
    def get_warning_tag_spec(cls, warning: object) -> tuple[str, StatusTagType]:
        code = cls.resolve_warning_code(warning)
        mapping: dict[str, tuple[str, StatusTagType]] = {
            cls.WARNING_KANA: (
                Localizer.get().issue_kana_residue,
                StatusTagType.WARNING,
            ),
            cls.WARNING_HANGEUL: (
                Localizer.get().issue_hangeul_residue,
                StatusTagType.WARNING,
            ),
            cls.WARNING_TEXT_PRESERVE: (
                Localizer.get().proofreading_page_warning_text_preserve,
                StatusTagType.WARNING,
            ),
            cls.WARNING_SIMILARITY: (
                Localizer.get().proofreading_page_warning_similarity,
                StatusTagType.ERROR,
            ),
            cls.WARNING_GLOSSARY: (
                Localizer.get().proofreading_page_warning_glossary,
                StatusTagType.WARNING,
            ),
            cls.WARNING_RETRY_THRESHOLD: (
                Localizer.get().proofreading_page_warning_retry,
                StatusTagType.WARNING,
            ),
        }
        return mapping.get(code, (code, StatusTagType.INFO))
