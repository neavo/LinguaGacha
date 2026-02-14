from __future__ import annotations

from typing import Iterator
from typing import cast
from unittest.mock import MagicMock

import pytest
from PySide6.QtCore import QObject
from PySide6.QtCore import QEvent
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication
from PySide6.QtWidgets import QWidget

import module.Utils.FontPolicy as font_policy
from module.Utils.FontPolicy import FontNormalizeFilter
from module.Utils.FontPolicy import FontPolicy


@pytest.fixture(scope="session")
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return cast(QApplication, app)


@pytest.fixture(autouse=True)
def reset_font_policy_state() -> Iterator[None]:
    FontPolicy.installed_app = None
    FontPolicy.filter_instance = None
    yield
    FontPolicy.installed_app = None
    FontPolicy.filter_instance = None


def test_px_to_pt_falls_back_to_default_dpi() -> None:
    pt = FontNormalizeFilter.px_to_pt(96, None)
    assert pt == pytest.approx(72.0)

    pt = FontNormalizeFilter.px_to_pt(96, 0)
    assert pt == pytest.approx(72.0)


def test_px_to_pt_clamps_to_min_point_size() -> None:
    pt = FontNormalizeFilter.px_to_pt(1, 10000)
    assert pt == pytest.approx(FontNormalizeFilter.MIN_POINT_SIZE)


def test_px_to_pt_returns_min_point_size_for_non_positive_px() -> None:
    assert FontNormalizeFilter.px_to_pt(0, 96) == pytest.approx(
        FontNormalizeFilter.MIN_POINT_SIZE
    )
    assert FontNormalizeFilter.px_to_pt(-1, 96) == pytest.approx(
        FontNormalizeFilter.MIN_POINT_SIZE
    )


def test_sanitize_dpi_returns_default_for_invalid_inputs() -> None:
    assert FontNormalizeFilter.sanitize_dpi(None) == pytest.approx(
        FontNormalizeFilter.DEFAULT_DPI
    )
    assert FontNormalizeFilter.sanitize_dpi(0) == pytest.approx(
        FontNormalizeFilter.DEFAULT_DPI
    )
    assert FontNormalizeFilter.sanitize_dpi(-1) == pytest.approx(
        FontNormalizeFilter.DEFAULT_DPI
    )

    # 运行时容错：即使传入非数值类型，也应兜底。
    assert FontNormalizeFilter.sanitize_dpi("bad") == pytest.approx(  # type: ignore[arg-type]
        FontNormalizeFilter.DEFAULT_DPI
    )
    assert FontNormalizeFilter.sanitize_dpi("120") == pytest.approx(120.0)  # type: ignore[arg-type]


def test_try_get_screen_dpi_y_falls_back_to_logical_dpi() -> None:
    class StubScreen:
        def logicalDotsPerInchY(self) -> float:  # noqa: N802
            raise AttributeError

        def logicalDotsPerInch(self) -> float:  # noqa: N802
            return 110.0

    assert FontNormalizeFilter.try_get_screen_dpi_y(StubScreen()) == pytest.approx(  # type: ignore[arg-type]
        110.0
    )


def test_try_get_screen_dpi_y_returns_none_when_unavailable() -> None:
    class StubScreen:
        def logicalDotsPerInchY(self) -> float:  # noqa: N802
            raise RuntimeError

        def logicalDotsPerInch(self) -> float:  # noqa: N802
            raise TypeError

    assert FontNormalizeFilter.try_get_screen_dpi_y(StubScreen()) is None  # type: ignore[arg-type]


def test_make_cache_key_includes_font_cache_key_when_available() -> None:
    class StubFont:
        def cacheKey(self) -> int:  # noqa: N802
            return 123

    assert (
        FontNormalizeFilter.make_cache_key(StubFont(), pixel_size=14, dpi=96.0)
        == "14:96.00:123"
    )


def test_get_logical_dpi_y_prefers_widget_screen(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    class StubScreen:
        def logicalDotsPerInchY(self) -> float:  # noqa: N802
            return 144.0

    class FakeQGuiApplication:
        @staticmethod
        def primaryScreen() -> None:  # noqa: N802
            return None

    monkeypatch.setattr(font_policy, "QGuiApplication", FakeQGuiApplication)

    widget = QWidget()
    widget.screen = lambda: StubScreen()  # type: ignore[method-assign]

    dpi = FontNormalizeFilter.get_logical_dpi_y(widget)
    assert dpi == pytest.approx(144.0)


def test_get_logical_dpi_y_falls_back_to_primary_screen(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    class StubScreen:
        def logicalDotsPerInchY(self) -> float:  # noqa: N802
            return 120.0

    class FakeQGuiApplication:
        @staticmethod
        def primaryScreen() -> StubScreen:  # noqa: N802
            return StubScreen()

    monkeypatch.setattr(font_policy, "QGuiApplication", FakeQGuiApplication)

    widget = QWidget()
    widget.screen = lambda: None  # type: ignore[method-assign]

    dpi = FontNormalizeFilter.get_logical_dpi_y(widget)
    assert dpi == pytest.approx(120.0)


def test_get_logical_dpi_y_falls_back_to_default(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    class FakeQGuiApplication:
        @staticmethod
        def primaryScreen() -> None:  # noqa: N802
            return None

    monkeypatch.setattr(font_policy, "QGuiApplication", FakeQGuiApplication)

    widget = QWidget()
    widget.screen = lambda: None  # type: ignore[method-assign]

    dpi = FontNormalizeFilter.get_logical_dpi_y(widget)
    assert dpi == pytest.approx(FontNormalizeFilter.DEFAULT_DPI)


def test_get_logical_dpi_y_handles_widget_screen_runtime_error(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    class FakeQGuiApplication:
        @staticmethod
        def primaryScreen() -> None:  # noqa: N802
            return None

    monkeypatch.setattr(font_policy, "QGuiApplication", FakeQGuiApplication)

    widget = QWidget()

    def raise_runtime_error():
        raise RuntimeError("boom")

    widget.screen = raise_runtime_error  # type: ignore[method-assign]

    dpi = FontNormalizeFilter.get_logical_dpi_y(widget)
    assert dpi == pytest.approx(FontNormalizeFilter.DEFAULT_DPI)


def test_get_bool_property_returns_false_on_runtime_error(qapp: QApplication) -> None:
    del qapp

    widget = QWidget()

    def boom(name: str):
        del name
        raise RuntimeError("boom")

    widget.property = boom  # type: ignore[method-assign]

    assert FontNormalizeFilter.get_bool_property(widget, "x") is False


def test_normalize_widget_font_converts_pixel_font_to_point_size(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()
    f = QWidget.font(widget)
    f.setPixelSize(14)
    QWidget.setFont(widget, f)

    assert int(QWidget.font(widget).pixelSize()) == 14
    assert float(QWidget.font(widget).pointSizeF()) <= 0

    def fake_get_logical_dpi_y(cls, w: QWidget) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)

    assert changed is True
    assert float(QWidget.font(widget).pointSizeF()) == pytest.approx(10.5)


def test_normalize_widget_font_handles_property_runtime_error(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()
    f = QWidget.font(widget)
    f.setPixelSize(14)
    QWidget.setFont(widget, f)

    def boom(name: str):
        del name
        raise RuntimeError("boom")

    widget.property = boom  # type: ignore[method-assign]

    def fake_get_logical_dpi_y(cls, w: QWidget) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)

    assert changed is True
    assert float(QWidget.font(widget).pointSizeF()) > 0


def test_normalize_widget_font_respects_reentrancy_guard(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()
    f = QWidget.font(widget)
    f.setPixelSize(14)
    QWidget.setFont(widget, f)

    widget.setProperty(FontNormalizeFilter.PROPERTY_NORMALIZING, True)

    def fake_get_logical_dpi_y(cls, w: QWidget) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)

    assert changed is False
    assert float(QWidget.font(widget).pointSizeF()) <= 0


def test_normalize_widget_font_clears_stale_cache_key_when_ineligible(
    qapp: QApplication,
) -> None:
    del qapp

    widget = QWidget()
    widget.setProperty(FontNormalizeFilter.PROPERTY_CACHE_KEY, "stale")

    assert int(QWidget.font(widget).pixelSize()) <= 0

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)

    assert changed is False
    assert widget.property(FontNormalizeFilter.PROPERTY_CACHE_KEY) == ""


def test_normalize_widget_font_ineligible_pixel_size_without_cache_key(
    qapp: QApplication,
) -> None:
    del qapp

    widget = QWidget()
    assert widget.property(FontNormalizeFilter.PROPERTY_CACHE_KEY) is None
    assert int(QWidget.font(widget).pixelSize()) <= 0

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)

    assert changed is False
    assert widget.property(FontNormalizeFilter.PROPERTY_CACHE_KEY) is None


def test_event_filter_handles_shadowed_widget_font_method(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()
    widget.font = QFont()  # type: ignore[attr-defined]

    f = QWidget.font(widget)
    f.setPixelSize(14)
    QWidget.setFont(widget, f)

    def fake_get_logical_dpi_y(cls, w: QWidget) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    filter_instance = FontNormalizeFilter()
    swallowed = filter_instance.eventFilter(widget, QEvent(QEvent.Type.Show))

    assert swallowed is False
    assert float(QWidget.font(widget).pointSizeF()) > 0


def test_event_filter_ignores_non_widget(qapp: QApplication) -> None:
    del qapp

    filter_instance = FontNormalizeFilter()
    swallowed = filter_instance.eventFilter(QObject(), QEvent(QEvent.Type.Show))
    assert swallowed is False


def test_event_filter_ignores_uninterested_event_type(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()

    def boom(self, w: QWidget) -> bool:
        del self
        del w
        raise AssertionError("should not be called")

    monkeypatch.setattr(FontNormalizeFilter, "normalize_widget_font", boom)

    filter_instance = FontNormalizeFilter()
    swallowed = filter_instance.eventFilter(widget, QEvent(QEvent.Type.MouseMove))

    assert swallowed is False


def test_event_filter_logs_warning_at_most_max_error_logs(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()
    logger = MagicMock()
    monkeypatch.setattr(font_policy.LogManager, "get", lambda: logger)

    def boom(self, w: QWidget) -> bool:
        del self
        del w
        raise RuntimeError("boom")

    monkeypatch.setattr(FontNormalizeFilter, "normalize_widget_font", boom)

    filter_instance = FontNormalizeFilter()
    event = QEvent(QEvent.Type.Show)
    for _ in range(FontNormalizeFilter.MAX_ERROR_LOGS + 2):
        filter_instance.eventFilter(widget, event)

    assert logger.warning.call_count == FontNormalizeFilter.MAX_ERROR_LOGS


def test_normalize_widget_font_skips_when_point_size_valid_and_clears_cache(
    qapp: QApplication,
) -> None:
    del qapp

    widget = QWidget()
    widget.setProperty(FontNormalizeFilter.PROPERTY_CACHE_KEY, "stale")

    f = QWidget.font(widget)
    f.setPointSizeF(11.0)
    QWidget.setFont(widget, f)

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)

    assert changed is False
    assert widget.property(FontNormalizeFilter.PROPERTY_CACHE_KEY) == ""


def test_normalize_widget_font_uses_cache_key_to_skip_repeat_work(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    del qapp

    widget = QWidget()
    f = QWidget.font(widget)
    f.setPixelSize(14)
    QWidget.setFont(widget, f)

    def fake_get_logical_dpi_y(cls, w: QWidget) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    filter_instance = FontNormalizeFilter()
    first = filter_instance.normalize_widget_font(widget)
    second = filter_instance.normalize_widget_font(widget)

    assert first is True
    assert second is False


def test_font_policy_install_uninstall_is_idempotent() -> None:
    class FakeApp(QObject):
        def __init__(self) -> None:
            super().__init__()
            self.installed_filters: list[QObject] = []
            self.removed_filters: list[QObject] = []

        def installEventFilter(self, obj: QObject) -> None:  # noqa: N802
            self.installed_filters.append(obj)

        def removeEventFilter(self, obj: QObject) -> None:  # noqa: N802
            self.removed_filters.append(obj)

    app = FakeApp()

    FontPolicy.install(app)  # type: ignore[arg-type]
    assert FontPolicy.installed_app is app
    assert FontPolicy.filter_instance is not None
    assert app.installed_filters == [FontPolicy.filter_instance]

    # 重复 install 不得重复安装过滤器。
    FontPolicy.install(app)  # type: ignore[arg-type]
    assert app.installed_filters == [FontPolicy.filter_instance]

    FontPolicy.uninstall(app)  # type: ignore[arg-type]
    assert app.removed_filters == [app.installed_filters[0]]
    assert FontPolicy.installed_app is None
    assert FontPolicy.filter_instance is None


def test_font_policy_install_switches_apps() -> None:
    class FakeApp(QObject):
        def __init__(self) -> None:
            super().__init__()
            self.installed_filters: list[QObject] = []
            self.removed_filters: list[QObject] = []

        def installEventFilter(self, obj: QObject) -> None:  # noqa: N802
            self.installed_filters.append(obj)

        def removeEventFilter(self, obj: QObject) -> None:  # noqa: N802
            self.removed_filters.append(obj)

    app1 = FakeApp()
    app2 = FakeApp()

    FontPolicy.install(app1)  # type: ignore[arg-type]
    old_filter = FontPolicy.filter_instance
    assert old_filter is not None

    FontPolicy.install(app2)  # type: ignore[arg-type]
    assert app1.removed_filters == [old_filter]
    assert app2.installed_filters == [FontPolicy.filter_instance]
    assert FontPolicy.installed_app is app2


def test_font_policy_uninstall_ignores_other_app() -> None:
    class FakeApp(QObject):
        def __init__(self) -> None:
            super().__init__()
            self.removed_filters: list[QObject] = []

        def removeEventFilter(self, obj: QObject) -> None:  # noqa: N802
            self.removed_filters.append(obj)

    app1 = FakeApp()
    app2 = FakeApp()
    filter_instance = FontNormalizeFilter(parent=app1)
    FontPolicy.installed_app = app1  # type: ignore[assignment]
    FontPolicy.filter_instance = filter_instance

    FontPolicy.uninstall(app2)  # type: ignore[arg-type]
    assert app1.removed_filters == []
    assert FontPolicy.installed_app is app1
    assert FontPolicy.filter_instance is filter_instance


def test_font_policy_uninstall_swallows_runtime_error() -> None:
    class BadApp(QObject):
        def installEventFilter(self, obj: QObject) -> None:  # noqa: N802
            del obj

        def removeEventFilter(self, obj: QObject) -> None:  # noqa: N802
            del obj
            raise RuntimeError("boom")

    app = BadApp()
    FontPolicy.install(app)  # type: ignore[arg-type]

    # removeEventFilter 抛 RuntimeError 时也应清理全局状态。
    FontPolicy.uninstall(app)  # type: ignore[arg-type]
    assert FontPolicy.installed_app is None
    assert FontPolicy.filter_instance is None


def test_create_interested_event_types_skips_optional_events_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeType:
        Polish = object()
        PolishRequest = object()
        Show = object()
        FontChange = object()
        StyleChange = object()
        PaletteChange = object()
        # 不提供 ScreenChangeInternal / DpiChange

    class FakeQEvent:
        Type = FakeType

    monkeypatch.setattr(font_policy, "QEvent", FakeQEvent)

    event_types = FontNormalizeFilter.create_interested_event_types()
    assert FakeType.Polish in event_types
    assert not hasattr(FakeType, "ScreenChangeInternal")
    assert not hasattr(FakeType, "DpiChange")


def test_create_interested_event_types_includes_dpi_change_when_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeType:
        Polish = object()
        PolishRequest = object()
        Show = object()
        FontChange = object()
        StyleChange = object()
        PaletteChange = object()
        DpiChange = object()

    class FakeQEvent:
        Type = FakeType

    monkeypatch.setattr(font_policy, "QEvent", FakeQEvent)

    event_types = FontNormalizeFilter.create_interested_event_types()
    assert FakeType.DpiChange in event_types


def test_normalize_widget_font_skips_when_point_size_positive_for_pixel_font(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class StubFont:
        def __init__(self) -> None:
            self.value: float = 11.0

        def pixelSize(self) -> int:  # noqa: N802
            return 14

        def pointSizeF(self) -> float:  # noqa: N802
            return self.value

        def setPointSizeF(self, value: float) -> None:  # noqa: N802
            self.value = float(value)

    class StubWidget:
        def __init__(self) -> None:
            self._font = StubFont()
            self._props: dict[str, object] = {
                FontNormalizeFilter.PROPERTY_CACHE_KEY: "stale"
            }

        def property(self, name: str) -> object | None:  # noqa: A003
            return self._props.get(name)

        def setProperty(self, name: str, value: object) -> None:
            self._props[name] = value

    class FakeQWidget:
        @staticmethod
        def font(widget: StubWidget) -> StubFont:  # noqa: N802
            return widget._font

        @staticmethod
        def setFont(widget: StubWidget, font: StubFont) -> None:  # noqa: N802
            widget._font = font

    monkeypatch.setattr(font_policy, "QWidget", FakeQWidget)

    widget = StubWidget()
    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)  # type: ignore[arg-type]

    assert changed is False
    assert widget.property(FontNormalizeFilter.PROPERTY_CACHE_KEY) == ""


def test_normalize_widget_font_skips_when_point_size_positive_without_cache_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class StubFont:
        def pixelSize(self) -> int:  # noqa: N802
            return 14

        def pointSizeF(self) -> float:  # noqa: N802
            return 11.0

    class StubWidget:
        def __init__(self) -> None:
            self._font = StubFont()
            self._props: dict[str, object] = {}

        def property(self, name: str) -> object | None:  # noqa: A003
            return self._props.get(name)

        def setProperty(self, name: str, value: object) -> None:
            self._props[name] = value

    class FakeQWidget:
        @staticmethod
        def font(widget: StubWidget) -> StubFont:  # noqa: N802
            return widget._font

        @staticmethod
        def setFont(widget: StubWidget, font: StubFont) -> None:  # noqa: N802
            widget._font = font

    monkeypatch.setattr(font_policy, "QWidget", FakeQWidget)

    widget = StubWidget()
    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)  # type: ignore[arg-type]

    assert changed is False
    assert widget.property(FontNormalizeFilter.PROPERTY_CACHE_KEY) is None


def test_normalize_widget_font_skips_when_cache_key_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class StubFont:
        def __init__(self) -> None:
            self.value: float = -1.0

        def pixelSize(self) -> int:  # noqa: N802
            return 14

        def pointSizeF(self) -> float:  # noqa: N802
            return self.value

        def setPointSizeF(self, value: float) -> None:  # noqa: N802
            self.value = float(value)

        def cacheKey(self) -> int:  # noqa: N802
            return 1

    class StubWidget:
        def __init__(self, font: StubFont) -> None:
            self._font = font
            self._props: dict[str, object] = {}

        def property(self, name: str) -> object | None:  # noqa: A003
            return self._props.get(name)

        def setProperty(self, name: str, value: object) -> None:
            self._props[name] = value

    class FakeQWidget:
        @staticmethod
        def font(widget: StubWidget) -> StubFont:  # noqa: N802
            return widget._font

        @staticmethod
        def setFont(widget: StubWidget, font: StubFont) -> None:  # noqa: N802
            widget._font = font

    monkeypatch.setattr(font_policy, "QWidget", FakeQWidget)

    font = StubFont()
    widget = StubWidget(font)
    widget.setProperty(FontNormalizeFilter.PROPERTY_CACHE_KEY, "14:96.00:1")

    def fake_get_logical_dpi_y(cls, w: object) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)  # type: ignore[arg-type]

    assert changed is False


def test_normalize_widget_font_clamps_point_size_when_set_does_not_apply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class StubFont:
        def __init__(self) -> None:
            self.value: float = -1.0
            self.calls: list[float] = []

        def pixelSize(self) -> int:  # noqa: N802
            return 14

        def pointSizeF(self) -> float:  # noqa: N802
            return self.value

        def setPointSizeF(self, value: float) -> None:  # noqa: N802
            self.calls.append(float(value))
            # 模拟：第一次写入被忽略，兜底写入才生效。
            if float(value) == FontNormalizeFilter.MIN_POINT_SIZE:
                self.value = float(value)

    class StubWidget:
        def __init__(self, font: StubFont) -> None:
            self._font = font
            self._props: dict[str, object] = {}

        def property(self, name: str) -> object | None:  # noqa: A003
            return self._props.get(name)

        def setProperty(self, name: str, value: object) -> None:
            self._props[name] = value

    class FakeQWidget:
        @staticmethod
        def font(widget: StubWidget) -> StubFont:  # noqa: N802
            return widget._font

        @staticmethod
        def setFont(widget: StubWidget, font: StubFont) -> None:  # noqa: N802
            widget._font = font

    monkeypatch.setattr(font_policy, "QWidget", FakeQWidget)

    def fake_get_logical_dpi_y(cls, w: object) -> float:
        del cls
        del w
        return 96.0

    monkeypatch.setattr(
        FontNormalizeFilter, "get_logical_dpi_y", classmethod(fake_get_logical_dpi_y)
    )

    font = StubFont()
    widget = StubWidget(font)
    filter_instance = FontNormalizeFilter()
    changed = filter_instance.normalize_widget_font(widget)  # type: ignore[arg-type]

    assert changed is True
    assert font.value == pytest.approx(FontNormalizeFilter.MIN_POINT_SIZE)
