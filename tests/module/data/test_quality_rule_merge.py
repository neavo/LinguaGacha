from module.Data.QualityRuleMerge import QualityRuleMerge
from module.Data.QualityRuleMerge import QualityRuleMergeKind


def test_merge_overwrite_updates_existing_without_reordering() -> None:
    existing = [
        {
            "src": "HP",
            "dst": "旧值",
            "info": "old",
            "regex": False,
            "case_sensitive": False,
        },
        {
            "src": "MP",
            "dst": "魔力",
            "info": "",
            "regex": False,
            "case_sensitive": False,
        },
    ]
    incoming = [{"src": "  HP  ", "dst": "生命值", "info": "new"}]

    merged, report = QualityRuleMerge.merge_overwrite(existing, incoming)

    assert merged[0]["src"] == "HP"
    assert merged[0]["dst"] == "生命值"
    assert merged[0]["info"] == "new"
    assert merged[1]["src"] == "MP"
    assert report.added == 0
    assert report.updated == 1
    assert report.hits[0].kind == QualityRuleMergeKind.UPDATED
    assert report.hits[0].index == 0


def test_merge_overwrite_appends_new_entry_and_normalizes_fields() -> None:
    merged, report = QualityRuleMerge.merge_overwrite(
        existing=[],
        incoming=[{"src": " Name ", "dst": "  名字 ", "regex": 1}],
    )

    assert merged == [
        {
            "src": "Name",
            "dst": "名字",
            "info": "",
            "regex": True,
            "case_sensitive": False,
        }
    ]
    assert report.added == 1
    assert report.updated == 0
    assert report.skipped_empty_src == 0
    assert report.hits[0].kind == QualityRuleMergeKind.ADDED


def test_merge_overwrite_skips_empty_and_non_dict_entries() -> None:
    merged, report = QualityRuleMerge.merge_overwrite(
        existing=[{"src": "A", "dst": "甲"}],
        incoming=[None, "bad", {"src": "   ", "dst": "X"}],
    )

    assert merged == [{"src": "A", "dst": "甲"}]
    assert report.added == 0
    assert report.updated == 0
    assert report.skipped_empty_src == 1
    assert report.hits == ()
