"""工程级预过滤（Project Prefilter）。

该模块的职责是：在翻译开始前，把“可重算的跳过状态”（规则跳过/语言跳过/MTool 子句跳过）
提前写入 items，从而保证：
- 校对页与翻译页读取同一份稳定的 items 状态
- 翻译流程不再需要在开始阶段重复跑过滤，避免双跑与语义漂移

设计约束：
- 不依赖 DataManager / Qt（纯内存处理），便于在工程创建期/配置变更期复用
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Filter.LanguageFilter import LanguageFilter
from module.Filter.RuleFilter import RuleFilter
from module.Utils.GapTool import GapTool


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
    def apply(
        items: list[Item],
        *,
        source_language: BaseLanguage.Enum | str,
        target_language: BaseLanguage.Enum | str,
        mtool_optimizer_enable: bool,
        progress_cb: ProgressCallback | None = None,
        progress_every: int = 200,
    ) -> ProjectPrefilterResult:
        """对工程 items 执行预过滤。

        progress_cb: (current, total) -> None
        """

        rule_skipped = 0
        language_skipped = 0
        mtool_skipped = 0

        total_items = len(items)
        phases = 3 if mtool_optimizer_enable else 2
        total_steps = total_items * phases

        def tick(current: int) -> None:
            if progress_cb is None:
                return
            if total_steps <= 0:
                return
            if (
                current == 0
                or current >= total_steps
                or current % max(1, progress_every) == 0
            ):
                progress_cb(min(current, total_steps), total_steps)

        tick(0)

        # 1) 复位可重算状态，并在 MTool 开关开启时收集 KVJSON 条目。
        items_kvjson: list[Item] = []
        for idx, item in enumerate(GapTool.iter(items), start=1):
            if item.get_status() in (
                Base.ProjectStatus.RULE_SKIPPED,
                Base.ProjectStatus.LANGUAGE_SKIPPED,
            ):
                item.set_status(Base.ProjectStatus.NONE)
            if mtool_optimizer_enable and item.get_file_type() == Item.FileType.KVJSON:
                items_kvjson.append(item)
            tick(idx)

        # 2) RuleFilter / LanguageFilter：仅对 NONE 条目生效。
        offset = total_items
        for idx, item in enumerate(GapTool.iter(items), start=1):
            if item.get_status() != Base.ProjectStatus.NONE:
                tick(offset + idx)
                continue

            if RuleFilter.filter(item.get_src()):
                item.set_status(Base.ProjectStatus.RULE_SKIPPED)
                rule_skipped += 1
                tick(offset + idx)
                continue

            if LanguageFilter.filter(item.get_src(), source_language):
                item.set_status(Base.ProjectStatus.LANGUAGE_SKIPPED)
                language_skipped += 1

            tick(offset + idx)

        # 3) MTool 预处理：只在开关打开时对 KVJSON 生效。
        if mtool_optimizer_enable:
            mtool_skipped = ProjectPrefilter.mtool_optimizer_preprocess(
                items_kvjson,
                progress_cb=progress_cb,
                progress_offset=total_items * 2,
                progress_total=total_steps,
                progress_every=progress_every,
            )

        stats = ProjectPrefilterStats(
            rule_skipped=rule_skipped,
            language_skipped=language_skipped,
            mtool_skipped=mtool_skipped,
        )

        prefilter_config = {
            "source_language": str(source_language),
            "target_language": str(target_language),
            "mtool_optimizer_enable": bool(mtool_optimizer_enable),
        }

        tick(total_steps)
        return ProjectPrefilterResult(
            stats=stats,
            prefilter_config=prefilter_config,
        )

    @staticmethod
    def mtool_optimizer_preprocess(
        items_kvjson: list[Item],
        *,
        progress_cb: ProgressCallback | None = None,
        progress_offset: int = 0,
        progress_total: int = 0,
        progress_every: int = 200,
    ) -> int:
        """复用翻译期的 MToolOptimizer 预处理语义。

        将 KVJSON 中“子句文本”对应的条目标记为 RULE_SKIPPED。
        返回：本次新增跳过条目数。
        """

        if not items_kvjson:
            if progress_cb is not None and progress_total > 0:
                progress_cb(min(progress_offset, progress_total), progress_total)
            return 0

        phase_size = max(0, progress_total - progress_offset)
        work_total = max(1, len(items_kvjson) * 3)
        work_done = 0

        def report(done: int) -> None:
            if progress_cb is None or progress_total <= 0 or phase_size <= 0:
                return
            every = max(1, progress_every)
            if done == 0 or done >= work_total or done % every == 0:
                step = progress_offset + int(done / work_total * phase_size)
                progress_cb(min(step, progress_total), progress_total)

        group_by_file_path: dict[str, list[Item]] = {}
        for item in GapTool.iter(items_kvjson):
            group_by_file_path.setdefault(item.get_file_path(), []).append(item)
            work_done += 1
            report(work_done)

        skipped = 0
        for items_by_file_path in GapTool.iter(group_by_file_path.values()):
            # 找出子句：多行 src 会拆成若干行；去掉空行。
            target: set[str] = set()
            for item in GapTool.iter(items_by_file_path):
                src = item.get_src()
                if "\n" in src:
                    target.update(
                        [
                            line.strip()
                            for line in src.splitlines()
                            if line.strip() != ""
                        ]
                    )
                work_done += 1
                report(work_done)

            # 将“子句对应的独立条目”标记为跳过
            for item in GapTool.iter(items_by_file_path):
                work_done += 1
                report(work_done)
                if item.get_status() != Base.ProjectStatus.NONE:
                    continue
                if item.get_src() in target:
                    item.set_status(Base.ProjectStatus.RULE_SKIPPED)
                    skipped += 1

        report(work_total)

        return skipped
