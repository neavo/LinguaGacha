from __future__ import annotations

from typing import Any
from typing import cast

from PyQt5.QtCore import QAbstractItemModel
from PyQt5.QtCore import QAbstractProxyModel
from PyQt5.QtCore import QEvent
from PyQt5.QtCore import QModelIndex
from PyQt5.QtCore import QPoint
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QContextMenuEvent
from PyQt5.QtGui import QFontMetrics
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import TableView
from qfluentwidgets import getFont
from qfluentwidgets import setCustomStyleSheet

from widget.AppTable.ColumnSpec import ColumnSpec


class AppTableView(TableView):
    FONT_SIZE: int = 12
    ROW_HEIGHT: int = 40
    ROW_NUMBER_MIN_WIDTH: int = 40

    itemSelectionChanged = pyqtSignal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        self.readonly: bool = False

        self.ui_font = getFont(self.FONT_SIZE)
        self.ui_font.setHintingPreference(self.font().hintingPreference())

        header_qss = (
            "QHeaderView::section {\n"
            f"    font: {self.FONT_SIZE}px --FontFamilies;\n"
            "}\n"
        )
        setCustomStyleSheet(self, header_qss, header_qss)

        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.setEditTriggers(QAbstractItemView.EditTrigger.DoubleClicked)

        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        self.setAlternatingRowColors(True)
        self.setBorderVisible(False)
        self.setWordWrap(False)
        self.setTextElideMode(Qt.TextElideMode.ElideRight)

        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setVisible(True)
        v_header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        v_header.setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        v_header.setDefaultSectionSize(self.ROW_HEIGHT)
        v_header.setMinimumSectionSize(self.ROW_HEIGHT)
        v_header.setFixedWidth(self.ROW_NUMBER_MIN_WIDTH)

        h_header = cast(QHeaderView, self.horizontalHeader())
        h_header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)

        self._selection_model = None

    def event(self, event: QEvent) -> bool:  # noqa: N802
        # Qt.CustomContextMenu 策略下，QWidget 默认实现会直接 emit customContextMenuRequested。
        # 为了保证右键菜单前“先选中真实行”，且在占位行上不弹出菜单，这里统一在 event 层拦截。
        if event.type() == QEvent.Type.ContextMenu and isinstance(
            event, QContextMenuEvent
        ):
            # 只处理鼠标右键触发；键盘/程序触发仍交给各页面自行决定。
            if event.reason() == QContextMenuEvent.Reason.Mouse:
                row = self.select_row_at_global_pos(event.globalPos())
                if row < 0:
                    return True
        return super().event(event)

    def set_readonly(self, readonly: bool) -> None:
        self.readonly = bool(readonly)
        model = self.model()
        if model is not None:
            model_any: Any = model
            set_readonly = getattr(model_any, "set_readonly", None)
            if callable(set_readonly):
                set_readonly(self.readonly)

        viewport = self.viewport()
        if viewport is not None:
            viewport.update()

    def get_proxy_model(self) -> QAbstractProxyModel | None:
        model = self.model()
        return model if isinstance(model, QAbstractProxyModel) else None

    def get_source_model(self) -> QAbstractItemModel | None:
        model = self.model()
        while isinstance(model, QAbstractProxyModel):
            model = model.sourceModel()
        return model

    def map_view_index_to_source_index(self, index: QModelIndex) -> QModelIndex:
        model = self.model()
        while isinstance(model, QAbstractProxyModel):
            index = model.mapToSource(index)
            model = model.sourceModel()
        return index

    def map_source_index_to_view_index(self, index: QModelIndex) -> QModelIndex:
        model = self.model()
        proxies: list[QAbstractProxyModel] = []
        while isinstance(model, QAbstractProxyModel):
            proxies.append(model)
            model = model.sourceModel()

        for proxy in reversed(proxies):
            index = proxy.mapFromSource(index)
        return index

    def map_source_row_to_view_row(
        self, source_model: QAbstractItemModel, row: int
    ) -> int:
        source_index = source_model.index(int(row), 0)
        if not source_index.isValid():
            return -1

        view_index = self.map_source_index_to_view_index(source_index)
        return int(view_index.row()) if view_index.isValid() else -1

    def get_current_source_row(self) -> int:
        index = self.currentIndex()
        if not index.isValid():
            return -1
        source_index = self.map_view_index_to_source_index(index)
        return int(source_index.row()) if source_index.isValid() else -1

    def get_selected_source_rows(self) -> list[int]:
        selection_model = self.selectionModel()
        if selection_model is None:
            return []

        rows: set[int] = set()
        for view_index in selection_model.selectedRows():
            source_index = self.map_view_index_to_source_index(view_index)
            if not source_index.isValid():
                continue
            rows.add(int(source_index.row()))
        return sorted(rows)

    def _get_source_index_at_view_row(self, view_row: int) -> QModelIndex | None:
        model = self.model()
        if model is None:
            return None
        view_index = model.index(int(view_row), 0)
        if not view_index.isValid():
            return None
        source_index = self.map_view_index_to_source_index(view_index)
        return source_index if source_index.isValid() else None

    def set_start_index(self, start_index: int) -> None:
        model = self.model()
        if model is None:
            return
        model_any: Any = model
        set_start_index = getattr(model_any, "set_start_index", None)
        if callable(set_start_index):
            set_start_index(start_index)

    def set_min_rows(self, min_rows: int) -> None:
        model = self.model()
        if model is None:
            return
        model_any: Any = model
        set_min_rows = getattr(model_any, "set_min_rows", None)
        if callable(set_min_rows):
            set_min_rows(min_rows)

    def apply_column_specs(self, columns: list[ColumnSpec]) -> None:
        header = cast(QHeaderView, self.horizontalHeader())
        for col, spec in enumerate(columns):
            if spec.width_mode == ColumnSpec.WidthMode.STRETCH:
                header.setSectionResizeMode(col, QHeaderView.ResizeMode.Stretch)
                continue

            header.setSectionResizeMode(col, QHeaderView.ResizeMode.Fixed)
            if spec.width > 0:
                self.setColumnWidth(col, int(spec.width))

    def setModel(self, model) -> None:  # noqa: N802, ANN001
        super().setModel(model)

        selection_model = self.selectionModel()
        if self._selection_model is not None:
            try:
                self._selection_model.selectionChanged.disconnect(
                    self._on_selection_changed
                )
            except TypeError:
                pass
        self._selection_model = selection_model
        if selection_model is not None:
            selection_model.selectionChanged.connect(self._on_selection_changed)

    def _on_selection_changed(self, selected, deselected) -> None:  # noqa: ANN001
        del selected, deselected
        self.itemSelectionChanged.emit()

    def update_row_number_width(self, max_label_value: int) -> None:
        digits = len(str(max(1, int(max_label_value))))
        metrics = QFontMetrics(self.ui_font)
        text_width = metrics.horizontalAdvance("9" * digits)
        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setFixedWidth(max(self.ROW_NUMBER_MIN_WIDTH, text_width + 16))

    def get_selected_row(self) -> int:
        selection_model = self.selectionModel()
        if selection_model is None:
            return -1

        selection = selection_model.selection()
        if selection.isEmpty():
            return -1

        selected_row = None
        for selection_range in selection:
            top = int(selection_range.top())
            selected_row = top if selected_row is None else min(selected_row, top)
        return int(selected_row) if selected_row is not None else -1

    def get_selected_row_object(self) -> object | None:
        row = self.get_selected_row()
        if row < 0:
            return None

        source_model = self.get_source_model()
        if source_model is None:
            return None

        role = getattr(source_model, "ROW_OBJECT_ROLE", None)
        if not isinstance(role, int):
            return None

        source_index = self._get_source_index_at_view_row(row)
        if source_index is None:
            return None
        return source_index.data(role)

    def get_selected_row_key(self) -> object | None:
        row = self.get_selected_row()
        if row < 0:
            return None

        source_model = self.get_source_model()
        if source_model is None:
            return None

        role = getattr(source_model, "ROW_KEY_ROLE", None)
        if not isinstance(role, int):
            return None

        source_index = self._get_source_index_at_view_row(row)
        if source_index is None:
            return None
        return source_index.data(role)

    def is_placeholder_row(self, row: int) -> bool:
        source_model = self.get_source_model()
        if source_model is None:
            return False

        role = getattr(source_model, "PLACEHOLDER_ROLE", None)
        if not isinstance(role, int):
            return False

        source_index = self._get_source_index_at_view_row(row)
        if source_index is None:
            return False
        return bool(source_index.data(role))

    def scroll_to_row(
        self,
        row: int,
        *,
        hint: QAbstractItemView.ScrollHint = QAbstractItemView.ScrollHint.PositionAtCenter,
    ) -> None:
        model = self.model()
        if model is None:
            return
        if row < 0 or row >= model.rowCount():
            return
        index = model.index(row, 0)
        if not index.isValid():
            return
        self.scrollTo(index, hint)

    def select_row_at_global_pos(self, global_pos: QPoint) -> int:
        viewport = self.viewport()
        if viewport is None:
            return -1
        pos = viewport.mapFromGlobal(global_pos)
        index = self.indexAt(pos)
        if not index.isValid():
            return -1

        row = index.row()
        if self.is_placeholder_row(row):
            return -1

        selection_model = self.selectionModel()
        if selection_model is not None and not selection_model.isRowSelected(
            row, QModelIndex()
        ):
            self.selectRow(row)
        return row

    def contextMenuEvent(self, a0: QContextMenuEvent | None) -> None:  # noqa: N802
        if a0 is None:
            return

        # event() 已统一处理：鼠标触发时右键先选中真实行，占位行直接吞掉。
        super().contextMenuEvent(a0)
