from __future__ import annotations

from collections.abc import Sequence

from PySide6.QtCore import QPoint
from PySide6.QtCore import QRect
from PySide6.QtCore import Qt
from PySide6.QtGui import QPainter
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QTableView
from qfluentwidgets import isDarkTheme

from base.BaseIcon import BaseIcon


class StatusColumnIconStrip:
    """状态列图标条工具类。

    统一承载状态列图标的排版、命中测试与缓存绘制能力。
    这样可以遵循“模块对外只暴露类”的准则，避免模块级函数直接对外扩散。
    """

    # 单图标缓存：主题 + DPR + 图标尺寸 + 图标名
    IconPixmapCache = dict[tuple[bool, int, int, str], QPixmap]
    # 图标条缓存：主题 + DPR + 尺寸参数 + 是否紧凑布局 + 图标序列
    IconStripPixmapCache = dict[
        tuple[bool, int, int, int, bool, tuple[str, ...]],
        QPixmap,
    ]

    @staticmethod
    def resolve_device_pixel_ratio(table: QTableView) -> float:
        """读取表格 DPR，失败时退回 1.0，避免生命周期边界抛错中断绘制。"""

        try:
            return float(table.devicePixelRatioF())
        except (AttributeError, TypeError, RuntimeError):
            return 1.0

    @staticmethod
    def get_icon_pixmap(
        table: QTableView,
        icon: BaseIcon,
        *,
        icon_size: int,
        cache: dict[tuple[bool, int, int, str], QPixmap],
    ) -> QPixmap:
        """获取单图标 pixmap 并缓存，避免滚动重绘时重复创建。"""

        is_dark = isDarkTheme()
        dpr = StatusColumnIconStrip.resolve_device_pixel_ratio(table)
        normalized_icon_size = max(1, int(icon_size))
        key = (is_dark, int(round(dpr * 100)), normalized_icon_size, icon.name)
        cached = cache.get(key)
        if cached is not None:
            return cached

        pixmap = icon.icon().pixmap(normalized_icon_size, normalized_icon_size)
        cache[key] = pixmap
        return pixmap

    @staticmethod
    def build_centered_icon_rects(
        cell_rect: QRect,
        *,
        icon_count: int,
        icon_size: int,
        icon_spacing: int,
        margin: int = 0,
    ) -> tuple[QRect, ...]:
        """在单元格内居中排布图标矩形，用于命中测试与单图绘制。"""

        count = max(0, int(icon_count))
        if count <= 0:
            return tuple()

        normalized_icon_size = max(1, int(icon_size))
        spacing = max(0, int(icon_spacing))
        adjusted_rect = cell_rect.adjusted(0, int(margin), 0, -int(margin))

        total_width = normalized_icon_size * count + spacing * (count - 1)
        x = adjusted_rect.x() + (adjusted_rect.width() - total_width) // 2
        y = adjusted_rect.y() + (adjusted_rect.height() - normalized_icon_size) // 2

        rects: list[QRect] = []
        for index in range(count):
            left = x + index * (normalized_icon_size + spacing)
            rects.append(QRect(left, y, normalized_icon_size, normalized_icon_size))
        return tuple(rects)

    @staticmethod
    def hit_test_icon_rects(pos: QPoint, icon_rects: tuple[QRect, ...]) -> int:
        """返回命中的图标索引，未命中返回 -1。"""

        for index, rect in enumerate(icon_rects):
            if rect.contains(pos):
                return index
        return -1

    @staticmethod
    def build_icon_strip_pixmap(
        table: QTableView,
        icons: Sequence[BaseIcon | None],
        *,
        icon_size: int,
        icon_spacing: int,
        compact: bool,
        cache: dict[tuple[bool, int, int, int, bool, tuple[str, ...]], QPixmap],
    ) -> QPixmap | None:
        """构建图标条 pixmap。

        compact=True：忽略空槽位，按可见图标紧凑排布。
        compact=False：保留空槽位，图标语义位置固定。
        """

        normalized_icon_size = max(1, int(icon_size))
        normalized_icon_spacing = max(0, int(icon_spacing))

        if compact:
            draw_slots: list[BaseIcon | None] = [
                icon for icon in icons if isinstance(icon, BaseIcon)
            ]
            key_icons = tuple(
                icon.name for icon in draw_slots if isinstance(icon, BaseIcon)
            )
        else:
            draw_slots = [
                icon if isinstance(icon, BaseIcon) else None for icon in icons
            ]
            key_icons = tuple(
                icon.name if isinstance(icon, BaseIcon) else "" for icon in draw_slots
            )

        slot_count = len(draw_slots)
        has_any_icon = any(isinstance(icon, BaseIcon) for icon in draw_slots)
        if slot_count <= 0 or not has_any_icon:
            return None

        is_dark = isDarkTheme()
        dpr = StatusColumnIconStrip.resolve_device_pixel_ratio(table)
        key = (
            is_dark,
            int(round(dpr * 100)),
            normalized_icon_size,
            normalized_icon_spacing,
            bool(compact),
            key_icons,
        )
        cached = cache.get(key)
        if cached is not None:
            return cached

        size_px = max(1, int(round(normalized_icon_size * dpr)))
        spacing_px = max(0, int(round(normalized_icon_spacing * dpr)))
        total_width_px = size_px * slot_count + spacing_px * (slot_count - 1)

        pixmap = QPixmap(total_width_px, size_px)
        pixmap.fill(Qt.GlobalColor.transparent)

        painter = QPainter(pixmap)
        for index, icon in enumerate(draw_slots):
            if not isinstance(icon, BaseIcon):
                continue
            left = index * (size_px + spacing_px)
            icon_pixmap = icon.icon().pixmap(size_px, size_px)
            painter.drawPixmap(left, 0, icon_pixmap)
        painter.end()

        try:
            pixmap.setDevicePixelRatio(dpr)
        except (AttributeError, TypeError, RuntimeError):
            # 设置 DPR 失败不影响显示，可安全忽略。
            pass

        cache[key] = pixmap
        return pixmap
