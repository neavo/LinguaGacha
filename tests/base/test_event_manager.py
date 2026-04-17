from types import SimpleNamespace

import base.EventManager as event_manager_module
from base.Base import Base
from base.EventManager import EventManager


def build_manager() -> EventManager:
    EventManager.reset_for_test()
    return EventManager.get()


def test_coalesced_progress_only_keeps_latest_payload() -> None:
    manager = build_manager()
    received: list[int] = []
    manager.subscribe(
        Base.Event.TRANSLATION_PROGRESS,
        lambda event, data: received.append(int(data["line"])),
    )

    manager.emit_event(Base.Event.TRANSLATION_PROGRESS, {"line": 1})
    manager.emit_event(Base.Event.TRANSLATION_PROGRESS, {"line": 2})
    manager.wait_for_idle(timeout=1.0)

    assert received == [2]


def test_handler_error_does_not_stop_following_handlers(monkeypatch) -> None:
    manager = build_manager()
    calls: list[str] = []
    errors: list[str] = []
    monkeypatch.setattr(
        event_manager_module.LogManager,
        "get",
        lambda: SimpleNamespace(error=lambda msg, e=None: errors.append(msg)),
    )

    def broken_handler(event, data) -> None:
        del event, data
        raise RuntimeError("boom")

    manager.subscribe(Base.Event.PROJECT_LOADED, broken_handler)
    manager.subscribe(
        Base.Event.PROJECT_LOADED,
        lambda event, data: calls.append("after"),
    )

    manager.emit_event(Base.Event.PROJECT_LOADED, {"loaded": True})
    manager.wait_for_idle(timeout=1.0)

    assert calls == ["after"]
    assert len(errors) == 1
