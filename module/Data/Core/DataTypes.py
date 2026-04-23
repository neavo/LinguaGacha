from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectPrefilterRequest:
    """预过滤请求快照。"""

    lg_path: str
    reason: str
    source_language: str
    mtool_optimizer_enable: bool


@dataclass(frozen=True)
class ProjectItemChange:
    """条目级影响范围快照。"""

    item_ids: tuple[int, ...] = ()
    rel_paths: tuple[str, ...] = ()
    reason: str = ""
