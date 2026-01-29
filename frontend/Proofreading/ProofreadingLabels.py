from base.Base import Base
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType
from widget.StatusTag import StatusTagType


class ProofreadingLabels:
    """Proofreading 的文案/颜色映射单一来源。

    这里不缓存映射结果，原因是语言可能在运行时切换：每次调用都走 Localizer.get()
    能确保 UI 文案始终与当前语言一致。
    """

    @staticmethod
    def get_status_label(status: Base.ProjectStatus) -> str:
        mapping: dict[Base.ProjectStatus, str] = {
            Base.ProjectStatus.NONE: Localizer.get().proofreading_page_status_none,
            Base.ProjectStatus.PROCESSED: Localizer.get().proofreading_page_status_processed,
            Base.ProjectStatus.PROCESSED_IN_PAST: Localizer.get().proofreading_page_status_processed_in_past,
            Base.ProjectStatus.ERROR: Localizer.get().proofreading_page_status_error,
            Base.ProjectStatus.LANGUAGE_SKIPPED: Localizer.get().proofreading_page_status_non_target_source_language,
        }
        return mapping.get(status, str(status))

    @staticmethod
    def get_warning_label(warning: WarningType) -> str:
        mapping: dict[WarningType, str] = {
            WarningType.KANA: Localizer.get().proofreading_page_warning_kana,
            WarningType.HANGEUL: Localizer.get().proofreading_page_warning_hangeul,
            WarningType.TEXT_PRESERVE: Localizer.get().proofreading_page_warning_text_preserve,
            WarningType.SIMILARITY: Localizer.get().proofreading_page_warning_similarity,
            WarningType.GLOSSARY: Localizer.get().proofreading_page_warning_glossary,
            WarningType.RETRY_THRESHOLD: Localizer.get().proofreading_page_warning_retry,
        }
        return mapping.get(warning, str(warning))

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
            Base.ProjectStatus.LANGUAGE_SKIPPED: (
                Localizer.get().proofreading_page_status_non_target_source_language,
                StatusTagType.INFO,
            ),
        }
        return mapping.get(status, (str(status), StatusTagType.INFO))

    @staticmethod
    def get_warning_tag_spec(warning: WarningType) -> tuple[str, StatusTagType]:
        mapping: dict[WarningType, tuple[str, StatusTagType]] = {
            WarningType.KANA: (
                Localizer.get().proofreading_page_warning_kana,
                StatusTagType.WARNING,
            ),
            WarningType.HANGEUL: (
                Localizer.get().proofreading_page_warning_hangeul,
                StatusTagType.WARNING,
            ),
            WarningType.TEXT_PRESERVE: (
                Localizer.get().proofreading_page_warning_text_preserve,
                StatusTagType.WARNING,
            ),
            WarningType.SIMILARITY: (
                Localizer.get().proofreading_page_warning_similarity,
                StatusTagType.ERROR,
            ),
            WarningType.GLOSSARY: (
                Localizer.get().proofreading_page_warning_glossary,
                StatusTagType.WARNING,
            ),
            WarningType.RETRY_THRESHOLD: (
                Localizer.get().proofreading_page_warning_retry,
                StatusTagType.WARNING,
            ),
        }
        return mapping.get(warning, (str(warning), StatusTagType.INFO))
