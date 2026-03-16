from __future__ import annotations

from module.File.TRANS.WOLF import WOLF


def test_generate_block_text_collects_database_nonzero_string_args() -> None:
    project = {
        "files": {
            "a.json": {
                "data": [["block_me", ""], ["keep", ""]],
                "context": [
                    ["common/110.json/commands/29/Database/stringArgs/1"],
                    ["common/110.json/commands/29/Database/stringArgs/0"],
                ],
            }
        }
    }
    processor = WOLF(project)

    assert processor.generate_block_text(project) == {"block_me"}


def test_filter_applies_whitelist_blacklist_and_common_rules() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = {"blocked_text"}

    assert processor.filter(
        "hello",
        "path",
        [],
        [
            "common/1.json/Message/stringArgs/0",
            "common/1.json/name",
            "common/1.json/anything",
        ],
    ) == [False, True, True]


def test_filter_blocks_database_value_when_source_in_block_text() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = {"same_src"}

    assert processor.filter(
        "same_src",
        "path",
        [],
        ["DataBase.json/types/1/data/2/data/3/value"],
    ) == [True]


def test_filter_keeps_unmatched_non_common_context_unblocked() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = set()

    assert processor.filter(
        "plain_text",
        "path",
        [],
        ["map/001.json/events/3/message"],
    ) == [False]


def test_pre_and_post_process_refresh_block_text() -> None:
    project = {
        "files": {
            "a.json": {
                "data": [["block_me", ""]],
                "context": [["common/110.json/commands/29/Database/stringArgs/1"]],
            }
        }
    }
    processor = WOLF(project)

    processor.pre_process()
    assert processor.block_text == {"block_me"}

    processor.block_text = set()
    processor.post_process()
    assert processor.block_text == {"block_me"}


def test_filter_blocks_blacklist_ext_tag_and_handles_empty_context() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = set()

    assert processor.filter("sound.mp3", "path", [], ["a", "b", "c"]) == [
        True,
        True,
        True,
    ]
    assert processor.filter("hello", "path", ["red"], ["x/y"]) == [True]
    assert processor.filter("hello", "path", [], []) == [False]


def test_generate_block_text_returns_empty_when_files_invalid_and_skips_bad_rows() -> (
    None
):
    processor = WOLF(project={"files": {}})
    assert processor.generate_block_text({"files": []}) == set()

    project = {
        "files": {
            "a.json": {
                "data": [None, [123], ["ok", ""]],
                "context": [
                    ["common/110.json/commands/29/Database/stringArgs/1"],
                    ["common/110.json/commands/29/Database/stringArgs/1"],
                    ["common/110.json/commands/29/Database/stringArgs/1"],
                ],
            }
        }
    }
    assert WOLF(project).generate_block_text(project) == {"ok"}
