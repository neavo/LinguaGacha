from __future__ import annotations

from typing import Any

import pytest

from module.Data.Database.DatabaseGateway import DatabaseGateway
from module.Data.Database.DatabaseContracts import DatabaseRuleType
from module.Utils.JSONTool import JSONTool


class FakeDatabaseResponse:
    def __init__(self, body: bytes = b'{"ok":true,"data":{"saved":true}}') -> None:
        self.body = body

    def __enter__(self) -> "FakeDatabaseResponse":
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        del exc_type
        del exc_value
        del traceback

    def read(self) -> bytes:
        return self.body


def create_gateway_with_captured_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DatabaseGateway, list[dict[str, Any]]]:
    captured_payloads: list[dict[str, Any]] = []

    def fake_urlopen(request: Any, *, timeout: float) -> FakeDatabaseResponse:
        del timeout
        captured_payloads.append(JSONTool.loads(request.data))
        return FakeDatabaseResponse(b'{"ok":true,"data":null}')

    monkeypatch.setenv(
        DatabaseGateway.DATABASE_API_BASE_URL_ENV_NAME, "http://127.0.0.1:1"
    )
    monkeypatch.setenv(DatabaseGateway.DATABASE_API_TOKEN_ENV_NAME, "database-token")
    monkeypatch.setattr(
        "module.Data.Database.DatabaseGateway.urllib.request.urlopen", fake_urlopen
    )

    return DatabaseGateway("demo.lg"), captured_payloads


def test_request_json_uses_json_tool_for_lone_surrogate_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_body: list[bytes] = []

    def fake_urlopen(request: Any, *, timeout: float) -> FakeDatabaseResponse:
        del timeout
        captured_body.append(request.data)
        return FakeDatabaseResponse()

    monkeypatch.setenv(
        DatabaseGateway.DATABASE_API_BASE_URL_ENV_NAME, "http://127.0.0.1:1"
    )
    monkeypatch.setenv(DatabaseGateway.DATABASE_API_TOKEN_ENV_NAME, "database-token")
    monkeypatch.setattr(
        "module.Data.Database.DatabaseGateway.urllib.request.urlopen", fake_urlopen
    )

    gateway = DatabaseGateway("demo.lg")
    result = gateway.request_json(
        "/internal/database/op",
        {
            "name": "setItems",
            "args": {
                "projectPath": "demo.lg",
                "items": [{"src": "\ud800"}],
            },
        },
    )

    assert result == {"saved": True}
    assert captured_body == [
        b'{"name":"setItems","args":{"projectPath":"demo.lg","items":[{"src":"\\ud800"}]}}'
    ]


def test_rule_operations_send_current_database_rule_types(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, captured_payloads = create_gateway_with_captured_requests(monkeypatch)

    gateway.get_rules(DatabaseRuleType.TEXT_PRESERVE)
    gateway.set_rules(DatabaseRuleType.GLOSSARY, [{"src": "魔法", "dst": "Magic"}])
    gateway.set_rules(DatabaseRuleType.PRE_REPLACEMENT, [{"src": "Ａ", "dst": "A"}])
    gateway.set_rule_text(DatabaseRuleType.TRANSLATION_PROMPT, "翻译提示词")
    gateway.set_rule_text(DatabaseRuleType.ANALYSIS_PROMPT, "分析提示词")

    assert captured_payloads == [
        {
            "name": "getRules",
            "args": {
                "projectPath": "demo.lg",
                "ruleType": "text_preserve",
            },
        },
        {
            "name": "setRules",
            "args": {
                "projectPath": "demo.lg",
                "ruleType": "glossary",
                "rules": [{"src": "魔法", "dst": "Magic"}],
            },
        },
        {
            "name": "setRules",
            "args": {
                "projectPath": "demo.lg",
                "ruleType": "pre_translation_replacement",
                "rules": [{"src": "Ａ", "dst": "A"}],
            },
        },
        {
            "name": "setRuleText",
            "args": {
                "projectPath": "demo.lg",
                "ruleType": "translation_prompt",
                "text": "翻译提示词",
            },
        },
        {
            "name": "setRuleText",
            "args": {
                "projectPath": "demo.lg",
                "ruleType": "analysis_prompt",
                "text": "分析提示词",
            },
        },
    ]


def test_update_batch_normalizes_rule_payload_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, captured_payloads = create_gateway_with_captured_requests(monkeypatch)

    gateway.update_batch(
        rules={
            DatabaseRuleType.GLOSSARY: [{"src": "勇者", "dst": "Hero"}],
            DatabaseRuleType.POST_REPLACEMENT: [{"src": "END", "dst": "完"}],
        }
    )

    assert captured_payloads == [
        {
            "name": "updateBatch",
            "args": {
                "projectPath": "demo.lg",
                "items": None,
                "rules": {
                    "glossary": [{"src": "勇者", "dst": "Hero"}],
                    "post_translation_replacement": [{"src": "END", "dst": "完"}],
                },
                "meta": None,
            },
        }
    ]
