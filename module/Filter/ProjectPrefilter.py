from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Filter.LanguageFilter import LanguageFilter
from module.Filter.RuleFilter import RuleFilter


@dataclass(frozen=True)
class ProjectPrefilterStats:
    rule_skipped: int
    language_skipped: int
    mtool_skipped: int


@dataclass(frozen=True)
class ProjectPrefilterResult:
    stats: ProjectPrefilterStats
    prefilter_config: dict[str, str | bool]


class ProjectPrefilter:
    """工程级预过滤：在翻译前就把“可重算的跳过状态”落库。

    目标：校对页/翻译页读取同一份 items 时，默认不暴露本应跳过的条目。
    约束：不依赖 DataManager/Qt，仅对传入 items 做纯内存处理。
    """

    class ProgressCallback(Protocol):
        def __call__(self, current: int, total: int) -> None: ...

    @staticmethod
    def reset_recalculable_status(items: list[Item]) -> None:
        for item in items:
            if item.get_status() in (
                Base.ProjectStatus.RULE_SKIPPED,
                Base.ProjectStatus.LANGUAGE_SKIPPED,
            ):
                item.set_status(Base.ProjectStatus.NONE)

    @staticmethod
    def apply(
        items: list[Item],
        config: Config,
        *,
        progress_cb: ProgressCallback | None = None,
        progress_every: int = 200,
    ) -> ProjectPrefilterResult:
        """对工程 items 执行预过滤。

        progress_cb: (current, total) -> None
        """

        total = len(items)
        rule_skipped = 0
        language_skipped = 0
        mtool_skipped = 0

        def tick(current: int) -> None:
            if progress_cb is None:
                return
            if (
                current == 0
                or current == total
                or current % max(1, progress_every) == 0
            ):
                progress_cb(current, total)

        tick(0)

        # 1) 复位可重算状态，确保多次执行结果稳定。
        ProjectPrefilter.reset_recalculable_status(items)

        # 2) RuleFilter / LanguageFilter：仅对 NONE 条目生效。
        for idx, item in enumerate(items, start=1):
            if item.get_status() != Base.ProjectStatus.NONE:
                tick(idx)
                continue

            if RuleFilter.filter(item.get_src()):
                item.set_status(Base.ProjectStatus.RULE_SKIPPED)
                rule_skipped += 1
                tick(idx)
                continue

            if LanguageFilter.filter(item.get_src(), config.source_language):
                item.set_status(Base.ProjectStatus.LANGUAGE_SKIPPED)
                language_skipped += 1

            tick(idx)

        # 3) MTool 预处理：只在开关打开时对 KVJSON 生效。
        if config.mtool_optimizer_enable:
            mtool_skipped = ProjectPrefilter.mtool_optimizer_preprocess(items)

        stats = ProjectPrefilterStats(
            rule_skipped=rule_skipped,
            language_skipped=language_skipped,
            mtool_skipped=mtool_skipped,
        )

        prefilter_config = {
            "source_language": config.source_language.value,
            "target_language": config.target_language.value,
            "mtool_optimizer_enable": bool(config.mtool_optimizer_enable),
        }

        tick(total)
        return ProjectPrefilterResult(
            stats=stats,
            prefilter_config=prefilter_config,
        )

    @staticmethod
    def mtool_optimizer_preprocess(items: list[Item]) -> int:
        """复用翻译期的 MToolOptimizer 预处理语义。

        将 KVJSON 中“子句文本”对应的条目标记为 RULE_SKIPPED。
        返回：本次新增跳过条目数。
        """

        items_kvjson: list[Item] = [
            item for item in items if item.get_file_type() == Item.FileType.KVJSON
        ]

        group_by_file_path: dict[str, list[Item]] = {}
        for item in items_kvjson:
            group_by_file_path.setdefault(item.get_file_path(), []).append(item)

        skipped = 0
        for items_by_file_path in group_by_file_path.values():
            # 找出子句：多行 src 会拆成若干行；去掉空行。
            target: set[str] = set()
            for item in items_by_file_path:
                src = item.get_src()
                if "\n" in src:
                    target.update(
                        [
                            line.strip()
                            for line in src.splitlines()
                            if line.strip() != ""
                        ]
                    )

            # 将“子句对应的独立条目”标记为跳过
            for item in items_by_file_path:
                if item.get_status() != Base.ProjectStatus.NONE:
                    continue
                if item.get_src() in target:
                    item.set_status(Base.ProjectStatus.RULE_SKIPPED)
                    skipped += 1

        return skipped
