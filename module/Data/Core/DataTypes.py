from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectPrefilterRequest:
    """预过滤请求快照。"""

    token: int
    seq: int
    lg_path: str
    reason: str
    source_language: str
    mtool_optimizer_enable: bool


@dataclass(frozen=True)
class ProjectPrefilterScheduleResult:
    """预过滤调度结果。

    `needed` 表示当前配置语义上是否需要重跑预过滤。
    `accepted` 表示本次是否已经成功把重算请求交给预过滤链。
    """

    needed: bool = False
    accepted: bool = False


@dataclass(frozen=True)
class ProjectItemChange:
    """条目级影响范围快照。"""

    item_ids: tuple[int, ...] = ()
    rel_paths: tuple[str, ...] = ()
    reason: str = ""
