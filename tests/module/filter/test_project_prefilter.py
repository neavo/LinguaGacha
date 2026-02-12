from unittest.mock import MagicMock

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Filter.ProjectPrefilter import (
    ProjectPrefilter,
    ProjectPrefilterResult,
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
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        # 复位后重新评估，"Hello World" 包含拉丁字符且不命中规则 → NONE
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_resets_language_skipped_to_none(self) -> None:
        item = make_item(src="Hello World", status=Base.ProjectStatus.LANGUAGE_SKIPPED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_preserves_non_resettable_status(self) -> None:
        # PROCESSED 状态不应被复位
        item = make_item(src="Hello World", status=Base.ProjectStatus.PROCESSED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
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
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.RULE_SKIPPED

    def test_marks_language_skipped_for_wrong_language(self) -> None:
        # 源语言为中文，但文本只有拉丁字符
        item = make_item(src="Hello World")
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.ZH,
            target_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.LANGUAGE_SKIPPED

    def test_source_language_all_disables_language_skipped(self) -> None:
        items = [make_item(src="Hello World"), make_item(src="你好世界")]
        result = ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.ALL,
            target_language=BaseLanguage.Enum.ZH,
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
            target_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.RULE_SKIPPED

    def test_normal_text_remains_none(self) -> None:
        item = make_item(src="你好世界")
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.ZH,
            target_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_skips_non_none_status(self) -> None:
        # PROCESSED 状态的条目不应被过滤逻辑修改
        item = make_item(src="12345", status=Base.ProjectStatus.PROCESSED)
        ProjectPrefilter.apply(
            [item],
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
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
            target_language=BaseLanguage.Enum.EN,
            mtool_optimizer_enable=False,
        )
        assert isinstance(result, ProjectPrefilterResult)
        assert result.stats.rule_skipped == 2
        assert result.stats.language_skipped == 1
        assert result.stats.mtool_skipped == 0

    def test_returns_prefilter_config(self) -> None:
        result = ProjectPrefilter.apply(
            [],
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=True,
        )
        assert result.prefilter_config["source_language"] == "EN"
        assert result.prefilter_config["target_language"] == "ZH"
        assert result.prefilter_config["mtool_optimizer_enable"] is True


class TestProjectPrefilterProgressCallback:
    """进度回调行为。"""

    def test_progress_callback_is_called(self) -> None:
        items = [make_item(src="Hello") for _ in range(5)]
        cb = MagicMock()
        ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
            progress_cb=cb,
        )
        assert cb.call_count > 0
        # 最后一次调用的 current 应等于 total
        last_call = cb.call_args_list[-1]
        current, total = last_call.args
        assert current == total

    def test_no_error_without_callback(self) -> None:
        items = [make_item(src="Hello")]
        # 不传 progress_cb 不应报错
        result = ProjectPrefilter.apply(
            items,
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert isinstance(result, ProjectPrefilterResult)


class TestMToolOptimizerPreprocess:
    """MTool 优化器预处理：标记 KVJSON 中的子句。"""

    def test_marks_subclauses_as_skipped(self) -> None:
        # 多行条目包含 "Line A" 和 "Line B"
        multi_line = make_item(
            src="Line A\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="file1.json",
        )
        # 独立条目匹配子句
        clause_a = make_item(
            src="Line A",
            file_type=Item.FileType.KVJSON,
            file_path="file1.json",
        )
        clause_b = make_item(
            src="Line B",
            file_type=Item.FileType.KVJSON,
            file_path="file1.json",
        )
        # 不匹配的独立条目
        other = make_item(
            src="Other text",
            file_type=Item.FileType.KVJSON,
            file_path="file1.json",
        )

        items_kvjson = [multi_line, clause_a, clause_b, other]
        skipped = ProjectPrefilter.mtool_optimizer_preprocess(items_kvjson)

        assert skipped == 2
        assert clause_a.get_status() == Base.ProjectStatus.RULE_SKIPPED
        assert clause_b.get_status() == Base.ProjectStatus.RULE_SKIPPED
        assert other.get_status() == Base.ProjectStatus.NONE

    def test_empty_list_returns_zero(self) -> None:
        assert ProjectPrefilter.mtool_optimizer_preprocess([]) == 0

    def test_skips_non_none_status_items(self) -> None:
        multi_line = make_item(
            src="Line A\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="f.json",
        )
        # clause_a 已经是 PROCESSED，不应被改为 RULE_SKIPPED
        clause_a = make_item(
            src="Line A",
            file_type=Item.FileType.KVJSON,
            file_path="f.json",
            status=Base.ProjectStatus.PROCESSED,
        )
        items_kvjson = [multi_line, clause_a]
        skipped = ProjectPrefilter.mtool_optimizer_preprocess(items_kvjson)

        assert skipped == 0
        assert clause_a.get_status() == Base.ProjectStatus.PROCESSED

    def test_groups_by_file_path(self) -> None:
        # 不同文件的子句不应互相影响
        multi_line = make_item(
            src="Shared\nClause",
            file_type=Item.FileType.KVJSON,
            file_path="file1.json",
        )
        clause_other_file = make_item(
            src="Clause",
            file_type=Item.FileType.KVJSON,
            file_path="file2.json",
        )
        items_kvjson = [multi_line, clause_other_file]
        skipped = ProjectPrefilter.mtool_optimizer_preprocess(items_kvjson)

        assert skipped == 0
        assert clause_other_file.get_status() == Base.ProjectStatus.NONE

    def test_ignores_blank_lines_in_multiline(self) -> None:
        # 多行文本中的空行不应成为匹配目标
        multi_line = make_item(
            src="Line A\n\nLine B",
            file_type=Item.FileType.KVJSON,
            file_path="f.json",
        )
        blank_item = make_item(
            src="",
            file_type=Item.FileType.KVJSON,
            file_path="f.json",
        )
        items_kvjson = [multi_line, blank_item]
        skipped = ProjectPrefilter.mtool_optimizer_preprocess(items_kvjson)

        # 空字符串 "" 不在 target 中（空行被过滤），不应被标记
        assert skipped == 0


class TestProjectPrefilterMToolIntegration:
    """MTool 优化器通过 apply 入口的集成行为。"""

    def test_apply_with_mtool_enabled(self) -> None:
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

        result = ProjectPrefilter.apply(
            [multi_line, clause, normal],
            source_language=BaseLanguage.Enum.EN,
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=True,
        )
        assert result.stats.mtool_skipped == 1
        assert clause.get_status() == Base.ProjectStatus.RULE_SKIPPED

    def test_apply_with_mtool_disabled(self) -> None:
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
            target_language=BaseLanguage.Enum.ZH,
            mtool_optimizer_enable=False,
        )
        assert result.stats.mtool_skipped == 0
        # clause 不应被 mtool 标记（但可能被 RuleFilter/LanguageFilter 标记）
