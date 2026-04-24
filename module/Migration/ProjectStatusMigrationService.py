from __future__ import annotations

from typing import Any


class ProjectStatusMigrationService:
    """统一承接项目状态旧值向当前状态域的迁移。"""

    LEGACY_PROCESSED_IN_PAST: str = "PROCESSED_IN_PAST"
    CURRENT_PROCESSED: str = "PROCESSED"
    PROJECT_STATUS_META_KEY: str = "project_status"

    @classmethod
    def normalize_status_value(cls, value: Any) -> Any:
        """把旧状态值转成当前值，未知值交给调用方按自身语义处理。"""

        raw_value = getattr(value, "value", value)
        if raw_value == cls.LEGACY_PROCESSED_IN_PAST:
            return cls.CURRENT_PROCESSED
        return raw_value

    @classmethod
    def normalize_item_payload(
        cls,
        item_data: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        """只改写 item status 旧值，持久化细节交给 storage 层。"""

        if item_data.get("status") != cls.LEGACY_PROCESSED_IN_PAST:
            return item_data, False

        normalized_data: dict[str, Any] = dict(item_data)
        normalized_data["status"] = cls.CURRENT_PROCESSED
        return normalized_data, True

    @classmethod
    def normalize_project_status_meta(cls, raw_status: Any) -> tuple[Any, bool]:
        """同步归一极端旧工程里的 meta.project_status 值。"""

        normalized_status = cls.normalize_status_value(raw_status)
        return normalized_status, normalized_status != raw_status
