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
    project = {"files": {}}
    processor = WOLF(project)
    processor.block_text = {"blocked_text"}

    result = processor.filter(
        "hello",
        "path",
        [],
        [
            "common/1.json/Message/stringArgs/0",
            "common/1.json/name",
            "common/1.json/anything",
        ],
    )

    assert result == [False, True, True]


def test_filter_blocks_database_value_when_source_in_block_text() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = {"same_src"}

    result = processor.filter(
        "same_src",
        "path",
        [],
        ["DataBase.json/types/1/data/2/data/3/value"],
    )

    assert result == [True]


def test_pre_process_and_post_process_refresh_block_text() -> None:
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


def test_filter_blocks_when_src_contains_blacklisted_extension() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = set()

    assert processor.filter("sound.mp3", "path", [], ["a", "b", "c"]) == [
        True,
        True,
        True,
    ]


def test_filter_blocks_when_tag_is_red_or_blue() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = set()

    assert processor.filter("hello", "path", ["red"], ["x/y"]) == [True]


def test_filter_default_allows_when_no_rules_match() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = set()

    assert processor.filter("hello", "path", [], ["x/y"]) == [False]


def test_generate_block_text_returns_empty_when_files_is_not_dict() -> None:
    processor = WOLF(project={"files": {}})

    assert processor.generate_block_text({"files": []}) == set()


def test_generate_block_text_skips_rows_with_non_string_data() -> None:
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
    processor = WOLF(project)

    assert processor.generate_block_text(project) == {"ok"}


def test_filter_without_context_uses_tag_rule() -> None:
    processor = WOLF(project={"files": {}})
    processor.block_text = set()

    assert processor.filter("hello", "path", [], []) == [False]
