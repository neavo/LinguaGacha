import pytest

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Data.Core.Item import Item
from module.Filter.ProjectPrefilter import (
    ProjectPrefilter,
)


def make_item(
    src: str = "",
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
    file_type: Item.FileType = Item.FileType.NONE,
    file_path: str = "",
) -> Item:
    """创建测试用 Item 的工厂函数。"""
    return Item(src=src, status=status, file_type=file_type, file_path=file_path)


class TestProjectPrefilterResetPhase:
    """阶段 1：复位可重算的跳过状态。"""

    def test_resets_rule_skipped_to_none(self) -> None:
        item = make_item(src="Hello World", status=Base.ProjectStatus.RULE_SKIPPED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        # 复位后重新评估，"Hello World" 包含拉丁字符且不命中规则 → NONE
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_resets_language_skipped_to_none(self) -> None:
        item = make_item(src="Hello World", status=Base.ProjectStatus.LANGUAGE_SKIPPED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_preserves_non_resettable_status(self) -> None:
        # PROCESSED 状态不应被复位
        item = make_item(src="Hello World", status=Base.ProjectStatus.PROCESSED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.PROCESSED


class TestProjectPrefilterFilterPhase:
    """阶段 2：RuleFilter / LanguageFilter 应用。"""

    def test_marks_rule_skipped_for_numeric_text(self) -> None:
        item = make_item(src="12345")
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.RULE_SKIPPED

    def test_marks_language_skipped_for_wrong_language(self) -> None:
        # 源语言为中文，但文本只有拉丁字符
        item = make_item(src="Hello World")
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.LANGUAGE_SKIPPED

    def test_source_language_all_disables_language_skipped(self) -> None:
        items = [make_item(src="Hello World"), make_item(src="你好世界")]
        result = ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.ALL,
            mtool_optimizer_enable=False,
        )

        assert result.stats.language_skipped == 0
        assert all(
            item.get_status() != Base.ProjectStatus.LANGUAGE_SKIPPED for item in items
        )

    def test_rule_filter_takes_priority_over_language_filter(self) -> None:
        # "12345" 会同时命中规则过滤和语言过滤，但规则过滤优先（先检查）
        item = make_item(src="12345")
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.RULE_SKIPPED

    def test_normal_text_remains_none(self) -> None:
        item = make_item(src="你好世界")
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_skips_non_none_status(self) -> None:
        # PROCESSED 状态的条目不应被过滤逻辑修改
        item = make_item(src="12345", status=Base.ProjectStatus.PROCESSED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.PROCESSED


class TestProjectPrefilterStats:
    """返回值中的统计信息。"""

    def test_returns_correct_stats(self) -> None:
        items = [
            make_item(src="12345"),  # rule_skipped
            make_item(src="Hello World"),  # language_skipped (源语言 ZH)
            make_item(src="你好世界"),  # 正常
            make_item(src="67890"),  # rule_skipped
        ]
        result = ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert result.stats.rule_skipped == 2
        assert result.stats.language_skipped == 1
        assert result.stats.mtool_skipped == 0

    def test_returns_prefilter_config(self) -> None:
        result = ProjectPrefilter.apply(
            [],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=True,
        )
        assert result.prefilter_config["source_language"] == "EN"
        assert result.prefilter_config["mtool_optimizer_enable"] is True


class TestProjectPrefilterProgressCallback:
    """进度回调行为。"""

    def test_progress_callback_reports_progress_until_final_step(self) -> None:
        items = [make_item(src="Hello") for _ in range(5)]
        progress_steps: list[tuple[int, int]] = []
        ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
            progress_cb=lambda current, total: progress_steps.append((current, total)),
        )
        assert progress_steps[0] == (0, 10)
        assert progress_steps[-1] == (10, 10)

    def test_progress_every_limits_intermediate_reports(self) -> None:
        items = [make_item(src="Hello") for _ in range(3)]
        progress_steps: list[tuple[int, int]] = []

        ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
            progress_cb=lambda current, total: progress_steps.append((current, total)),
            progress_every=4,
        )

        assert progress_steps[0] == (0, 6)
        assert (4, 6) in progress_steps
        assert progress_steps[-1] == (6, 6)
        assert (2, 6) not in progress_steps
        assert (3, 6) not in progress_steps
        assert (5, 6) not in progress_steps


class TestProjectPrefilterInputContract:
    """对外输入契约：允许直接传语言码字符串。"""

    def test_apply_accepts_plain_string_language_code(self) -> None:
        items = [make_item(src="你好世界"), make_item(src="Hello World")]
        result = ProjectPrefilter.apply(
            items,
            source_language="ZH",
            mtool_optimizer_enable=False,
        )

        assert items[0].get_status() == Base.ProjectStatus.NONE
        assert items[1].get_status() == Base.ProjectStatus.LANGUAGE_SKIPPED
        assert result.prefilter_config == {
            "source_language": "ZH",
            "mtool_optimizer_enable": False,
        }

    def test_apply_raises_for_unknown_language_code(self) -> None:
        items = [make_item(src="Hello World")]

        with pytest.raises(AttributeError):
            ProjectPrefilter.apply(
                items,
                source_language="UNKNOWN",
                mtool_optimizer_enable=False,
            )


class TestProjectPrefilterMToolIntegration:
    """MTool 优化器通过 apply 入口的集成行为。"""

    def test_apply_marks_kvjson_subclauses_when_mtool_enabled(self) -> None:
        multi_line = make_item(
            src="Line A\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        clause = make_item(
            src="Line A",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        normal = make_item(
            src="Normal text",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        other_file_clause = make_item(
            src="Line B",
            file_type=Item.FileType.KVJSON,
            file_path="other.json",
        )

        result = ProjectPrefilter.apply(
            [multi_line, clause, normal, other_file_clause],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=True,
        )

        assert result.stats.mtool_skipped == 1
        assert clause.get_status() == Base.ProjectStatus.RULE_SKIPPED
        assert normal.get_status() == Base.ProjectStatus.NONE
        assert other_file_clause.get_status() == Base.ProjectStatus.NONE

    def test_apply_keeps_subclauses_when_mtool_disabled(self) -> None:
        multi_line = make_item(
            src="Line A\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        clause = make_item(
            src="Line A",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )

        result = ProjectPrefilter.apply(
            [multi_line, clause],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert result.stats.mtool_skipped == 0
        assert clause.get_status() == Base.ProjectStatus.NONE

    def test_apply_does_not_replace_existing_item_status_with_mtool_skip(
        self,
    ) -> None:
        multi_line = make_item(
            src="Line A\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        processed_clause = make_item(
            src="Line A",
            status=Base.ProjectStatus.PROCESSED,
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )

        result = ProjectPrefilter.apply(
            [multi_line, processed_clause],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=True,
        )

        assert result.stats.mtool_skipped == 0
        assert processed_clause.get_status() == Base.ProjectStatus.PROCESSED

    def test_apply_ignores_blank_subclauses_when_mtool_enabled(self) -> None:
        multi_line = make_item(
            src="Line A\n\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        blank_item = make_item(
            src="",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )

        result = ProjectPrefilter.apply(
            [multi_line, blank_item],
            source_language=BaseLanguage.ALL,
            mtool_optimizer_enable=True,
        )

        assert result.stats.mtool_skipped == 0
        assert blank_item.get_status() == Base.ProjectStatus.NONE


class TestProjectPrefilterEmptyInputAndPhaseProgress:
    """空输入与阶段进度回调也要保持稳定可消费。"""

    def test_apply_returns_zero_stats_for_empty_items(self) -> None:
        progress_steps: list[tuple[int, int]] = []

        result = ProjectPrefilter.apply(
            [],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
            progress_cb=lambda current, total: progress_steps.append((current, total)),
        )

        assert result.stats.rule_skipped == 0
        assert result.stats.language_skipped == 0
        assert result.stats.mtool_skipped == 0
        assert progress_steps == []

    def test_apply_with_mtool_reports_phase_completion(self) -> None:
        progress_steps: list[tuple[int, int]] = []
        multi_line = make_item(
            src="Line A\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )
        clause = make_item(
            src="Line A",
            file_type=Item.FileType.KVJSON,
            file_path="game.json",
        )

        result = ProjectPrefilter.apply(
            [multi_line, clause],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=True,
            progress_cb=lambda current, total: progress_steps.append((current, total)),
            progress_every=100,
        )

        assert result.stats.mtool_skipped == 1
        assert progress_steps[-1] == (6, 6)

    def test_apply_with_mtool_reports_phase_offset_when_project_has_no_kvjson(
        self,
    ) -> None:
        progress_steps: list[tuple[int, int]] = []
        item = make_item(src="Hello", file_type=Item.FileType.TXT)

        result = ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=True,
            progress_cb=lambda current, total: progress_steps.append((current, total)),
        )

        assert result.stats.mtool_skipped == 0
        assert (2, 3) in progress_steps
        assert progress_steps[-1] == (3, 3)
