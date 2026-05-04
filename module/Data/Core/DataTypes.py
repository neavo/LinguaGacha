from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectItemChange:
    """条目级影响范围快照。"""

    item_ids: tuple[int, ...] = ()
    rel_paths: tuple[str, ...] = ()
    reason: str = ""
