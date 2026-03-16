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
