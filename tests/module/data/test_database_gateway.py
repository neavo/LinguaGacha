from __future__ import annotations

from typing import Any

import pytest

from module.Data.Database.DatabaseGateway import DatabaseGateway


class FakeDatabaseResponse:
    def __enter__(self) -> "FakeDatabaseResponse":
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        del exc_type
        del exc_value
        del traceback

    def read(self) -> bytes:
        return b'{"ok":true,"data":{"saved":true}}'


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
