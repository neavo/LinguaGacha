from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from api.Application.QualityRuleAppService import QualityRuleAppService
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot


def build_fake_quality_rule_facade() -> SimpleNamespace:
    """构造最小质量规则门面桩，方便固定 app service 契约。"""

    snapshot = {
        "rule_type": "glossary",
        "revision": 3,
        "meta": {"enabled": True},
        "statistics": {
            "available": False,
            "results": {},
        },
        "entries": [
            {
                "entry_id": "glossary:0",
                "src": "勇者",
                "dst": "Hero",
                "info": "",
                "regex": False,
                "case_sensitive": False,
            }
        ],
    }
    return SimpleNamespace(
        get_rule_snapshot=MagicMock(return_value=snapshot),
        save_entries=MagicMock(return_value=dict(snapshot)),
        set_rule_enabled=MagicMock(return_value=dict(snapshot)),
        update_meta=MagicMock(return_value=dict(snapshot)),
    )


def test_get_quality_rule_snapshot_returns_payload() -> None:
    app_service = QualityRuleAppService(build_fake_quality_rule_facade())

    result = app_service.get_rule_snapshot({"rule_type": "glossary"})
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])

    assert snapshot.rule_type == "glossary"
    assert snapshot.revision == 3
    assert snapshot.entries[0].src == "勇者"


def test_update_quality_rule_meta_routes_enabled_toggle_to_core_service() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.update_rule_meta(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "meta": {"enabled": False},
        }
    )

    facade.set_rule_enabled.assert_called_once_with(
        "glossary",
        expected_revision=3,
        enabled=False,
    )
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])
    assert snapshot.rule_type == "glossary"


def test_update_quality_rule_meta_maps_text_preserve_mode_to_core_key() -> None:
    facade = build_fake_quality_rule_facade()
    facade.update_meta.return_value = {
        "rule_type": "text_preserve",
        "revision": 2,
        "meta": {"mode": "SMART"},
        "statistics": {"available": False, "results": {}},
        "entries": [],
    }
    app_service = QualityRuleAppService(facade)

    result = app_service.update_rule_meta(
        {
            "rule_type": "text_preserve",
            "expected_revision": 2,
            "meta": {"mode": "SMART"},
        }
    )

    facade.update_meta.assert_called_once_with(
        "text_preserve",
        expected_revision=2,
        meta_key="text_preserve_mode",
        value="SMART",
    )
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])
    assert snapshot.meta["mode"] == "SMART"


def test_save_quality_rule_entries_returns_snapshot_payload() -> None:
    facade = build_fake_quality_rule_facade()
    app_service = QualityRuleAppService(facade)

    result = app_service.save_rule_entries(
        {
            "rule_type": "glossary",
            "expected_revision": 3,
            "entries": [{"src": "勇者", "dst": "Hero"}],
        }
    )

    facade.save_entries.assert_called_once_with(
        "glossary",
        expected_revision=3,
        entries=[{"src": "勇者", "dst": "Hero"}],
    )
    snapshot = QualityRuleSnapshot.from_dict(result["snapshot"])
    assert snapshot.entries[0].dst == "Hero"


def test_query_proofreading_returns_lookup_query() -> None:
    app_service = QualityRuleAppService(build_fake_quality_rule_facade())

    result = app_service.query_proofreading({"entry": {"src": "^勇者$", "regex": True}})
    query = ProofreadingLookupQuery.from_dict(result["query"])

    assert query.keyword == "^勇者$"
    assert query.is_regex is True
