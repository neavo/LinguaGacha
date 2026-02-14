from __future__ import annotations

from PySide6.QtCore import QEvent
from PySide6.QtCore import QObject
from PySide6.QtGui import QGuiApplication
from PySide6.QtGui import QScreen
from PySide6.QtWidgets import QApplication
from PySide6.QtWidgets import QWidget

from base.LogManager import LogManager


class FontPolicy:
    """全局字体规范化策略。

    目标：当控件字体使用像素字号（pixelSize>0）且 pointSizeF() 非法（<=0）时，
    统一换算并写回一个正的 pointSizeF()，避免下游链路出现 setPointSize(-1) 警告。
    """

    installed_app: QApplication | None = None
    filter_instance: FontNormalizeFilter | None = None

    @classmethod
    def install(cls, app: QApplication) -> None:
        if cls.installed_app is app and cls.filter_instance is not None:
            return

        if cls.installed_app is not None and cls.filter_instance is not None:
            cls.uninstall(cls.installed_app)

        filter_instance = FontNormalizeFilter(parent=app)
        app.installEventFilter(filter_instance)

        cls.installed_app = app
        cls.filter_instance = filter_instance

    @classmethod
    def uninstall(cls, app: QApplication) -> None:
        if cls.installed_app is not app or cls.filter_instance is None:
            return

        try:
            app.removeEventFilter(cls.filter_instance)
        except RuntimeError:
            # 应用退出过程中 QObject 可能已被销毁，可忽略。
            pass

        cls.installed_app = None
        cls.filter_instance = None


class FontNormalizeFilter(QObject):
    DEFAULT_DPI: float = 96.0
    MIN_POINT_SIZE: float = 1.0

    PROPERTY_NORMALIZING: str = "__lg_font_normalizing"
    PROPERTY_CACHE_KEY: str = "__lg_font_norm_key"

    MAX_ERROR_LOGS: int = 3

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.error_logs: int = 0
        self.interested_event_types: set[QEvent.Type] = (
            self.create_interested_event_types()
        )

    @classmethod
    def create_interested_event_types(cls) -> set[QEvent.Type]:
        event_types: set[QEvent.Type] = {
            QEvent.Type.Polish,
            QEvent.Type.PolishRequest,
            QEvent.Type.Show,
            QEvent.Type.FontChange,
            QEvent.Type.StyleChange,
            QEvent.Type.PaletteChange,
        }

        # 某些 PySide6/Qt 版本可能没有暴露这些枚举值；不存在时不引用。
        screen_change_internal = getattr(QEvent.Type, "ScreenChangeInternal", None)
        if screen_change_internal is not None:
            event_types.add(screen_change_internal)

        dpi_change = getattr(QEvent.Type, "DpiChange", None)
        if dpi_change is not None:
            event_types.add(dpi_change)

        return event_types

    def eventFilter(self, watched: QObject, event: QEvent) -> bool:  # noqa: N802
        try:
            if not isinstance(watched, QWidget):
                return False

            if event.type() not in self.interested_event_types:
                return False

            self.normalize_widget_font(watched)
        except Exception as e:
            # 异常路径只输出少量 warning，避免刷屏。
            if self.error_logs < self.MAX_ERROR_LOGS:
                self.error_logs += 1
                LogManager.get().warning("FontNormalizeFilter.eventFilter failed", e)

        # 不吞事件
        return False

    def normalize_widget_font(self, widget: QWidget) -> bool:
        if self.get_bool_property(widget, self.PROPERTY_NORMALIZING):
            return False

        font = QWidget.font(widget)
        pixel_size = int(font.pixelSize())
        point_size = float(font.pointSizeF())

        try:
            existing_cache_key = widget.property(self.PROPERTY_CACHE_KEY)
        except RuntimeError:
            existing_cache_key = None

        if pixel_size <= 0:
            if existing_cache_key:
                widget.setProperty(self.PROPERTY_CACHE_KEY, "")
            return False

        if point_size > 0:
            if existing_cache_key:
                widget.setProperty(self.PROPERTY_CACHE_KEY, "")
            return False

        dpi = self.get_logical_dpi_y(widget)
        cache_key = self.make_cache_key(font, pixel_size, dpi)
        if existing_cache_key == cache_key:
            return False

        widget.setProperty(self.PROPERTY_NORMALIZING, True)
        try:
            normalized_pt = self.px_to_pt(pixel_size, dpi)
            font.setPointSizeF(float(normalized_pt))

            # 保底：确保写回后 pointSizeF() 为正。
            if float(font.pointSizeF()) <= 0:
                font.setPointSizeF(self.MIN_POINT_SIZE)

            QWidget.setFont(widget, font)
            widget.setProperty(self.PROPERTY_CACHE_KEY, cache_key)

            return True
        finally:
            widget.setProperty(self.PROPERTY_NORMALIZING, False)

    @classmethod
    def make_cache_key(cls, font: object, pixel_size: int, dpi: float) -> str:
        cache_key = None
        try:
            cache_key = int(getattr(font, "cacheKey")())
        except Exception:
            cache_key = None

        if cache_key is None:
            return f"{int(pixel_size)}:{float(dpi):.2f}"

        return f"{int(pixel_size)}:{float(dpi):.2f}:{cache_key}"

    @classmethod
    def get_bool_property(cls, widget: QWidget, name: str) -> bool:
        try:
            value = widget.property(name)
        except RuntimeError:
            return False
        return bool(value) if value is not None else False

    @classmethod
    def try_get_screen_dpi_y(cls, screen: QScreen | None) -> float | None:
        if screen is None:
            return None

        try:
            dpi = float(screen.logicalDotsPerInchY())
        except AttributeError, TypeError, RuntimeError:
            try:
                dpi = float(screen.logicalDotsPerInch())
            except AttributeError, TypeError, RuntimeError:
                return None

        return dpi if dpi > 0 else None

    @classmethod
    def get_logical_dpi_y(cls, widget: QWidget) -> float:
        try:
            widget_screen = widget.screen()
        except RuntimeError:
            widget_screen = None

        dpi = cls.try_get_screen_dpi_y(widget_screen)
        if dpi is not None:
            return dpi

        dpi = cls.try_get_screen_dpi_y(QGuiApplication.primaryScreen())
        if dpi is not None:
            return dpi

        return cls.DEFAULT_DPI

    @classmethod
    def sanitize_dpi(cls, dpi: float | int | None) -> float:
        if dpi is None:
            return cls.DEFAULT_DPI

        try:
            value = float(dpi)
        except TypeError, ValueError:
            return cls.DEFAULT_DPI

        return value if value > 0 else cls.DEFAULT_DPI

    @classmethod
    def px_to_pt(cls, pixel_size: int, dpi: float | int | None) -> float:
        px = int(pixel_size)
        if px <= 0:
            return cls.MIN_POINT_SIZE

        dpi_value = cls.sanitize_dpi(dpi)
        pt = px * 72.0 / dpi_value
        return max(cls.MIN_POINT_SIZE, float(pt))
