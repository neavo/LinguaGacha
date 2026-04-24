from __future__ import annotations

from base.Base import Base
from module.Data.Core.Item import Item
from module.Engine.TaskScheduler import TaskScheduler


def create_item(
    src: str,
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
    *,
    file_path: str = "story.txt",
) -> Item:
    item = Item(src=src, file_path=file_path)
    item.set_status(status)
    return item


def test_generate_item_chunks_splits_when_file_changes() -> None:
    items = [
        create_item("a1", file_path="a.txt"),
        create_item("a2", file_path="a.txt"),
        create_item("b1", file_path="b.txt"),
    ]

    chunks, preceding_chunks = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=1000,
        preceding_lines_threshold=3,
    )

    assert [len(chunk) for chunk in chunks] == [2, 1]
    assert preceding_chunks[1] == []


def test_generate_item_chunks_splits_when_line_limit_exceeded() -> None:
    items = [
        create_item("\n".join([f"line-{i}" for i in range(8)])),
        create_item("line-9"),
    ]

    chunks, _ = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=16,
        preceding_lines_threshold=0,
    )

    assert [len(chunk) for chunk in chunks] == [1, 1]


def test_generate_item_chunks_skips_non_none_status_items() -> None:
    items = [
        create_item("line-1"),
        create_item("line-2", Base.ProjectStatus.PROCESSED),
        create_item("line-3"),
    ]

    chunks, _ = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=1000,
        preceding_lines_threshold=3,
    )

    flattened = [item.get_src() for chunk in chunks for item in chunk]
    assert flattened == ["line-1", "line-3"]


def test_generate_item_chunks_returns_empty_when_all_items_are_skipped() -> None:
    items = [
        create_item("line-1", Base.ProjectStatus.PROCESSED),
        create_item("line-2", Base.ProjectStatus.PROCESSED),
    ]

    chunks, preceding_chunks = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=1000,
        preceding_lines_threshold=2,
    )

    assert chunks == []
    assert preceding_chunks == []


def test_generate_item_chunks_splits_when_token_limit_exceeded() -> None:
    items = [
        create_item("first"),
        create_item("second"),
    ]

    chunks, _ = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=0,
        preceding_lines_threshold=2,
    )

    assert [len(chunk) for chunk in chunks] == [1, 1]


def test_generate_preceding_chunk_obeys_punctuation_and_threshold() -> None:
    items = [
        create_item("first.", file_path="a.txt"),
        create_item("second.", file_path="a.txt"),
        create_item("third.", file_path="a.txt"),
        create_item("target", file_path="a.txt"),
    ]

    preceding = TaskScheduler.generate_preceding_chunk(
        items=items,
        chunk=[items[3]],
        start=4,
        skip=0,
        preceding_lines_threshold=2,
    )

    assert [item.get_src() for item in preceding] == ["second.", "third."]


def test_generate_preceding_chunk_skips_excluded_and_empty_items() -> None:
    items = [
        create_item("skip.", Base.ProjectStatus.EXCLUDED, file_path="a.txt"),
        create_item("   ", file_path="a.txt"),
        create_item("kept.", file_path="a.txt"),
        create_item("target", file_path="a.txt"),
    ]

    preceding = TaskScheduler.generate_preceding_chunk(
        items=items,
        chunk=[items[3]],
        start=4,
        skip=0,
        preceding_lines_threshold=2,
    )

    assert [item.get_src() for item in preceding] == ["kept."]


def test_generate_preceding_chunk_skips_rule_and_language_skipped() -> None:
    items = [
        create_item("skip.", Base.ProjectStatus.RULE_SKIPPED),
        create_item("skip.", Base.ProjectStatus.LANGUAGE_SKIPPED),
        create_item("kept."),
        create_item("target"),
    ]

    preceding = TaskScheduler.generate_preceding_chunk(
        items=items,
        chunk=[items[3]],
        start=4,
        skip=0,
        preceding_lines_threshold=2,
    )

    assert [item.get_src() for item in preceding] == ["kept."]


def test_generate_preceding_chunk_stops_when_sentence_has_no_end_punctuation() -> None:
    items = [
        create_item("valid."),
        create_item("no-ending"),
        create_item("target"),
    ]

    preceding = TaskScheduler.generate_preceding_chunk(
        items=items,
        chunk=[items[2]],
        start=3,
        skip=0,
        preceding_lines_threshold=2,
    )

    assert preceding == []


def test_generate_preceding_chunk_stops_when_file_changes() -> None:
    items = [
        create_item("cross-file.", file_path="a.txt"),
        create_item("target", file_path="b.txt"),
    ]

    preceding = TaskScheduler.generate_preceding_chunk(
        items=items,
        chunk=[items[1]],
        start=2,
        skip=0,
        preceding_lines_threshold=2,
    )

    assert preceding == []
