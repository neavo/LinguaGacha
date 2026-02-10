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
