from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self


@dataclass(frozen=True)
class ProofreadingMutationResult:
    """校对写接口返回的最小 ack。"""

    revision: int = 0
    changed_item_ids: tuple[int | str, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        normalized = data if isinstance(data, dict) else {}

        changed_item_ids_raw = normalized.get("changed_item_ids", [])
        changed_item_ids: tuple[int | str, ...] = ()
        if isinstance(changed_item_ids_raw, (list, tuple, set)):
            changed_item_ids = tuple(item for item in changed_item_ids_raw)

        return cls(
            revision=int(normalized.get("revision", 0) or 0),
            changed_item_ids=changed_item_ids,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "revision": self.revision,
            "changed_item_ids": list(self.changed_item_ids),
        }
