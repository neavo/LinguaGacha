from __future__ import annotations

from typing import Any

from module.Data.Core.DataEnums import TextPreserveMode
from module.Data.Storage.LGDatabase import LGDatabase


class ProjectMetaMigrationService:
    """统一承接工程 meta 旧字段向当前字段的迁移。"""

    @classmethod
    def migrate_text_preserve_mode_if_needed(
        cls,
        db: LGDatabase,
        meta_cache: dict[str, Any],
    ) -> bool:
        """把旧的 bool 开关迁移成新的 mode 枚举。"""

        raw_mode = meta_cache.get("text_preserve_mode")
        mode_valid = False
        if isinstance(raw_mode, str):
            try:
                TextPreserveMode(raw_mode)
                mode_valid = True
            except ValueError:
                mode_valid = False

        if mode_valid:
            return False

        legacy_enable = bool(meta_cache.get("text_preserve_enable", False))
        migrated = (
            TextPreserveMode.CUSTOM.value
            if legacy_enable
            else TextPreserveMode.SMART.value
        )
        db.set_meta("text_preserve_mode", migrated)
        meta_cache["text_preserve_mode"] = migrated
        return True
