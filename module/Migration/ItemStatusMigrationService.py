from __future__ import annotations

from typing import Any


class ItemStatusMigrationService:
    """统一承接 item 旧状态向当前状态域的迁移。"""

    LEGACY_PROCESSED_IN_PAST: str = "PROCESSED_IN_PAST"
    LEGACY_PROCESSING: str = "PROCESSING"
    CURRENT_PROCESSED: str = "PROCESSED"
    CURRENT_NONE: str = "NONE"
    VALID_ITEM_STATUSES: frozenset[str] = frozenset(
        {
            CURRENT_NONE,
            CURRENT_PROCESSED,
            "ERROR",
            "EXCLUDED",
            "RULE_SKIPPED",
            "LANGUAGE_SKIPPED",
            "DUPLICATED",
        }
    )

    @classmethod
    def normalize_status_value(cls, value: Any) -> Any:
        """把旧状态值转成当前值，未知值交给调用方按自身语义处理。"""

        raw_value = getattr(value, "value", value)
        if raw_value == cls.LEGACY_PROCESSED_IN_PAST:
            return cls.CURRENT_PROCESSED
        return raw_value

    @classmethod
    def normalize_item_status_value(cls, value: Any) -> str:
        """把 item 状态收窄到当前允许的条目事实集合。"""

        normalized_value = cls.normalize_status_value(value)
        if normalized_value == cls.LEGACY_PROCESSING:
            return cls.CURRENT_NONE
        if (
            isinstance(normalized_value, str)
            and normalized_value in cls.VALID_ITEM_STATUSES
        ):
            return normalized_value
        return cls.CURRENT_NONE

    @classmethod
    def normalize_item_payload(
        cls,
        item_data: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        """只改写 item status 旧值，持久化细节交给 storage 层。"""

        raw_status = item_data.get("status")
        normalized_status = cls.normalize_item_status_value(raw_status)
        if raw_status == normalized_status:
            return item_data, False

        normalized_data: dict[str, Any] = dict(item_data)
        normalized_data["status"] = normalized_status
        return normalized_data, True
