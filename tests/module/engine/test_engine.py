from types import SimpleNamespace

import pytest

from base.Base import Base
from module.Engine.Engine import Engine


@pytest.fixture(autouse=True)
def reset_engine_singleton() -> None:
    if hasattr(Engine, "__instance__"):
        delattr(Engine, "__instance__")
    yield
    if hasattr(Engine, "__instance__"):
        delattr(Engine, "__instance__")


def test_get_returns_singleton_instance() -> None:
    first = Engine.get()
    second = Engine.get()

    assert first is second


def test_status_and_request_counters() -> None:
    engine = Engine()

    engine.set_status(Base.TaskStatus.ANALYZING)
    assert engine.get_status() == Base.TaskStatus.ANALYZING

    engine.inc_request_in_flight()
    engine.inc_request_in_flight()
    engine.dec_request_in_flight()
    engine.dec_request_in_flight()
    engine.dec_request_in_flight()
    assert engine.get_request_in_flight_count() == 0


def test_get_running_task_count_uses_translation_and_single_threads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = Engine()
    engine.translation = SimpleNamespace(get_concurrency_in_use=lambda: 3)
    engine.analysis = SimpleNamespace(get_concurrency_in_use=lambda: 2)

    fake_threads = [
        SimpleNamespace(name="ENGINE_SINGLE"),
        SimpleNamespace(name="ENGINE_SINGLE"),
        SimpleNamespace(name="other"),
    ]
    monkeypatch.setattr(
        "module.Engine.Engine.threading.enumerate", lambda: fake_threads
    )

    assert engine.get_running_task_count() == 7


def test_run_keeps_python_engine_as_request_compatibility_layer() -> None:
    engine = Engine()
    engine.run()

    assert not hasattr(engine, "analysis")
    assert not hasattr(engine, "translation")


def test_get_running_task_count_without_translation_uses_single_threads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = Engine()
    fake_threads = [
        SimpleNamespace(name="ENGINE_SINGLE"),
        SimpleNamespace(name="worker"),
    ]
    monkeypatch.setattr(
        "module.Engine.Engine.threading.enumerate", lambda: fake_threads
    )

    assert engine.get_running_task_count() == 1
