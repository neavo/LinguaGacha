from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any
from typing import cast
from unittest.mock import MagicMock

import pytest

from base.Base import Base
import module.Engine.Translator.Translator as translator_module
from module.Engine.Translator.Translator import Translator


def build_translator_stub() -> Any:
    translator = cast(Any, Translator.__new__(Translator))
    translator.translation_run = MagicMock()
    translator.translation_require_stop = MagicMock()
    return translator


def test_translation_run_event_dispatches_request_to_translation_run() -> None:
    translator = build_translator_stub()
    payload = {
        "sub_event": Base.SubEvent.REQUEST,
    }

    Translator.translation_run_event(translator, Base.Event.TRANSLATION_TASK, payload)

    translator.translation_run.assert_called_once_with(payload)
    translator.translation_require_stop.assert_not_called()


def test_translation_stop_event_dispatches_request_to_translation_require_stop() -> None:
    translator = build_translator_stub()
    payload = {
        "sub_event": Base.SubEvent.REQUEST,
    }

    Translator.translation_stop_event(translator, Base.Event.TRANSLATION_REQUEST_STOP, payload)

    translator.translation_require_stop.assert_called_once_with(payload)
    translator.translation_run.assert_not_called()


def test_translation_run_emits_flow_error_when_engine_busy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translator = cast(Any, Translator.__new__(Translator))
    translator.emit = MagicMock()

    fake_engine = SimpleNamespace(lock=threading.Lock(), status=Base.TaskStatus.TRANSLATING)
    monkeypatch.setattr(translator_module.Engine, "get", staticmethod(lambda: fake_engine))
    monkeypatch.setattr(
        translator_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(task_running="task running")),
    )

    Translator.translation_run(translator, {})

    assert translator.emit.call_count == 2
    run_event = translator.emit.call_args_list[1].args
    assert run_event[0] == Base.Event.TRANSLATION_TASK
    assert run_event[1]["sub_event"] == Base.SubEvent.ERROR
