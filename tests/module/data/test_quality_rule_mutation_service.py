from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from module.Data.Quality.QualityRuleMutationService import (
    QualityRuleMutationService,
    QualityRuleRevisionConflictError,
)


def build_service(
    *,
    glossary: list[dict[str, object]] | None = None,
    glossary_enable: bool = True,
    revision: int = 0,
) -> tuple[QualityRuleMutationService, dict[str, object], dict[str, object]]:
    """构造带内存态的 mutation 服务，方便验证保存与 revision。"""

    rule_store: dict[str, object] = {
        "glossary": [dict(entry) for entry in glossary or []],
        "glossary_enable": glossary_enable,
    }
    meta_store: dict[str, object] = {}

    def get_glossary() -> list[dict[str, object]]:
        return [dict(entry) for entry in rule_store["glossary"]]

    def set_glossary(entries: list[dict[str, object]], save: bool = True) -> None:
        rule_store["glossary"] = [dict(entry) for entry in entries]

    def get_glossary_enable() -> bool:
        return bool(rule_store["glossary_enable"])

    def set_glossary_enable(enable: bool) -> None:
        rule_store["glossary_enable"] = bool(enable)

    quality_rule_service = SimpleNamespace(
        get_glossary=MagicMock(side_effect=get_glossary),
        set_glossary=MagicMock(side_effect=set_glossary),
        get_glossary_enable=MagicMock(side_effect=get_glossary_enable),
        set_glossary_enable=MagicMock(side_effect=set_glossary_enable),
        get_text_preserve=MagicMock(return_value=[]),
        set_text_preserve=MagicMock(),
        get_text_preserve_mode=MagicMock(),
        set_text_preserve_mode=MagicMock(),
        get_pre_replacement=MagicMock(return_value=[]),
        set_pre_replacement=MagicMock(),
        get_post_replacement=MagicMock(return_value=[]),
        set_post_replacement=MagicMock(),
    )
    meta_service = SimpleNamespace(
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
    )
    service = QualityRuleMutationService(quality_rule_service, meta_service)
    meta_store[service.build_revision_meta_key("glossary")] = revision
    return service, rule_store, meta_store


def test_save_rule_entries_rejects_stale_revision() -> None:
    service, rule_store, meta_store = build_service(revision=2)

    with pytest.raises(QualityRuleRevisionConflictError):
        service.save_entries("glossary", expected_revision=1, entries=[])

    assert rule_store["glossary"] == []
    assert meta_store[service.build_revision_meta_key("glossary")] == 2


def test_save_rule_entries_bumps_revision_after_save() -> None:
    service, rule_store, meta_store = build_service(revision=1)

    result = service.save_entries(
        "glossary",
        expected_revision=1,
        entries=[
            {"src": "B", "dst": "乙"},
            {"src": "A", "dst": "甲"},
        ],
    )

    assert rule_store["glossary"] == [
        {"src": "B", "dst": "乙"},
        {"src": "A", "dst": "甲"},
    ]
    assert meta_store[service.build_revision_meta_key("glossary")] == 2
    assert result["revision"] == 2


def test_sort_entries_orders_by_source_then_destination() -> None:
    service, rule_store, meta_store = build_service(
        glossary=[
            {"src": "beta", "dst": "Hero"},
            {"src": "alpha", "dst": "Erin"},
            {"src": "alpha", "dst": "Alice"},
        ],
        revision=4,
    )

    result = service.sort_entries("glossary", expected_revision=4)

    assert rule_store["glossary"] == [
        {"src": "alpha", "dst": "Alice"},
        {"src": "alpha", "dst": "Erin"},
        {"src": "beta", "dst": "Hero"},
    ]
    assert meta_store[service.build_revision_meta_key("glossary")] == 5
    assert result["revision"] == 5


def test_toggle_rule_enabled_updates_meta_and_revision() -> None:
    service, rule_store, meta_store = build_service(revision=7, glossary_enable=True)

    result = service.set_rule_enabled(
        "glossary",
        expected_revision=7,
        enabled=False,
    )

    assert rule_store["glossary_enable"] is False
    assert meta_store[service.build_revision_meta_key("glossary")] == 8
    assert result["meta"]["enabled"] is False
