import threading

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CaptionLabel
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import IndeterminateProgressRing
from qfluentwidgets import MessageBox

from base.Base import Base
from frontend.Proofreading.FilterDialog import FilterDialog
from frontend.Proofreading.PaginationBar import PaginationBar
from frontend.Proofreading.ProofreadingTableWidget import ProofreadingTableWidget
from model.Item import Item
from module.CacheManager import CacheManager
from module.Config import Config
from module.Engine.Engine import Engine
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard

class ProofreadingPage(QWidget, Base):
    """校对任务主页面"""

    # 信号定义
    items_loaded = pyqtSignal(list)             # 数据加载完成信号
    translate_done = pyqtSignal(object, bool)   # 翻译完成信号

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 成员变量
        self.window = window
        self.items: list[Item] = []                         # 全量数据
        self.filtered_items: list[Item] = []                # 筛选后数据
        self.warning_map: dict[int, list[WarningType]] = {} # 警告映射表
        self.is_readonly: bool = False                      # 只读模式标志
        self.config: Config | None = None                   # 配置
        self.filter_options: dict = {}                      # 当前筛选选项
        self.search_keyword: str = ""                       # 当前搜索关键词

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 添加控件
        self.add_widget_body(self.root, window)
        self.add_widget_foot(self.root, window)

        # 注册事件
        self.subscribe(Base.Event.TRANSLATION_RUN, self._on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_UPDATE, self._on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_DONE, self._on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_REQUIRE_STOP, self._on_engine_status_changed)

        # 连接信号
        self.items_loaded.connect(self._on_items_loaded_ui)
        self.translate_done.connect(self._on_translate_done_ui)

    # ========== 主体：表格 ==========
    def add_widget_body(self, parent: QLayout, window: FluentWindow) -> None:
        """添加主体控件"""
        # 表格
        self.table_widget = ProofreadingTableWidget()
        self.table_widget.cell_edited.connect(self._on_cell_edited)
        self.table_widget.retranslate_clicked.connect(self._on_retranslate_clicked)
        self.table_widget.copy_src_clicked.connect(self._on_copy_src_clicked)
        self.table_widget.copy_dst_clicked.connect(self._on_copy_dst_clicked)
        # 初始化显示空行
        self.table_widget.set_items([], {})

        parent.addWidget(self.table_widget, 1)

    # ========== 底部：命令栏 ==========
    def add_widget_foot(self, parent: QLayout, window: FluentWindow) -> None:
        """添加底部控件"""
        # 搜索栏（默认隐藏）
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        def back_clicked(widget: SearchCard) -> None:
            self._on_search_back_clicked()
        self.search_card.on_back_clicked(back_clicked)

        def next_clicked(widget: SearchCard) -> None:
            self._on_search_next_clicked(widget.get_line_edit().text().strip())
        self.search_card.on_next_clicked(next_clicked)

        # 命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.command_bar_card.set_minimum_width(640)

        # 加载按钮
        self.btn_load = self.command_bar_card.add_action(
            Action(FluentIcon.DOWNLOAD, Localizer.get().proofreading_page_load, triggered=self._on_load_clicked)
        )

        # 保存按钮
        self.btn_save = self.command_bar_card.add_action(
            Action(FluentIcon.SAVE, Localizer.get().proofreading_page_save, triggered=self._on_save_clicked)
        )
        self.btn_save.setEnabled(False)

        # 导出按钮
        self.btn_export = self.command_bar_card.add_action(
            Action(FluentIcon.SHARE, Localizer.get().proofreading_page_export, triggered=self._on_export_clicked)
        )
        self.btn_export.setEnabled(False)

        self.command_bar_card.add_separator()

        # 搜索按钮
        self.btn_search = self.command_bar_card.add_action(
            Action(FluentIcon.SEARCH, Localizer.get().proofreading_page_search, triggered=self._on_search_clicked)
        )
        self.btn_search.setEnabled(False)

        # 筛选按钮
        self.btn_filter = self.command_bar_card.add_action(
            Action(FluentIcon.FILTER, Localizer.get().proofreading_page_filter, triggered=self._on_filter_clicked)
        )
        self.btn_filter.setEnabled(False)

        self.command_bar_card.add_separator()

        # 分页控件（放在左侧，添加到 CommandBar 内部以紧贴分隔符）
        self.pagination_bar = PaginationBar()
        self.pagination_bar.page_changed.connect(self._on_page_changed)
        self.command_bar_card.add_widget_to_command_bar(self.pagination_bar)

        # 弹性空间（将右侧的 loading 指示器顶到最右侧）
        self.command_bar_card.add_stretch(1)

        # Loading 指示器（右下角）
        self.info_label = CaptionLabel("", self)
        self.info_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.info_label.hide()

        self.indeterminate = IndeterminateProgressRing()
        self.indeterminate.setFixedSize(16, 16)
        self.indeterminate.setStrokeWidth(3)
        self.indeterminate.hide()

        self.command_bar_card.add_widget(self.info_label)
        self.command_bar_card.add_spacing(4)
        self.command_bar_card.add_widget(self.indeterminate)

    # ========== 加载功能 ==========
    def _on_load_clicked(self) -> None:
        """加载按钮点击"""
        # 显示 loading 指示器
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)
        self.load_data()

    def load_data(self) -> None:
        """加载缓存数据"""

        def task() -> None:
            try:
                self.config = Config().load()
                cache_manager = CacheManager(service=False)
                cache_manager.load_items_from_file(self.config.output_folder)
                items = cache_manager.get_items()
                # 过滤掉原文为空的条目
                items = [i for i in items if i.get_src().strip()]

                if not items:
                    self.emit(Base.Event.TOAST, {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().proofreading_page_no_cache,
                    })
                    self.items_loaded.emit([])
                    return

                checker = ResultChecker(self.config, items)
                warning_map = checker.get_check_results(items)

                self.items = items
                self.warning_map = warning_map
                self.filter_options = {}

                self.items_loaded.emit(items)

            except Exception as e:
                self.error(f"{Localizer.get().proofreading_page_load_failed}", e)
                self.emit(Base.Event.TOAST, {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().proofreading_page_load_failed,
                })
                self.items_loaded.emit([])

        threading.Thread(target=task, daemon=True).start()

    def _on_items_loaded_ui(self, items: list[Item]) -> None:
        """数据加载完成的 UI 更新（主线程）"""
        # 隐藏 loading 指示器
        self.indeterminate_hide()

        if items:
            self._apply_filter()
        else:
            # 清空数据并显示占位符
            self.table_widget.set_items([], {})
            self.pagination_bar.reset()

        self._check_engine_status()

    # ========== 筛选功能 ==========
    def _on_filter_clicked(self) -> None:
        """筛选按钮点击"""
        if not self.items:
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().proofreading_page_no_cache,
            })
            return

        dialog = FilterDialog(self.items, self.window)
        dialog.set_filter_options(self.filter_options)

        if dialog.exec():
            self.filter_options = dialog.get_filter_options()
            self._apply_filter()

    def _apply_filter(self) -> None:
        """应用筛选条件"""
        warning_types = self.filter_options.get(FilterDialog.KEY_WARNING_TYPES)
        statuses = self.filter_options.get(FilterDialog.KEY_STATUSES)
        file_paths = self.filter_options.get(FilterDialog.KEY_FILE_PATHS)
        search_text = self.search_keyword.lower()

        filtered = []
        for item in self.items:
            # 排除掉 已排除 和 重复条目
            if item.get_status() in (Base.ProjectStatus.EXCLUDED, Base.ProjectStatus.DUPLICATED):
                continue
            # 警告类型筛选
            if warning_types is not None:
                item_warnings = self.warning_map.get(id(item), [])

                if item_warnings:
                    # 条目有警告：检查其警告是否在选中的警告类型中
                    if not any(e in warning_types for e in item_warnings):
                        continue
                else:
                    # 条目无警告：检查是否勾选了“无警告”
                    if FilterDialog.NO_WARNING_TAG not in warning_types:
                        continue

            # 翻译状态筛选
            if statuses is not None:
                if item.get_status() not in statuses:
                    continue

            # 文件筛选
            if file_paths is not None:
                if item.get_file_path() not in file_paths:
                    continue

            # 搜索过滤
            if search_text:
                src_match = search_text in item.get_src().lower()
                dst_match = search_text in item.get_dst().lower()
                if not (src_match or dst_match):
                    continue

            filtered.append(item)

        self.filtered_items = filtered
        self.pagination_bar.set_total(len(filtered))
        self.pagination_bar.set_page(1)
        self._render_page(1)

    # ========== 搜索功能 ==========
    def _on_search_clicked(self) -> None:
        """搜索按钮点击"""
        self.search_card.setVisible(True)
        self.command_bar_card.setVisible(False)

    def _on_search_back_clicked(self) -> None:
        """搜索栏返回点击"""
        self.search_keyword = ""
        self.search_card.setVisible(False)
        self.command_bar_card.setVisible(True)
        self._apply_filter()

    def _on_search_next_clicked(self, keyword: str) -> None:
        """搜索栏确认/下一个点击"""
        if not keyword:
            return
        self.search_keyword = keyword
        self._apply_filter()

    # ========== 分页渲染 ==========
    def _on_page_changed(self, page: int) -> None:
        """页码变化"""
        self._render_page(page)

    def _render_page(self, page_num: int) -> None:
        """渲染指定页的数据"""
        page_size = self.pagination_bar.get_page_size()
        start_idx = (page_num - 1) * page_size
        end_idx = start_idx + page_size

        page_items = self.filtered_items[start_idx:end_idx]
        page_warning_map = {id(item): self.warning_map.get(id(item), []) for item in page_items}

        self.table_widget.set_items(page_items, page_warning_map)

    # ========== 编辑功能 ==========
    def _on_cell_edited(self, item: Item, new_dst: str) -> None:
        """单元格编辑完成"""
        if self.is_readonly:
            return

        # 始终更新和检查，确保状态一致
        item.set_dst(new_dst)

        # 如果译文不为空，且当前状态不是已处理状态，则强制更新为 PROCESSED
        # 这确保了手工修改的 排重/已排除 条目在导出时被视为有效翻译
        if new_dst and item.get_status() not in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.PROCESSED_IN_PAST):
            item.set_status(Base.ProjectStatus.PROCESSED)

        self._recheck_item(item)

    def _recheck_item(self, item: Item) -> None:
        """重新检查单个条目"""
        if not self.config:
            return

        checker = ResultChecker(self.config, [item])
        warnings = checker.check_single_item(item)

        if warnings:
            self.warning_map[id(item)] = warnings
        else:
            self.warning_map.pop(id(item), None)

        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.update_row_status(row, warnings)

    def _on_copy_src_clicked(self, item: Item) -> None:
        """复制原文到剪贴板"""
        clipboard = QApplication.clipboard()
        clipboard.setText(item.get_src())

        self.emit(Base.Event.TOAST, {
            "type": Base.ToastType.SUCCESS,
            "message": Localizer.get().proofreading_page_copy_src_done,
        })

    def _on_copy_dst_clicked(self, item: Item) -> None:
        """复制译文到剪贴板"""
        clipboard = QApplication.clipboard()
        clipboard.setText(item.get_dst())

        self.emit(Base.Event.TOAST, {
            "type": Base.ToastType.SUCCESS,
            "message": Localizer.get().proofreading_page_copy_dst_done,
        })

    # ========== 重新翻译功能 ==========
    def _on_retranslate_clicked(self, item: Item) -> None:
        """重新翻译按钮点击"""
        if self.is_readonly or not self.config:
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_retranslate_confirm,
            self.window
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.set_row_loading(row, True)

        item.set_status(Base.ProjectStatus.NONE)
        item.set_retry_count(0)

        Engine.get().translate_single_item(
            item=item,
            config=self.config,
            callback=lambda i, s: self.translate_done.emit(i, s)
        )

    def _on_translate_done_ui(self, item: Item, success: bool) -> None:
        """翻译完成的 UI 更新（主线程）"""
        row = self.table_widget.find_row_by_item(item)
        if row < 0:
            return

        self.table_widget.set_row_loading(row, False)

        if success:
            self.table_widget.update_row_dst(row, item.get_dst())
            self._recheck_item(item)

            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_retranslate_success,
            })
        else:
            item.set_status(Base.ProjectStatus.PROCESSED)
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.ERROR,
                "message": Localizer.get().proofreading_page_retranslate_failed,
            })

    # ========== 保存功能 ==========
    def _on_save_clicked(self) -> None:
        """保存按钮点击"""
        # 显示 loading 指示器
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()
        # 延迟隐藏，让用户看到保存提示
        QTimer.singleShot(1000, self.indeterminate_hide)

    def save_data(self) -> bool:
        """保存数据到缓存文件"""
        if self.is_readonly or not self.config or not self.items:
            return False

        try:
            cache_manager = CacheManager(service=False)
            cache_manager.set_items(self.items)
            cache_manager.load_project_from_file(self.config.output_folder)
            cache_manager.save_to_file(
                project=cache_manager.get_project(),
                items=self.items,
                output_folder=self.config.output_folder
            )

            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_save_success,
            })
            return True

        except Exception as e:
            self.error(f"{Localizer.get().proofreading_page_save_failed}", e)
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.ERROR,
                "message": Localizer.get().proofreading_page_save_failed,
            })
            return False

    # ========== 导出功能 ==========
    def _on_export_clicked(self) -> None:
        """导出按钮点击"""
        # 显示 loading 指示器
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_exporting)
        self.export_data()
        # 延迟隐藏，让用户看到导出提示
        QTimer.singleShot(1000, self.indeterminate_hide)

    def export_data(self) -> None:
        """导出数据"""
        if not self.config or not self.items:
            return

        try:
            FileManager(self.config).write_to_path(self.items)
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_export_success,
            })
        except Exception as e:
            self.error("Export failed", e)
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.ERROR,
                "message": str(e),
            })

    # ========== 只读模式控制 ==========
    def _on_engine_status_changed(self, event: Base.Event, data: dict) -> None:
        """Engine 状态变更事件"""
        self._check_engine_status()

    def _check_engine_status(self) -> None:
        """检查并更新只读模式"""
        engine_status = Engine.get().get_status()
        is_busy = engine_status in (Base.TaskStatus.TRANSLATING, Base.TaskStatus.STOPPING)

        # 1. 如果处于翻译中/停止中，清空页面数据
        if is_busy and self.items:
            self.items = []
            self.filtered_items = []
            self.warning_map = {}
            self.table_widget.set_items([], {})
            self.pagination_bar.reset()

        # 2. 更新按钮状态
        has_items = bool(self.items)

        # 加载按钮在繁忙时禁用
        self.btn_load.setEnabled(not is_busy)

        # 其他按钮只有在不繁忙且有数据时启用
        can_operate = not is_busy and has_items
        self.btn_save.setEnabled(can_operate)
        self.btn_export.setEnabled(can_operate)
        self.btn_search.setEnabled(can_operate)
        self.btn_filter.setEnabled(can_operate)

        if is_busy != self.is_readonly:
            self.is_readonly = is_busy
            self.table_widget.set_readonly(is_busy)

    def showEvent(self, event) -> None:
        """页面显示事件"""
        super().showEvent(event)
        self._check_engine_status()

    # ========== Loading 指示器 ==========
    def indeterminate_show(self, msg: str) -> None:
        """显示 loading 指示器"""
        self.indeterminate.show()
        self.info_label.show()
        self.info_label.setText(msg)

    def indeterminate_hide(self) -> None:
        """隐藏 loading 指示器"""
        self.indeterminate.hide()
        self.info_label.hide()
        self.info_label.setText("")
