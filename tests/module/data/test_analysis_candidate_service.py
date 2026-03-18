from __future__ import annotations

from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService


ANALYSIS_TIME = "2026-03-10T10:00:00"


def build_candidate_entry(
    *,
    src: str,
    dst_votes: dict[str, int],
    info_votes: dict[str, int],
    observation_count: int,
) -> dict[str, object]:
    return {
        "src": src,
        "dst_votes": dst_votes,
        "info_votes": info_votes,
        "observation_count": observation_count,
        "first_seen_at": ANALYSIS_TIME,
        "last_seen_at": ANALYSIS_TIME,
        "case_sensitive": False,
    }


def test_build_glossary_entry_from_candidate_picks_highest_votes() -> None:
    service = AnalysisCandidateService()

    glossary_entry = service.build_glossary_entry_from_candidate(
        "Alice",
        build_candidate_entry(
            src="Alice",
            dst_votes={"爱丽丝": 2, "艾丽斯": 1},
            info_votes={"女性人名": 2},
            observation_count=2,
        ),
    )

    assert glossary_entry == {
        "src": "Alice",
        "dst": "爱丽丝",
        "info": "女性人名",
        "case_sensitive": False,
    }


def test_merge_candidate_aggregate_accumulates_votes_and_keeps_time_edges() -> None:
    service = AnalysisCandidateService()

    merged = service.merge_candidate_aggregate(
        {
            "HP": {
                "src": "HP",
                "dst_votes": {"生命值": 2},
                "info_votes": {"属性": 1},
                "observation_count": 2,
                "first_seen_at": "2026-03-09T10:00:00",
                "last_seen_at": "2026-03-10T10:00:00",
                "case_sensitive": False,
                "first_seen_index": 3,
            }
        },
        {
            "HP": {
                "src": "HP",
                "dst_votes": {"生命值": 1, "血量": 1},
                "info_votes": {"属性": 2},
                "observation_count": 2,
                "first_seen_at": "2026-03-08T10:00:00",
                "last_seen_at": "2026-03-11T10:00:00",
                "case_sensitive": True,
            }
        },
    )

    assert merged["HP"]["dst_votes"] == {"生命值": 3, "血量": 1}
    assert merged["HP"]["info_votes"] == {"属性": 3}
    assert merged["HP"]["observation_count"] == 4
    assert merged["HP"]["first_seen_at"] == "2026-03-08T10:00:00"
    assert merged["HP"]["last_seen_at"] == "2026-03-11T10:00:00"
    assert merged["HP"]["case_sensitive"] is True


def test_build_commit_glossary_entries_dedupes_and_skips_invalid_rows() -> None:
    service = AnalysisCandidateService()

    entries = service.build_commit_glossary_entries(
        [
            {
                "src": " Alice ",
                "dst": " 爱丽丝 ",
                "info": "女性人名",
                "case_sensitive": False,
            },
            {
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "女性人名",
                "case_sensitive": False,
            },
            {
                "src": "Alice",
                "dst": "",
                "info": "坏数据",
            },
            "not-a-dict",
        ],
        created_at=ANALYSIS_TIME,
    )

    assert entries == [
        {
            "src": "Alice",
            "dst": "爱丽丝",
            "info": "女性人名",
            "case_sensitive": False,
            "created_at": ANALYSIS_TIME,
        }
    ]


def test_normalize_vote_map_skips_non_dict_keys_and_bad_votes() -> None:
    service = AnalysisCandidateService()

    votes = service.normalize_vote_map(
        {
            "HP": 1,
            "  HP  ": 2,
            1: 99,
            "MP": "bad",
            "SP": 0,
        }
    )

    assert votes == {"HP": 3}
    assert service.normalize_vote_map(["not-a-dict"]) == {}


def test_normalize_candidate_aggregate_entry_accepts_json_votes_and_repairs_defaults() -> (
    None
):
    service = AnalysisCandidateService()

    entry = service.normalize_candidate_aggregate_entry(
        " Alice ",
        {
            "dst_votes": '{"爱丽丝": 2, "  爱丽丝  ": 1, "坏票": 0}',
            "info_votes": '{"女性人名": 1}',
            "observation_count": "bad-value",
            "first_seen_at": " ",
            "last_seen_at": "",
            "case_sensitive": 1,
            "first_seen_index": "-3",
        },
    )

    assert entry is not None
    assert entry["src"] == "Alice"
    assert entry["dst_votes"] == {"爱丽丝": 3}
    assert entry["info_votes"] == {"女性人名": 1}
    assert entry["observation_count"] == 3
    assert entry["case_sensitive"] is True
    assert entry["first_seen_index"] == 0
    assert isinstance(entry["first_seen_at"], str)
    assert isinstance(entry["last_seen_at"], str)
    assert entry["first_seen_at"] != ""
    assert entry["last_seen_at"] != ""


def test_merge_glossary_entries_into_candidate_aggregates_updates_existing_and_new_src() -> (
    None
):
    service = AnalysisCandidateService()
    aggregate_map = {
        "Alice": {
            "src": "Alice",
            "dst_votes": {"爱丽丝": 1},
            "info_votes": {"女性人名": 1},
            "observation_count": 1,
            "first_seen_at": "2026-03-09T10:00:00",
            "last_seen_at": "2026-03-09T10:00:00",
            "case_sensitive": False,
            "first_seen_index": 0,
        }
    }

    service.merge_glossary_entries_into_candidate_aggregates(
        [
            {
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "女性人名",
                "case_sensitive": True,
                "created_at": ANALYSIS_TIME,
            },
            {
                "src": "Bob",
                "dst": "鲍勃",
                "info": "男性人名",
                "case_sensitive": False,
                "created_at": ANALYSIS_TIME,
            },
        ],
        aggregate_map,
    )

    assert aggregate_map["Alice"]["dst_votes"] == {"爱丽丝": 2}
    assert aggregate_map["Alice"]["info_votes"] == {"女性人名": 2}
    assert aggregate_map["Alice"]["observation_count"] == 2
    assert aggregate_map["Alice"]["last_seen_at"] == ANALYSIS_TIME
    assert aggregate_map["Alice"]["case_sensitive"] is True
    assert aggregate_map["Bob"] == {
        "src": "Bob",
        "dst_votes": {"鲍勃": 1},
        "info_votes": {"男性人名": 1},
        "observation_count": 1,
        "first_seen_at": ANALYSIS_TIME,
        "last_seen_at": ANALYSIS_TIME,
        "case_sensitive": False,
        "first_seen_index": 0,
    }


def test_build_candidate_aggregate_upsert_rows_keeps_requested_existing_srcs_only() -> (
    None
):
    service = AnalysisCandidateService()

    rows = service.build_candidate_aggregate_upsert_rows(
        {
            "Alice": {
                "src": "Alice",
                "dst_votes": {"爱丽丝": 1},
                "info_votes": {"女性人名": 1},
                "observation_count": 1,
                "first_seen_at": ANALYSIS_TIME,
                "last_seen_at": ANALYSIS_TIME,
                "case_sensitive": False,
            }
        },
        ["Missing", "Alice"],
    )

    assert rows == [
        {
            "src": "Alice",
            "dst_votes": {"爱丽丝": 1},
            "info_votes": {"女性人名": 1},
            "observation_count": 1,
            "first_seen_at": ANALYSIS_TIME,
            "last_seen_at": ANALYSIS_TIME,
            "case_sensitive": False,
        }
    ]


def test_build_glossary_from_candidates_skips_placeholder_and_self_mapping_noise() -> (
    None
):
    service = AnalysisCandidateService()

    glossary = service.build_glossary_from_candidates(
        {
            "Alice": build_candidate_entry(
                src="Alice",
                dst_votes={"爱丽丝": 2},
                info_votes={"女性人名": 2},
                observation_count=2,
            ),
            "HP": build_candidate_entry(
                src="HP",
                dst_votes={"HP": 2},
                info_votes={"属性": 2},
                observation_count=2,
            ),
            "Noise": build_candidate_entry(
                src="Noise",
                dst_votes={"杂讯": 2},
                info_votes={"other": 2},
                observation_count=2,
            ),
        }
    )

    assert glossary == [
        {
            "src": "Alice",
            "dst": "爱丽丝",
            "info": "女性人名",
            "case_sensitive": False,
        }
    ]


def test_pick_candidate_winner_returns_empty_for_no_votes() -> None:
    service = AnalysisCandidateService()

    assert service.pick_candidate_winner({}) == ""
