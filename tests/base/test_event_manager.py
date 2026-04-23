import gc
from types import SimpleNamespace
from typing import Any
from typing import cast

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


def test_subscribe_ignores_non_callable_entries() -> None:
    manager = build_manager()

    manager.subscribe(Base.Event.PROJECT_LOADED, cast(Any, "not-callable"))
    manager.emit_event(Base.Event.PROJECT_LOADED, {"loaded": True})
    manager.wait_for_idle(timeout=1.0)

    assert Base.Event.PROJECT_LOADED.value not in manager.event_callbacks


def test_unsubscribe_removes_only_requested_plain_handler() -> None:
    manager = build_manager()
    calls: list[str] = []

    def first_handler(event, data) -> None:
        del event, data
        calls.append("first")

    def second_handler(event, data) -> None:
        del event, data
        calls.append("second")

    manager.subscribe(Base.Event.PROJECT_LOADED, first_handler)
    manager.subscribe(Base.Event.PROJECT_LOADED, second_handler)
    manager.unsubscribe(Base.Event.PROJECT_LOADED, first_handler)
    manager.emit_event(Base.Event.PROJECT_LOADED, {"loaded": True})
    manager.wait_for_idle(timeout=1.0)

    assert calls == ["second"]


def test_bound_method_handler_is_weakly_tracked_and_auto_removed() -> None:
    manager = build_manager()
    calls: list[str] = []

    class Listener:
        def handle(self, event, data) -> None:
            del event, data
            calls.append("alive")

    listener = Listener()
    manager.subscribe(Base.Event.PROJECT_LOADED, listener.handle)
    del listener
    gc.collect()

    manager.emit_event(Base.Event.PROJECT_LOADED, {"loaded": True})
    manager.wait_for_idle(timeout=1.0)

    assert calls == []


def test_unsubscribe_handles_bound_method_owner_identity() -> None:
    manager = build_manager()
    calls: list[str] = []

    class Listener:
        def __init__(self, name: str) -> None:
            self.name = name

        def handle(self, event, data) -> None:
            del event, data
            calls.append(self.name)

    first = Listener("first")
    second = Listener("second")
    manager.subscribe(Base.Event.PROJECT_LOADED, first.handle)
    manager.subscribe(Base.Event.PROJECT_LOADED, second.handle)
    manager.unsubscribe(Base.Event.PROJECT_LOADED, first.handle)
    manager.emit_event(Base.Event.PROJECT_LOADED, {"loaded": True})
    manager.wait_for_idle(timeout=1.0)

    assert calls == ["second"]


def test_translation_progress_only_coalesces_latest_payload() -> None:
    manager = build_manager()
    received: list[int] = []
    manager.subscribe(
        Base.Event.TRANSLATION_PROGRESS,
        lambda event, data: received.append(int(data["line"])),
    )

    manager.emit_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"line": 1},
    )
    manager.emit_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"line": 2},
    )
    manager.wait_for_idle(timeout=1.0)

    assert received == [2]
