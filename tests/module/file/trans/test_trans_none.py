from __future__ import annotations

from typing import Any
from typing import cast

from base.Base import Base
from module.File.TRANS.NONE import NONE


def test_check_handles_empty_and_aqua_and_processed_states() -> None:
    processor = NONE(project={})

    src, dst, tag, status, skip_internal_filter = processor.check(
        "a",
        ["", ""],
        [],
        ["ctx"],
    )
    assert (src, dst, tag, status, skip_internal_filter) == (
        "",
        "",
        [],
        Base.ProjectStatus.EXCLUDED,
        False,
    )

    src, dst, tag, status, skip_internal_filter = processor.check(
        "a",
        ["src", "src"],
        ["aqua"],
        ["ctx"],
    )
    assert status == Base.ProjectStatus.NONE
    assert skip_internal_filter is True
    assert tag == ["aqua"]

    _, _, _, status, _ = processor.check("a", ["src", "dst"], [], ["ctx"])
    assert status == Base.ProjectStatus.PROCESSED_IN_PAST


def test_check_sets_empty_dst_when_translation_column_missing() -> None:
    processor = NONE(project={})

    src, dst, tag, status, skip_internal_filter = processor.check(
        "a",
        ["src-only"],
        [],
        ["ctx"],
    )

    assert src == "src-only"
    assert dst == ""
    assert tag == []
    assert status == Base.ProjectStatus.NONE
    assert skip_internal_filter is False


def test_filter_blocks_by_tag_or_blacklist_ext() -> None:
    processor = NONE(project={})

    assert processor.filter("a.mp3", "p", [], ["1", "2"]) == [True, True]
    assert processor.filter("hello", "p", ["red"], ["1"]) == [True]
    assert processor.filter("hello", "p", [], ["1", "2"]) == [False, False]


def test_generate_parameter_only_when_block_mixed() -> None:
    processor = NONE(project={})

    unchanged = processor.generate_parameter(
        src="src",
        context=["a", "b"],
        parameter=[],
        block=[True, True],
    )
    changed = processor.generate_parameter(
        src="src",
        context=["a", "b"],
        parameter=[],
        block=[True, False],
    )

    assert unchanged == []
    assert changed == [
        {"contextStr": "a", "translation": "src"},
        {"contextStr": "b", "translation": ""},
    ]


def test_pre_and_post_process_are_noops() -> None:
    processor = NONE(project={})
    processor.pre_process()
    processor.post_process()


def test_check_removes_gold_tag_when_not_filtered() -> None:
    processor = NONE(project={})

    src, dst, tag, status, skip_internal_filter = processor.check(
        "a",
        ["hello", ""],
        ["gold", "keep"],
        ["ctx"],
    )

    assert src == "hello"
    assert dst == ""
    assert tag == ["keep"]
    assert status == Base.ProjectStatus.NONE
    assert skip_internal_filter is False


def test_check_adds_gold_tag_when_all_blocked_and_no_color_tags() -> None:
    processor = NONE(project={})

    src, dst, tag, status, skip_internal_filter = processor.check(
        "a",
        ["a.mp3", ""],
        ["keep"],
        ["ctx1", "ctx2"],
    )

    assert src == "a.mp3"
    assert dst == ""
    assert "gold" in tag
    assert status == Base.ProjectStatus.EXCLUDED
    assert skip_internal_filter is False


def test_generate_parameter_handles_none_and_non_dict_entries() -> None:
    processor = NONE(project={})

    result = processor.generate_parameter(
        src="src",
        context=["a", "b"],
        parameter=cast(Any, None),
        block=[True, False],
    )

    assert result == [
        {"contextStr": "a", "translation": "src"},
        {"contextStr": "b", "translation": ""},
    ]

    result = processor.generate_parameter(
        src="src",
        context=["a", "b"],
        parameter=cast(Any, [None]),
        block=[True, False],
    )

    assert result == [
        {"contextStr": "a", "translation": "src"},
        {"contextStr": "b", "translation": ""},
    ]
