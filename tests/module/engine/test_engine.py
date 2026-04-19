from types import SimpleNamespace
import sys

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
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

    engine.set_status(Base.TaskStatus.TESTING)
    assert engine.get_status() == Base.TaskStatus.TESTING

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


def test_translate_single_item_delegates_to_translation_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[Item, Config, object]] = []

    class FakeTranslationTask:
        @staticmethod
        def translate_single(item: Item, config: Config, callback: object) -> None:
            calls.append((item, config, callback))

    monkeypatch.setitem(
        __import__("sys").modules,
        "module.Engine.Translation.TranslationTask",
        SimpleNamespace(TranslationTask=FakeTranslationTask),
    )

    engine = Engine()
    item = Item(src="A")
    config = Config()

    def callback(result_item: Item, success: bool) -> None:
        del result_item, success

    engine.translate_single_item(item, config, callback)

    assert len(calls) == 1
    assert calls[0][0] is item
    assert calls[0][1] is config


def test_run_initializes_api_test_analysis_and_translation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeAPITest:
        pass

    class FakeAnalysis:
        pass

    class FakeTranslation:
        pass

    monkeypatch.setitem(
        sys.modules,
        "module.Engine.APITest.APITest",
        SimpleNamespace(APITest=FakeAPITest),
    )
    monkeypatch.setitem(
        sys.modules,
        "module.Engine.Analysis.Analysis",
        SimpleNamespace(Analysis=FakeAnalysis),
    )
    monkeypatch.setitem(
        sys.modules,
        "module.Engine.Translation.Translation",
        SimpleNamespace(Translation=FakeTranslation),
    )

    engine = Engine()
    engine.run()

    assert isinstance(engine.api_test, FakeAPITest)
    assert isinstance(engine.analysis, FakeAnalysis)
    assert isinstance(engine.translation, FakeTranslation)


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
