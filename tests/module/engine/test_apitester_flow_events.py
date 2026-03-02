from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from typing import cast
from unittest.mock import MagicMock

from base.Base import Base
import module.Engine.APITester.APITester as apitester_module
from module.Engine.APITester.APITester import APITester


def test_api_test_start_ignores_non_request_sub_event() -> None:
    api_tester = cast(Any, APITester.__new__(APITester))
    api_tester.emit = MagicMock()

    APITester.api_test_start(
        api_tester,
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.DONE},
    )

    api_tester.emit.assert_not_called()


def test_api_test_start_target_inner_emits_done_when_model_id_missing(
    monkeypatch,
) -> None:
    api_tester = cast(Any, APITester.__new__(APITester))
    api_tester.emit = MagicMock()

    fake_config = SimpleNamespace(get_model=lambda model_id: None)
    monkeypatch.setattr(apitester_module.Config, "load", lambda self: fake_config)

    APITester.api_test_start_target_inner(api_tester, Base.Event.APITEST, {})

    api_tester.emit.assert_called_once_with(
        Base.Event.APITEST,
        {
            "sub_event": Base.SubEvent.DONE,
            "result": False,
            "result_msg": "Missing model_id",
        },
    )
