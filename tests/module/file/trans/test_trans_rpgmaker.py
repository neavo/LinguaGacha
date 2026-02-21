from __future__ import annotations

from module.File.TRANS.RPGMAKER import RPGMAKER


def test_filter_blocks_by_source_blacklist_ext() -> None:
    processor = RPGMAKER(project={})

    assert processor.filter("sound.mp3", "Map001.json", [], ["ctx1", "ctx2"]) == [
        True,
        True,
    ]


def test_filter_blocks_blacklist_path_with_cache() -> None:
    processor = RPGMAKER(project={})

    first = processor.filter("hello", "plugin.js", [], ["ctx1"])
    second = processor.filter("hello", "plugin.js", [], ["ctx2"])

    assert first == [True]
    assert second == [True]


def test_filter_blocks_by_tag_or_blacklist_address() -> None:
    processor = RPGMAKER(project={})

    by_tag = processor.filter("hello", "Map001.json", ["blue"], ["any"])
    by_address = processor.filter("hello", "Map001.json", [], ["MapInfos/1/name"])
    allow = processor.filter("hello", "Map001.json", [], ["MapInfos/1/displayName"])

    assert by_tag == [True]
    assert by_address == [True]
    assert allow == [False]


def test_filter_without_context_uses_tag_rule() -> None:
    processor = RPGMAKER(project={})

    assert processor.filter("hello", "Map001.json", [], []) == [False]
