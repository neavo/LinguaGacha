from __future__ import annotations

from types import SimpleNamespace

import pytest

import base.Base as base_module
from base.Base import Base


class ParentEmitter:
    def __init__(self) -> None:
        self.calls: list[tuple[object, tuple[object, ...]]] = []

    def emit(self, signal: object, *args: object) -> str:
        self.calls.append((signal, args))
        return "delegated"


class DemoBase(Base, ParentEmitter):
    def __init__(self) -> None:
        super().__init__()


def test_emit_routes_base_events_to_shared_event_bus(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    fake_bus = SimpleNamespace(
        emit_event=lambda event, data: emitted.append((event, data)),
    )
    monkeypatch.setattr(base_module.EventManager, "get", lambda: fake_bus)

    result = DemoBase().emit(Base.Event.PROJECT_LOADED, {"message": "hi"})

    assert result is True
    assert emitted == [(Base.Event.PROJECT_LOADED, {"message": "hi"})]


def test_emit_uses_empty_payload_for_non_dict_event_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    fake_bus = SimpleNamespace(
        emit_event=lambda event, data: emitted.append((event, data)),
    )
    monkeypatch.setattr(base_module.EventManager, "get", lambda: fake_bus)

    result = DemoBase().emit(Base.Event.PROJECT_LOADED, "not-a-dict")

    assert result is True
    assert emitted == [(Base.Event.PROJECT_LOADED, {})]


def test_emit_delegates_non_base_signal_to_parent_emitter() -> None:
    emitter = DemoBase()

    result = emitter.emit("plain-signal", 1, 2)

    assert result is True
    assert emitter.calls == [("plain-signal", (1, 2))]


def test_emit_returns_false_when_no_parent_emitter_exists() -> None:
    result = Base().emit("plain-signal", 1)

    assert result is False


def test_subscribe_and_unsubscribe_delegate_to_event_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, Base.Event, object]] = []
    fake_bus = SimpleNamespace(
        subscribe=lambda event, handler: calls.append(("subscribe", event, handler)),
        unsubscribe=lambda event, handler: calls.append(
            ("unsubscribe", event, handler)
        ),
    )

    def handler(event: object, data: object) -> None:
        del event, data

    monkeypatch.setattr(base_module.EventManager, "get", lambda: fake_bus)

    subject = Base()
    subject.subscribe(Base.Event.PROJECT_LOADED, handler)
    subject.unsubscribe(Base.Event.PROJECT_LOADED, handler)

    assert calls == [
        ("subscribe", Base.Event.PROJECT_LOADED, handler),
        ("unsubscribe", Base.Event.PROJECT_LOADED, handler),
    ]


def test_subscribe_busy_state_events_covers_all_busy_events() -> None:
    subscribed_events: list[Base.Event] = []
    subject = Base()
    subject.subscribe = lambda event, handler: subscribed_events.append(event)

    subject.subscribe_busy_state_events(lambda event, data: None)

    assert subscribed_events == list(Base.BUSY_STATE_EVENTS)


@pytest.mark.parametrize(
    ("event", "sub_event", "expected"),
    [
        (Base.Event.TRANSLATION_RESET_ALL, Base.SubEvent.DONE, True),
        (Base.Event.ANALYSIS_RESET_FAILED, Base.SubEvent.ERROR, True),
        (Base.Event.TRANSLATION_RESET_ALL, Base.SubEvent.REQUEST, False),
        (Base.Event.PROJECT_LOADED, Base.SubEvent.DONE, False),
    ],
)
def test_is_terminal_reset_event_only_matches_reset_terminal_states(
    event: Base.Event,
    sub_event: Base.SubEvent,
    expected: bool,
) -> None:
    assert Base.is_terminal_reset_event(event, {"sub_event": sub_event}) is expected


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (Base.TaskStatus.TRANSLATING, True),
        (Base.TaskStatus.ANALYZING, True),
        (Base.TaskStatus.STOPPING, True),
        (Base.TaskStatus.IDLE, False),
    ],
)
def test_is_engine_busy_matches_declared_busy_statuses(
    status: Base.TaskStatus,
    expected: bool,
) -> None:
    assert Base.is_engine_busy(status) is expected
