from __future__ import annotations

from typing import Any


class ProofreadingRevisionConflictError(RuntimeError):
    """校对快照 revision 不一致时抛出的冲突异常。"""


class ProofreadingRevisionService:
    """校对 revision 服务。

    这个服务只负责 revision 键、读取、校验与递增，避免写入口自己拼 meta 键。
    """

    REVISION_META_KEY_PREFIX: str = "proofreading_revision"

    def __init__(self, meta_service: Any) -> None:
        self.meta_service = meta_service

    def build_revision_meta_key(self, revision_scope: str) -> str:
        """统一生成 revision 的 meta 键。"""

        return f"{self.REVISION_META_KEY_PREFIX}.{revision_scope}"

    def get_revision(self, revision_scope: str, default: int = 0) -> int:
        """读取 revision，缺省时视作初始版本。"""

        revision_key = self.build_revision_meta_key(revision_scope)
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

    def assert_revision(self, revision_scope: str, expected_revision: int) -> int:
        """在写入前校验 revision，避免旧快照覆盖新状态。"""

        current_revision = self.get_revision(revision_scope)
        if expected_revision != current_revision:
            raise ProofreadingRevisionConflictError(
                f"校对 revision 冲突：当前={current_revision}，期望={expected_revision}"
            )
        return current_revision

    def bump_revision(
        self,
        revision_scope: str,
        current_revision: int | None = None,
    ) -> int:
        """写入成功后推进 revision。"""

        if current_revision is None:
            current_revision = self.get_revision(revision_scope)
        new_revision = current_revision + 1
        revision_key = self.build_revision_meta_key(revision_scope)
        self.meta_service.set_meta(revision_key, new_revision)
        return new_revision
