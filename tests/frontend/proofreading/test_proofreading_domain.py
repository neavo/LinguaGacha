import pytest

from base.Base import Base
from frontend.Proofreading.ProofreadingDomain import ProofreadingDomain
from frontend.Proofreading.ProofreadingDomain import ProofreadingFilterOptions
from model.Item import Item
from module.ResultChecker import WarningType


def build_item(
    *,
    src: str,
    dst: str = "",
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
    file_path: str = "story.txt",
) -> Item:
    """构造校对页测试条目，避免每个用例重复铺字段噪音。"""

    return Item(src=src, dst=dst, status=status, file_path=file_path)


def build_lookup_options(items: list[Item]) -> ProofreadingFilterOptions:
    """反查测试统一走“放开筛选”配置，贴近真实查询入口。"""

    return ProofreadingDomain.build_lookup_filter_options(
        items,
        warning_map={},
        checker=None,
    )


class TestProofreadingLookupFilterOptions:
    def test_build_lookup_filter_options_includes_all_item_statuses(self) -> None:
        items = [
            build_item(
                src="A",
                status=Base.ProjectStatus.NONE,
                file_path="a.txt",
            ),
            build_item(
                src="B",
                status=Base.ProjectStatus.EXCLUDED,
                file_path="b.txt",
            ),
            build_item(
                src="C",
                status=Base.ProjectStatus.LANGUAGE_SKIPPED,
                file_path="c.txt",
            ),
        ]

        options = build_lookup_options(items)

        assert options.statuses == {
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.EXCLUDED,
            Base.ProjectStatus.LANGUAGE_SKIPPED,
        }
        assert options.file_paths == {"a.txt", "b.txt", "c.txt"}
        assert options.warning_types is not None
        assert ProofreadingFilterOptions.NO_WARNING_TAG in options.warning_types
        assert WarningType.GLOSSARY in options.warning_types


class TestProofreadingLookupSearch:
    def test_plain_search_matches_source_and_translation(self) -> None:
        items = [
            build_item(src="Alpha Source", dst="无关"),
            build_item(src="Other", dst="Contains alpha here"),
            build_item(src="Miss", dst="miss"),
        ]

        filtered = ProofreadingDomain.filter_items(
            items=items,
            warning_map={},
            options=build_lookup_options(items),
            checker=None,
            search_keyword="alpha",
            search_is_regex=False,
            search_dst_only=False,
            enable_search_filter=True,
            enable_glossary_term_filter=False,
        )

        assert [item.get_src() for item in filtered] == ["Alpha Source", "Other"]

    @pytest.mark.parametrize(
        ("keyword", "expected_srcs"),
        [
            (r"hello-\d{3}|dst-42", ["hello-123", "Other"]),
            (r"dst-99$", ["Third"]),
        ],
    )
    def test_regex_search_matches_source_and_translation(
        self,
        keyword: str,
        expected_srcs: list[str],
    ) -> None:
        items = [
            build_item(src="hello-123", dst="无关"),
            build_item(src="Other", dst="value dst-42"),
            build_item(src="Third", dst="dst-99"),
        ]

        filtered = ProofreadingDomain.filter_items(
            items=items,
            warning_map={},
            options=build_lookup_options(items),
            checker=None,
            search_keyword=keyword,
            search_is_regex=True,
            search_dst_only=False,
            enable_search_filter=True,
            enable_glossary_term_filter=False,
        )

        assert [item.get_src() for item in filtered] == expected_srcs
