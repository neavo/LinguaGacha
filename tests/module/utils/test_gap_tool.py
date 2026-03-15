from collections.abc import Iterator

import pytest

from module.Utils.GapTool import GapTool


def counter(values: list[float]) -> Iterator[float]:
    for value in values:
        yield value


class TestGapToolIter:
    def test_iter_yields_all_items_in_order(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        perf = counter([0.0, 0.01, 0.02, 0.03])
        sleep_calls: list[float] = []

        monkeypatch.setattr(
            "module.Utils.GapTool.time.perf_counter", lambda: next(perf)
        )
        monkeypatch.setattr("module.Utils.GapTool.time.sleep", sleep_calls.append)

        result = list(GapTool.iter([1, 2, 3], sleep_seconds=0.0))

        assert result == [1, 2, 3]
        assert sleep_calls == []

    def test_iter_sleeps_when_interval_elapsed(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        perf = counter([0.0, 0.11, 0.12, 0.23, 0.24, 0.25])
        sleep_calls: list[float] = []

        monkeypatch.setattr(
            "module.Utils.GapTool.time.perf_counter", lambda: next(perf)
        )
        monkeypatch.setattr("module.Utils.GapTool.time.sleep", sleep_calls.append)

        result = list(GapTool.iter(["a", "b", "c"], sleep_seconds=0.005))

        assert result == ["a", "b", "c"]
        assert sleep_calls == [0.005, 0.005]

    def test_iter_with_empty_iterable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        perf = counter([1.0])
        sleep_calls: list[float] = []

        monkeypatch.setattr(
            "module.Utils.GapTool.time.perf_counter", lambda: next(perf)
        )
        monkeypatch.setattr("module.Utils.GapTool.time.sleep", sleep_calls.append)

        assert list(GapTool.iter([], sleep_seconds=0.1)) == []
        assert sleep_calls == []


class TestGapToolResolveSleepSeconds:
    def test_resolve_returns_explicit_value(self) -> None:
        assert GapTool.resolve_sleep_seconds(0.02) == 0.02

    def test_resolve_clamps_negative_to_zero(self) -> None:
        assert GapTool.resolve_sleep_seconds(-1.0) == 0.0

    def test_resolve_none_on_windows(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("module.Utils.GapTool.sys.platform", "win32")

        assert (
            GapTool.resolve_sleep_seconds(None) == GapTool.DEFAULT_SLEEP_SECONDS_WINDOWS
        )

    def test_resolve_none_on_non_windows(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("module.Utils.GapTool.sys.platform", "linux")

        assert GapTool.resolve_sleep_seconds(None) == GapTool.DEFAULT_SLEEP_SECONDS
