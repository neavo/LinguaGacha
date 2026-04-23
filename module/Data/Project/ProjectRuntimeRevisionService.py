from __future__ import annotations

from collections.abc import Iterable
from typing import Any


class ProjectRuntimeRevisionConflictError(RuntimeError):
    """项目运行态 section revision 冲突。"""


class ProjectRuntimeRevisionService:
    """统一维护项目运行态 section revision。"""

    REVISION_META_KEY_PREFIX: str = "project_runtime_revision"
    SUPPORTED_SECTIONS: tuple[str, ...] = (
        "files",
        "items",
        "analysis",
    )

    def __init__(self, meta_service: Any) -> None:
        self.meta_service = meta_service

    @classmethod
    def normalize_section(cls, section: str) -> str:
        normalized_section = str(section).strip()
        if normalized_section not in cls.SUPPORTED_SECTIONS:
            raise ValueError(f"不支持的运行态 revision section：{section}")
        return normalized_section

    @classmethod
    def build_revision_meta_key(cls, section: str) -> str:
        normalized_section = cls.normalize_section(section)
        return f"{cls.REVISION_META_KEY_PREFIX}.{normalized_section}"

    def get_revision(self, section: str, default: int = 0) -> int:
        revision_key = self.build_revision_meta_key(section)
        raw_revision = self.meta_service.get_meta(revision_key, default)
        if isinstance(raw_revision, int):
            revision = raw_revision
        else:
            try:
                revision = int(raw_revision)
            except TypeError, ValueError:
                revision = default
        if revision < 0:
            revision = 0
        return revision

    def assert_revision(self, section: str, expected_revision: int) -> int:
        current_revision = self.get_revision(section)
        if current_revision != expected_revision:
            raise ProjectRuntimeRevisionConflictError(
                f"运行态 revision 冲突：section={section} 当前={current_revision} 期望={expected_revision}"
            )
        return current_revision

    def bump_revision(self, section: str, current_revision: int | None = None) -> int:
        normalized_section = self.normalize_section(section)
        if current_revision is None:
            current_revision = self.get_revision(normalized_section)
        next_revision = int(current_revision) + 1
        self.meta_service.set_meta(
            self.build_revision_meta_key(normalized_section),
            next_revision,
        )
        return next_revision

    def bump_revisions(self, sections: Iterable[str]) -> dict[str, int]:
        next_revisions: dict[str, int] = {}
        with self.meta_service.session.state_lock:
            for raw_section in sections:
                normalized_section = self.normalize_section(raw_section)
                if normalized_section in next_revisions:
                    continue
                next_revisions[normalized_section] = self.bump_revision(
                    normalized_section,
                    self.get_revision(normalized_section),
                )
        return next_revisions
