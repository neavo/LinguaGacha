from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from module.Data.Core.DataEnums import TextPreserveMode
from module.Data.Quality.QualityRuleSnapshotService import (
    QualityRuleSnapshotService,
)


def build_service() -> tuple[QualityRuleSnapshotService, dict[str, object]]:
    """构造最小可控的快照服务，方便固定 revision 与 meta 行为。"""

    meta_store: dict[str, object] = {}
    quality_rule_service = SimpleNamespace(
        get_glossary=MagicMock(
            return_value=[
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "info": "",
                    "regex": False,
                    "case_sensitive": False,
                }
            ]
        ),
        get_glossary_enable=MagicMock(return_value=True),
        get_text_preserve=MagicMock(
            return_value=[
                {
                    "src": "HP",
                    "dst": "生命值",
                    "info": "",
                    "regex": False,
                    "case_sensitive": False,
                }
            ]
        ),
        get_text_preserve_mode=MagicMock(return_value=TextPreserveMode.SMART),
        get_pre_replacement=MagicMock(return_value=[]),
        get_pre_replacement_enable=MagicMock(return_value=False),
        get_post_replacement=MagicMock(return_value=[]),
        get_post_replacement_enable=MagicMock(return_value=False),
    )
    meta_service = SimpleNamespace(
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
    )
    service = QualityRuleSnapshotService(quality_rule_service, meta_service)
    return service, meta_store


def test_glossary_snapshot_contains_meta_and_entries() -> None:
    service, meta_store = build_service()
    meta_store[service.build_revision_meta_key("glossary")] = 3

    snapshot = service.get_rule_snapshot("glossary")

    assert snapshot["rule_type"] == "glossary"
    assert snapshot["revision"] == 3
    assert snapshot["meta"]["enabled"] is True
    assert snapshot["entries"][0]["src"] == "勇者"


def test_text_preserve_snapshot_contains_mode_meta() -> None:
    service, meta_store = build_service()
    meta_store[service.build_revision_meta_key("text_preserve")] = 2

    snapshot = service.get_rule_snapshot("text_preserve")

    assert snapshot["rule_type"] == "text_preserve"
    assert snapshot["revision"] == 2
    assert snapshot["meta"]["mode"] == TextPreserveMode.SMART.value
    assert snapshot["entries"][0]["dst"] == "生命值"


def test_get_rule_snapshot_rejects_unknown_rule_type() -> None:
    service, _meta_store = build_service()

    with pytest.raises(ValueError):
        service.get_rule_snapshot("unknown")
