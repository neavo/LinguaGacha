from __future__ import annotations

from typing import cast

from PySide6.QtCore import QItemSelection
from PySide6.QtCore import QItemSelectionModel
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal
from PySide6.QtGui import QContextMenuEvent
from PySide6.QtGui import QFontMetrics
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHeaderView
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableView
from qfluentwidgets import getFont
from qfluentwidgets import setCustomStyleSheet

from base.BaseIcon import BaseIcon
from frontend.Proofreading.ProofreadingStatusDelegate import ProofreadingStatusDelegate
from frontend.Proofreading.ProofreadingTableModel import ProofreadingTableModel
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType


class ProofreadingTableWidget(TableView):
    """校对任务专用表格组件（TableView + QAbstractTableModel）。"""

    # 列索引常量
    COL_SRC = ProofreadingTableModel.COL_SRC
    COL_DST = ProofreadingTableModel.COL_DST
    COL_STATUS = ProofreadingTableModel.COL_STATUS

    # 布局常量
    FONT_SIZE = 12
    ROW_HEIGHT = 40
    COL_STATUS_WIDTH = 60
    ROW_NUMBER_MIN_WIDTH = 40

    # 右键菜单图标
    ICON_BATCH_RETRANSLATE: BaseIcon = BaseIcon.REFRESH_CW
    ICON_BATCH_RESET_TRANSLATION: BaseIcon = BaseIcon.ERASER

    # 信号定义：对外仅暴露必要交互。批量操作覆盖“单选=批量(1)”场景，避免信号语义重复。
    itemSelectionChanged = Signal()
    batch_retranslate_clicked = Signal(list)  # (items) 批量重新翻译
    batch_reset_translation_clicked = Signal(list)  # (items) 批量重置翻译

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        # 使用 QFluentWidgets 的字体族生成 QFont，避免 delegate 计算/绘制的 metrics 不一致导致下伸字母被裁剪。
        self.ui_font = getFont(self.FONT_SIZE)
        # 继承应用级 hinting 设置，避免出现狗牙/清晰度差异。
        self.ui_font.setHintingPreference(self.font().hintingPreference())

        # TableView 的默认 QSS 会用 `font: 13px --FontFamilies` 覆盖表头/序号字体；这里仅覆盖字号。
        header_qss = (
            "QHeaderView::section {\n"
            f"    font: {self.FONT_SIZE}px --FontFamilies;\n"
            "}\n"
        )
        setCustomStyleSheet(self, header_qss, header_qss)

        # 设置表格属性
        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        # 支持 Ctrl/Shift 多选和拖拽选择
        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)

        # 校对列表允许滚轮滚动。
        # 空态/未加载时隐藏滚动条；有数据后按需显示，便于快速定位。
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        # 禁用默认的双击编辑，改为双击弹出对话框
        self.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)

        # 先挂载 model，再配置 header 的列策略；否则在部分环境下可能触发 Qt access violation。
        self.table_model = ProofreadingTableModel(self.ui_font, self)
        self.setModel(self.table_model)

        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        v_header.setFixedWidth(self.ROW_NUMBER_MIN_WIDTH)
        self.setBorderVisible(False)

        # 文本拼接为单行显示
        self.setWordWrap(False)
        self.setTextElideMode(Qt.TextElideMode.ElideRight)
        # 固定行高避免 ResizeToContents 在滚动追加时反复测量导致卡顿。
        v_header.setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        v_header.setDefaultSectionSize(self.ROW_HEIGHT)
        v_header.setMinimumSectionSize(self.ROW_HEIGHT)

        # 设置列宽
        header = cast(QHeaderView, self.horizontalHeader())
        header.setSectionResizeMode(self.COL_SRC, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(self.COL_DST, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(self.COL_STATUS, QHeaderView.ResizeMode.Fixed)
        self.setColumnWidth(self.COL_STATUS, self.COL_STATUS_WIDTH)
        header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)

        # 只读模式标志
        self.readonly = False

        self.setAlternatingRowColors(True)

        self.status_delegate = ProofreadingStatusDelegate(self, self.COL_STATUS)
        self.setItemDelegate(self.status_delegate)

        selection_model = cast(QItemSelectionModel, self.selectionModel())
        selection_model.selectionChanged.connect(self.on_selection_changed)

    def on_selection_changed(
        self, selected: QItemSelection, deselected: QItemSelection
    ) -> None:
        del selected, deselected
        self.itemSelectionChanged.emit()

    # ========== 数据填充/更新 ==========
    def set_items(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        start_index: int = 0,
    ) -> None:
        """填充表格数据。

        与旧实现兼容：
        - items 为空时显示 30 行占位并禁用选择
        - start_index 用于垂直序号（通常为 0；旧分页逻辑会传入页起始索引）
        """

        # 空表格只用于占位展示，不接受焦点，避免禁用态点击时出现闪烁的焦点动效。
        if not items:
            self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            self.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
            self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        else:
            self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
            self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
            self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)

        self.table_model.set_readonly(self.readonly)
        self.table_model.set_data_source(items, warning_map, start_index)

        if not items:
            self.update_row_number_width(0)
        else:
            # 行号列宽度仅与真实数据最大行号相关；占位行的序号为空。
            self.update_row_number_width(start_index + len(items))

        self.scrollToTop()

    def update_row_number_width(self, max_label_value: int) -> None:
        digits = len(str(max(1, max_label_value)))
        metrics = QFontMetrics(self.ui_font)
        text_width = metrics.horizontalAdvance("9" * digits)
        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setFixedWidth(max(self.ROW_NUMBER_MIN_WIDTH, text_width + 16))

    def set_readonly(self, readonly: bool) -> None:
        """设置表格只读模式（用于屏蔽右键批量操作）。"""

        self.readonly = bool(readonly)
        self.table_model.set_readonly(self.readonly)

    def get_item_at_row(self, row: int) -> Item | None:
        """获取指定行绑定的 Item 对象（可见行）。"""

        index = self.table_model.index(row, self.COL_SRC)
        if not index.isValid():
            return None
        item = index.data(ProofreadingTableModel.ITEM_ROLE)
        return item if isinstance(item, Item) else None

    def find_row_by_item(self, item: Item) -> int:
        """根据 Item 对象查找行索引（绝对行号，O(1)）。"""

        return self.table_model.find_row_by_item(item)

    def update_row_dst(self, row: int, new_dst: str) -> None:
        """更新指定行的译文（通过 dataChanged 精准刷新）。"""

        del new_dst
        # DisplayRole 的 compact 缓存依赖 dst 内容；dst 变更时需精确失效。
        self.table_model.invalidate_display_cache_by_row(row, dst=True)
        index = self.table_model.index(row, self.COL_DST)
        if not index.isValid():
            return
        self.table_model.dataChanged.emit(
            index, index, [int(Qt.ItemDataRole.DisplayRole)]
        )

    def update_row_status(self, row: int, warnings: list[WarningType]) -> None:
        """更新指定行的状态/告警图标（通过更新 warning_map + dataChanged 刷新）。"""

        item = self.table_model.get_source_item(row)
        if item is None:
            return

        self.table_model.set_item_warnings(item, warnings)
        index = self.table_model.index(row, self.COL_STATUS)
        if not index.isValid():
            return
        self.table_model.dataChanged.emit(
            index,
            index,
            [
                int(ProofreadingTableModel.STATUS_ROLE),
                int(ProofreadingTableModel.WARNINGS_ROLE),
            ],
        )

    # ========== 选择 ==========

    def get_selected_items(self) -> list[Item]:
        """获取所有选中行对应的 Item 对象。"""

        selection_model = self.selectionModel()
        if selection_model is None:
            return []

        selection = selection_model.selection()
        if selection.isEmpty():
            return []

        # 避免 selectedIndexes()：全选时会返回 rows * cols 个 index，容易导致卡顿。
        items: list[Item] = []
        seen_rows: set[int] = set()
        for selection_range in selection:
            top = int(selection_range.top())
            bottom = int(selection_range.bottom())
            for row in range(top, bottom + 1):
                if row in seen_rows:
                    continue
                seen_rows.add(row)
                item = self.get_item_at_row(row)
                if item:
                    items.append(item)
        return items

    def get_selected_row(self) -> int:
        """获取当前选中的首行索引（绝对行号）。"""

        selection_model = self.selectionModel()
        if selection_model is None:
            return -1

        selection = selection_model.selection()
        if selection.isEmpty():
            return -1

        # selection 内部是 range 列表；取最小 top 即可，避免枚举所有行。
        selected_row = None
        for selection_range in selection:
            top = int(selection_range.top())
            selected_row = top if selected_row is None else min(selected_row, top)
        return int(selected_row) if selected_row is not None else -1

    # ========== 右键菜单 ==========
    def contextMenuEvent(self, a0: QContextMenuEvent | None) -> None:  # noqa: N802
        if a0 is None:
            return
        if self.readonly:
            return

        # indexAt 需要 viewport 坐标。
        viewport = self.viewport()
        if viewport is None:
            return
        pos = viewport.mapFromGlobal(a0.globalPos())
        index = self.indexAt(pos)
        if index.isValid():
            placeholder = index.data(ProofreadingTableModel.PLACEHOLDER_ROLE)
            if bool(placeholder):
                return

            row = index.row()
            selection_model = self.selectionModel()
            if selection_model is not None and not selection_model.isRowSelected(
                row, QModelIndex()
            ):
                self.selectRow(row)

        selected_items = self.get_selected_items()
        if not selected_items:
            return

        menu = RoundMenu(parent=self)
        menu.addAction(
            Action(
                self.ICON_BATCH_RETRANSLATE,
                Localizer.get().proofreading_page_batch_retranslate,
                triggered=lambda checked: self.batch_retranslate_clicked.emit(
                    selected_items
                ),
            )
        )
        menu.addAction(
            Action(
                self.ICON_BATCH_RESET_TRANSLATION,
                Localizer.get().proofreading_page_batch_reset_translation,
                triggered=lambda checked: self.batch_reset_translation_clicked.emit(
                    selected_items
                ),
            )
        )
        menu.exec(a0.globalPos())
