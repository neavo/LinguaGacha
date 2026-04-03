from __future__ import annotations

from typing import Any
from typing import cast

from PySide6.QtCore import QAbstractTableModel
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QObject
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont

from model.Api.ProofreadingModels import ProofreadingItemView
from module.Localizer.Localizer import Localizer


class ProofreadingTableModel(QAbstractTableModel):
    """校对页表格 Model。

    设计目标：
    - 不创建任何 per-row QWidget，避免快速翻页/滚动时的对象风暴。
    - 通过自定义 roles 为 Delegate 提供绘制所需数据（status/warnings）。
    - 不做分段加载：Qt 的 view 本身具备虚拟化能力，仅在可视区域请求 data()。
    """

    # ========== 列索引常量 ==========
    COL_SRC: int = 0
    COL_DST: int = 1
    COL_STATUS: int = 2
    COL_COUNT: int = 3

    # ========== 自定义 roles ==========
    # Qt.UserRole 常量在 stubs 中可能缺失，这里直接使用其数值以保证类型检查通过。
    USER_ROLE_BASE: int = 0x0100
    ITEM_ROLE: int = USER_ROLE_BASE + 1
    STATUS_ROLE: int = USER_ROLE_BASE + 2
    WARNINGS_ROLE: int = USER_ROLE_BASE + 3
    PLACEHOLDER_ROLE: int = USER_ROLE_BASE + 4

    # ========== 行与加载策略 ==========
    PLACEHOLDER_ROWS: int = 30

    def __init__(self, ui_font: QFont, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ui_font = ui_font
        self.readonly: bool = False
        self.start_index: int = 0

        self.source_items: list[ProofreadingItemView] = []
        self.row_by_item_key: dict[int | str, int] = {}

        # DisplayRole 热路径缓存：按需缓存 compact 结果，避免滚动重绘时重复计算/分配。
        self.display_src_cache: dict[int, str] = {}
        self.display_dst_cache: dict[int, str] = {}

    # ========== 数据源与状态 ==========
    def set_data_source(
        self,
        items: list[ProofreadingItemView],
        start_index: int = 0,
    ) -> None:
        self.beginResetModel()
        self.source_items = list(items)
        self.start_index = max(0, int(start_index))
        self.row_by_item_key = {
            item.item_id: i for i, item in enumerate(self.source_items)
        }

        # 数据源切换意味着所有派生缓存均失效。
        self.display_src_cache.clear()
        self.display_dst_cache.clear()
        self.endResetModel()

    def invalidate_display_cache_by_row(
        self, row: int, *, src: bool = False, dst: bool = False
    ) -> None:
        item = self.get_source_item(row)
        if item is None:
            return
        key = item.item_id
        if src:
            self.display_src_cache.pop(key, None)
        if dst:
            self.display_dst_cache.pop(key, None)

    def set_readonly(self, readonly: bool) -> None:
        self.readonly = bool(readonly)

    def total_count(self) -> int:
        return len(self.source_items)

    def find_row_by_item(self, item: ProofreadingItemView) -> int:
        return self.row_by_item_key.get(item.item_id, -1)

    def get_source_item(self, row: int) -> ProofreadingItemView | None:
        if row < 0 or row >= len(self.source_items):
            return None
        return self.source_items[row]

    def is_placeholder_row(self, row: int) -> bool:
        return row < 0 or row >= len(self.source_items)

    # ========== Qt Model 接口 ==========
    def rowCount(self, parent: QModelIndex = QModelIndex()) -> int:  # noqa: N802
        del parent
        # 保持表格高度稳定：真实行数不足时补齐占位行。
        return max(len(self.source_items), self.PLACEHOLDER_ROWS)

    def columnCount(self, parent: QModelIndex = QModelIndex()) -> int:  # noqa: N802
        del parent
        return self.COL_COUNT

    def headerData(
        self,
        section: int,
        orientation: Qt.Orientation,
        role: int = Qt.ItemDataRole.DisplayRole,
    ) -> Any:  # noqa: ANN401
        if role != Qt.ItemDataRole.DisplayRole:
            return None

        if orientation == Qt.Orientation.Horizontal:
            headers = (
                Localizer.get().table_col_source,
                Localizer.get().table_col_translation,
                Localizer.get().proofreading_page_col_status,
            )
            if 0 <= section < len(headers):
                return headers[section]
            return None

        if self.is_placeholder_row(section):
            return ""
        return str(self.start_index + section + 1)

    def flags(self, index: QModelIndex) -> Qt.ItemFlags:  # noqa: N802
        if not index.isValid():
            return cast(Qt.ItemFlags, Qt.ItemFlag.NoItemFlags)

        if self.is_placeholder_row(index.row()):
            # 占位行：保持 enabled 以维持样式，但不允许选中/编辑。
            return cast(Qt.ItemFlags, Qt.ItemFlag.ItemIsEnabled)

        flags = Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable
        if index.column() == self.COL_DST and not self.readonly:
            flags = flags | Qt.ItemFlag.ItemIsEditable
        return cast(Qt.ItemFlags, flags)

    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole) -> Any:  # noqa: ANN401, N802
        if not index.isValid():
            return None

        row = index.row()
        if self.is_placeholder_row(row):
            if role == self.PLACEHOLDER_ROLE:
                return True
            if role in (self.ITEM_ROLE, self.STATUS_ROLE):
                return None
            if role == self.WARNINGS_ROLE:
                return tuple()
            if role == Qt.ItemDataRole.DisplayRole:
                return ""
            if role == Qt.ItemDataRole.FontRole:
                return self.ui_font
            if role == Qt.ItemDataRole.TextAlignmentRole:
                if index.column() == self.COL_STATUS:
                    return Qt.AlignmentFlag.AlignCenter
                return Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
            return None

        item = self.source_items[row]

        if role == self.ITEM_ROLE:
            return item
        if role == self.STATUS_ROLE:
            return item.status
        if role == self.WARNINGS_ROLE:
            return item.warnings
        if role == self.PLACEHOLDER_ROLE:
            return False
        if role == Qt.ItemDataRole.FontRole:
            return self.ui_font
        if role == Qt.ItemDataRole.TextAlignmentRole:
            if index.column() == self.COL_STATUS:
                return Qt.AlignmentFlag.AlignCenter
            return Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft

        if role != Qt.ItemDataRole.DisplayRole:
            return None

        if index.column() == self.COL_SRC:
            key = item.item_id
            cached = self.display_src_cache.get(key)
            if cached is not None:
                return cached
            text = self.compact_multiline_text(item.src)
            self.display_src_cache[key] = text
            return text
        if index.column() == self.COL_DST:
            key = item.item_id
            cached = self.display_dst_cache.get(key)
            if cached is not None:
                return cached
            text = self.compact_multiline_text(item.dst)
            self.display_dst_cache[key] = text
            return text
        return ""

    # ========== 文本展示工具 ==========
    @staticmethod
    def compact_multiline_text(text: str) -> str:
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        parts = [part.strip() for part in normalized.split("\n") if part.strip()]
        return " ↲ ".join(parts)
