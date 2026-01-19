import re
import threading

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QShowEvent
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from frontend.Proofreading.FilterDialog import FilterDialog
from frontend.Proofreading.PaginationBar import PaginationBar
from frontend.Proofreading.ProofreadingTableWidget import ProofreadingTableWidget
from model.Item import Item
from module.Config import Config
from module.Engine.Engine import Engine
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from module.SessionContext import SessionContext
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard


class ProofreadingPage(QWidget, Base):
    """校对任务主页面"""

    # 信号定义
    items_loaded = pyqtSignal(list)  # 数据加载完成信号
    translate_done = pyqtSignal(object, bool)  # 翻译完成信号
    save_done = pyqtSignal(bool)  # 保存完成信号
    export_done = pyqtSignal(bool, str)  # 导出完成信号 (success, error_msg)
    progress_updated = pyqtSignal(
        str, int, int
    )  # 进度更新信号 (content, current, total)
    progress_finished = pyqtSignal()  # 进度完成信号

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 成员变量
        self.window = window
        self.items: list[Item] = []  # 全量数据
        self.filtered_items: list[Item] = []  # 筛选后数据
        self.warning_map: dict[int, list[WarningType]] = {}  # 警告映射表
        self.result_checker: ResultChecker | None = None  # 结果检查器
        self.is_readonly: bool = False  # 只读模式标志
        self.config: Config | None = None  # 配置
        self.filter_options: dict = {}  # 当前筛选选项
        self.search_keyword: str = ""  # 当前搜索关键词
        self.search_is_regex: bool = False  # 是否正则搜索
        self.search_match_indices: list[int] = []  # 匹配项在 filtered_items 中的索引
        self.search_current_match: int = (
            -1
        )  # 当前匹配项索引（在 search_match_indices 中的位置）

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 初始化 UI 布局
        self.add_widget_body(self.root, window)
        self.add_widget_foot(self.root, window)

        # 注册事件
        self.subscribe(Base.Event.TRANSLATION_RUN, self._on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_UPDATE, self._on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_DONE, self._on_engine_status_changed)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self._on_engine_status_changed
        )

        # 连接信号
        self.items_loaded.connect(self._on_items_loaded_ui)
        self.translate_done.connect(self._on_translate_done_ui)
        self.save_done.connect(self._on_save_done_ui)
        self.export_done.connect(self._on_export_done_ui)
        self.progress_updated.connect(self._on_progress_updated_ui)
        self.progress_finished.connect(self._on_progress_finished_ui)

    # ========== 主体：表格 ==========
    def add_widget_body(self, parent: QLayout, window: FluentWindow) -> None:
        """添加主体控件"""
        self.table_widget = ProofreadingTableWidget()
        self.table_widget.cell_edited.connect(self._on_cell_edited)
        self.table_widget.retranslate_clicked.connect(self._on_retranslate_clicked)
        self.table_widget.batch_retranslate_clicked.connect(
            self._on_batch_retranslate_clicked
        )
        self.table_widget.copy_src_clicked.connect(self._on_copy_src_clicked)
        self.table_widget.copy_dst_clicked.connect(self._on_copy_dst_clicked)
        self.table_widget.set_items([], {})

        parent.addWidget(self.table_widget, 1)

    # ========== 底部：命令栏 ==========
    def add_widget_foot(self, parent: QLayout, window: FluentWindow) -> None:
        """添加底部控件"""
        # 搜索栏（默认隐藏）
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        # 绑定搜索回调
        self.search_card.on_back_clicked(lambda w: self._on_search_back_clicked())
        self.search_card.on_prev_clicked(lambda w: self._on_search_prev_clicked())
        self.search_card.on_next_clicked(lambda w: self._on_search_next_clicked())
        self.search_card.on_search_triggered(lambda w: self._do_search())

        # 命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.command_bar_card.set_minimum_width(640)

        # 加载按钮
        self.btn_load = self.command_bar_card.add_action(
            Action(
                FluentIcon.DOWNLOAD,
                Localizer.get().proofreading_page_load,
                triggered=self._on_load_clicked,
            )
        )

        # 保存按钮
        action_save = Action(
            FluentIcon.SAVE,
            Localizer.get().proofreading_page_save,
            triggered=self._on_save_clicked,
        )
        action_save.setShortcut("Ctrl+S")
        self.btn_save = self.command_bar_card.add_action(action_save)
        self.btn_save.installEventFilter(
            ToolTipFilter(self.btn_save, 300, ToolTipPosition.TOP)
        )
        self.btn_save.setToolTip(Localizer.get().proofreading_page_save_tooltip)
        self.btn_save.setEnabled(False)

        # 分隔符与功能按钮组
        self.command_bar_card.add_separator()
        self.btn_export = self.command_bar_card.add_action(
            Action(
                FluentIcon.SHARE,
                Localizer.get().proofreading_page_export,
                triggered=self._on_export_clicked,
            )
        )
        self.btn_export.installEventFilter(
            ToolTipFilter(self.btn_export, 300, ToolTipPosition.TOP)
        )
        self.btn_export.setToolTip(Localizer.get().proofreading_page_export_tooltip)
        self.btn_export.setEnabled(False)

        self.command_bar_card.add_separator()
        self.btn_search = self.command_bar_card.add_action(
            Action(
                FluentIcon.SEARCH,
                Localizer.get().proofreading_page_search,
                triggered=self._on_search_clicked,
            )
        )
        self.btn_search.setEnabled(False)

        self.btn_filter = self.command_bar_card.add_action(
            Action(
                FluentIcon.FILTER,
                Localizer.get().proofreading_page_filter,
                triggered=self._on_filter_clicked,
            )
        )
        self.btn_filter.setEnabled(False)

        # 分页组件（放到右侧）
        # 使用 add_widget 添加到 hbox，而非 command_bar 内部，使 stretch 能正确生效
        self.command_bar_card.add_stretch(1)
        self.pagination_bar = PaginationBar()
        self.pagination_bar.page_changed.connect(self._on_page_changed)
        self.command_bar_card.add_widget(self.pagination_bar)

    # ========== 加载功能 ==========
    def _on_load_clicked(self) -> None:
        """加载按钮点击"""
        # 显示 loading 指示器
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)
        self.load_data()

    def load_data(self) -> None:
        """加载缓存数据"""

        def task() -> None:
            # 在子线程中执行耗时的磁盘 I/O 和数据校验，防止阻塞 UI 主线程
            try:
                self.config = Config().load()
                # 从工程数据库读取所有条目
                db = SessionContext.get().get_db()
                if db is None:
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().proofreading_page_no_cache,
                        },
                    )
                    self.items_loaded.emit([])
                    return
                items = [Item.from_dict(d) for d in db.get_all_items()]
                # 过滤掉原文为空的条目
                items = [i for i in items if i.get_src().strip()]

                if not items:
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().proofreading_page_no_cache,
                        },
                    )
                    self.items_loaded.emit([])
                    return

                checker = ResultChecker(self.config)
                warning_map = checker.get_check_results(items)

                self.items = items
                self.warning_map = warning_map
                self.result_checker = checker
                self.filter_options = {}

                self.items_loaded.emit(items)

            except Exception as e:
                self.error(f"{Localizer.get().proofreading_page_load_failed}", e)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().proofreading_page_load_failed,
                    },
                )
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
        if not self.items or not self.result_checker:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().proofreading_page_no_cache,
                },
            )
            return

        dialog = FilterDialog(
            items=self.items,
            warning_map=self.warning_map,
            result_checker=self.result_checker,
            parent=self.window,
        )
        dialog.set_filter_options(self.filter_options)

        if dialog.exec():
            self.filter_options = dialog.get_filter_options()
            self._apply_filter()

    def _apply_filter(self) -> None:
        """应用筛选条件"""
        warning_types = self.filter_options.get(FilterDialog.KEY_WARNING_TYPES)
        statuses = self.filter_options.get(FilterDialog.KEY_STATUSES)
        file_paths = self.filter_options.get(FilterDialog.KEY_FILE_PATHS)
        glossary_terms = self.filter_options.get(FilterDialog.KEY_GLOSSARY_TERMS)

        filtered = []
        for item in self.items:
            # 排除掉 已排除 和 重复条目（通常无需校对）
            if item.get_status() in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.DUPLICATED,
            ):
                continue

            # 警告类型筛选：如果开启了筛选，则过滤不吻合的项
            if warning_types is not None:
                item_warnings = self.warning_map.get(id(item), [])
                # 逻辑展平：分别处理有警告和无警告的显示条件
                if item_warnings and not any(e in warning_types for e in item_warnings):
                    continue
                if (
                    not item_warnings
                    and FilterDialog.NO_WARNING_TAG not in warning_types
                ):
                    continue

                # 术语级筛选：仅当警告包含 GLOSSARY 且指定了术语时生效
                if (
                    glossary_terms is not None
                    and WarningType.GLOSSARY in item_warnings
                    and self.result_checker
                ):
                    item_terms = self.result_checker.get_failed_glossary_terms(item)
                    if not any(t in glossary_terms for t in item_terms):
                        continue

            # 翻译状态和路径筛选：使用合并判断减少嵌套
            if statuses is not None and item.get_status() not in statuses:
                continue

            if file_paths is not None and item.get_file_path() not in file_paths:
                continue

            filtered.append(item)

        self.filtered_items = filtered
        self.pagination_bar.set_total(len(filtered))
        self.pagination_bar.set_page(1)
        self._render_page(1)

        # 筛选后清空搜索状态，因为 filtered_items 已变化
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()

    # ========== 搜索功能 ==========
    def _on_search_clicked(self) -> None:
        """搜索按钮点击"""
        self.search_card.setVisible(True)
        self.command_bar_card.setVisible(False)
        # 聚焦到输入框
        self.search_card.get_line_edit().setFocus()

    def _on_search_back_clicked(self) -> None:
        """搜索栏返回点击，清除搜索状态"""
        self.search_keyword = ""
        self.search_is_regex = False
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()
        self.search_card.setVisible(False)
        self.command_bar_card.setVisible(True)

    def _do_search(self) -> None:
        """执行搜索，构建匹配索引列表并跳转到第一个匹配项"""
        keyword = self.search_card.get_keyword()
        if not keyword:
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_card.clear_match_info()
            return

        is_regex = self.search_card.is_regex_mode()

        # 验证正则表达式
        if is_regex:
            is_valid, error_msg = self.search_card.validate_regex()
            if not is_valid:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": f"{Localizer.get().search_regex_invalid}: {error_msg}",
                    },
                )
                return

        self.search_keyword = keyword
        self.search_is_regex = is_regex

        # 构建匹配索引列表
        self._build_match_indices()

        if not self.search_match_indices:
            self.search_card.set_match_info(0, 0)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().search_no_match,
                },
            )
            return

        # 跳转到第一个匹配项
        self.search_current_match = 0
        self._jump_to_match()

    def _build_match_indices(self) -> None:
        """构建匹配项索引列表"""
        self.search_match_indices = []

        if not self.search_keyword:
            return

        keyword = self.search_keyword
        is_regex = self.search_is_regex

        # 编译正则（忽略大小写）
        if is_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                return
        else:
            keyword_lower = keyword.lower()

        for idx, item in enumerate(self.filtered_items):
            src = item.get_src()
            dst = item.get_dst()

            if is_regex:
                if pattern.search(src) or pattern.search(dst):
                    self.search_match_indices.append(idx)
            else:
                # 普通搜索（忽略大小写）
                if keyword_lower in src.lower() or keyword_lower in dst.lower():
                    self.search_match_indices.append(idx)

    def _on_search_prev_clicked(self) -> None:
        """上一个匹配项"""
        if not self.search_match_indices:
            # 如果没有匹配结果，先执行搜索
            self._do_search()
            return

        # 循环跳转到上一个
        self.search_current_match -= 1
        if self.search_current_match < 0:
            self.search_current_match = len(self.search_match_indices) - 1
        self._jump_to_match()

    def _on_search_next_clicked(self) -> None:
        """下一个匹配项"""
        if not self.search_match_indices:
            # 如果没有匹配结果，先执行搜索
            self._do_search()
            return

        # 循环跳转到下一个
        self.search_current_match += 1
        if self.search_current_match >= len(self.search_match_indices):
            self.search_current_match = 0
        self._jump_to_match()

    def _jump_to_match(self) -> None:
        """跳转到当前匹配项"""
        if not self.search_match_indices or self.search_current_match < 0:
            return

        # 更新匹配信息显示
        total = len(self.search_match_indices)
        current = self.search_current_match + 1  # 显示时从 1 开始
        self.search_card.set_match_info(current, total)

        # 计算匹配项所在页码
        item_index = self.search_match_indices[self.search_current_match]
        page_size = self.pagination_bar.get_page_size()
        target_page = (item_index // page_size) + 1

        # 如果需要翻页
        current_page = self.pagination_bar.get_page()
        if target_page != current_page:
            self.pagination_bar.set_page(target_page)
            self._render_page(target_page)

        # 在表格中选中该行
        row_in_page = item_index % page_size
        self.table_widget.select_row(row_in_page)

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
        page_warning_map = {
            id(item): self.warning_map.get(id(item), []) for item in page_items
        }

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
        if new_dst and item.get_status() not in (
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        ):
            item.set_status(Base.ProjectStatus.PROCESSED)

        self._recheck_item(item)

    def _recheck_item(self, item: Item) -> None:
        """重新检查单个条目"""
        if not self.config:
            return

        checker = ResultChecker(self.config)
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

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_src_done,
            },
        )

    def _on_copy_dst_clicked(self, item: Item) -> None:
        """复制译文到剪贴板"""
        clipboard = QApplication.clipboard()
        clipboard.setText(item.get_dst())

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_dst_done,
            },
        )

    # ========== 重新翻译功能 ==========
    def _on_retranslate_clicked(self, item: Item) -> None:
        """重新翻译按钮点击 - 单条翻译也使用批量翻译流程"""
        if self.is_readonly or not self.config:
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_retranslate_confirm,
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        # 使用统一的批量翻译流程（单条也走这个逻辑）
        self._do_batch_retranslate([item])

    def _on_batch_retranslate_clicked(self, items: list[Item]) -> None:
        """批量重新翻译按钮点击"""
        if self.is_readonly or not self.config or not items:
            return

        # 确认对话框
        count = len(items)
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_batch_retranslate_confirm.replace(
                "{COUNT}", str(count)
            ),
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self._do_batch_retranslate(items)

    def _do_batch_retranslate(self, items: list[Item]) -> None:
        """执行批量翻译（单条和多条统一入口）"""
        count = len(items)
        # 使用最新配置，而非缓存的 self.config
        config = Config().load()

        # 显示进度 Toast（初始显示"正在处理第 1 个"）
        self.progress_show(
            Localizer.get()
            .proofreading_page_batch_retranslate_progress.replace("{CURRENT}", "1")
            .replace("{TOTAL}", str(count)),
            1,
            count,
        )

        def batch_translate_task() -> None:
            success_count = 0
            fail_count = 0
            total = len(items)

            for idx, item in enumerate(items):
                # 更新进度（在任务开始前显示"正在处理第 N 个"）
                current = idx + 1
                self.progress_updated.emit(
                    Localizer.get()
                    .proofreading_page_batch_retranslate_progress.replace(
                        "{CURRENT}", str(current)
                    )
                    .replace("{TOTAL}", str(total)),
                    current,
                    total,
                )

                # 重置状态
                item.set_status(Base.ProjectStatus.NONE)
                item.set_retry_count(0)

                # 同步翻译（使用 Event 等待完成，兼容 No-GIL）
                complete_event = threading.Event()
                result_container = {"success": False}

                def callback(i: Item, s: bool) -> None:
                    result_container["success"] = s
                    # 发射信号通知 UI 逐条刷新
                    self.translate_done.emit(i, s)
                    complete_event.set()

                Engine.get().translate_single_item(
                    item=item, config=config, callback=callback
                )

                # 阻塞等待翻译完成，避免忙轮询
                complete_event.wait()

                if result_container["success"]:
                    success_count += 1
                else:
                    fail_count += 1
                    item.set_status(Base.ProjectStatus.PROCESSED)

            # 完成后隐藏 Toast（通过信号在主线程执行）
            self.progress_finished.emit()

            # 显示结果
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS
                    if fail_count == 0
                    else Base.ToastType.WARNING,
                    "message": Localizer.get()
                    .proofreading_page_batch_retranslate_success.replace(
                        "{SUCCESS}", str(success_count)
                    )
                    .replace("{FAILED}", str(fail_count)),
                },
            )

        threading.Thread(target=batch_translate_task, daemon=True).start()

    def _on_translate_done_ui(self, item: Item, success: bool) -> None:
        """翻译完成的 UI 更新（主线程）- 逐条刷新，不显示 Toast（批量流程统一显示）"""
        # 1. 无论是否可见，都更新数据层面的警告状态，确保翻页后状态正确
        if success:
            self._recheck_item(item)

        # 2. 如果条目在当前页可见，更新 UI 显示
        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.set_row_loading(row, False)
            if success:
                self.table_widget.update_row_dst(row, item.get_dst())
            else:
                item.set_status(Base.ProjectStatus.PROCESSED)

    def _on_progress_updated_ui(self, content: str, current: int, total: int) -> None:
        """进度更新的 UI 处理（主线程）"""
        self.progress_update(content, current, total)

    def _on_progress_finished_ui(self) -> None:
        """进度完成的 UI 处理（主线程）"""
        self.indeterminate_hide()
        # 逐条刷新已在 _on_translate_done_ui 中完成，无需再次刷新

    # ========== 保存功能 ==========
    def _on_save_clicked(self) -> None:
        """保存按钮点击"""
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()

    def save_data(self) -> None:
        """保存数据到缓存文件（异步执行）"""
        if self.is_readonly or not self.config or not self.items:
            self.indeterminate_hide()
            return

        # 捕获当前状态的引用，避免在子线程中访问 self 时产生竞态
        items = self.items

        def task() -> None:
            try:
                # 直接写入工程数据库
                db = SessionContext.get().get_db()
                if db is None:
                    self.save_done.emit(False)
                    return
                db.set_items([item.to_dict() for item in items])
                self.save_done.emit(True)
            except Exception as e:
                self.error(f"{Localizer.get().proofreading_page_save_failed}", e)
                self.save_done.emit(False)

        threading.Thread(target=task, daemon=True).start()

    # ========== 导出功能 ==========
    def _on_export_clicked(self) -> None:
        """导出按钮点击"""
        # 弹框让用户确认
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_export_confirm,
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        # 先保存数据再导出，保证译文文件与缓存数据一致
        self._pending_export = True
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()

    def _on_save_done_ui(self, success: bool) -> None:
        """保存完成的 UI 更新（主线程）"""
        # 检查是否有待处理的导出操作
        pending_export = getattr(self, "_pending_export", False)
        self._pending_export = False

        if pending_export:
            # 导出流程中的保存
            if success:
                self.indeterminate_show(
                    Localizer.get().proofreading_page_indeterminate_exporting
                )
                self.export_data()  # 异步执行，完成后由 export_done 信号触发隐藏
            else:
                self.indeterminate_hide()
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().proofreading_page_save_failed,
                    },
                )
        else:
            # 普通保存流程：成功时直接隐藏进度条，失败时弹出错误提示
            self.indeterminate_hide()
            if not success:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().proofreading_page_save_failed,
                    },
                )

    def export_data(self) -> None:
        """导出数据（异步执行）"""
        if not self.config or not self.items:
            self.export_done.emit(False, "")
            return

        # 捕获当前状态的引用，避免子线程中访问 self 时产生竞态
        config = self.config
        items = self.items

        def task() -> None:
            try:
                FileManager(config).write_to_path(items)
                self.export_done.emit(True, "")
            except Exception as e:
                self.error("Export failed", e)
                self.export_done.emit(False, str(e))

        threading.Thread(target=task, daemon=True).start()

    def _on_export_done_ui(self, success: bool, error_msg: str) -> None:
        """导出完成的 UI 更新（主线程）"""
        # 成功时直接隐藏进度条，失败时弹出错误提示
        self.indeterminate_hide()
        if not success:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": error_msg
                    or Localizer.get().proofreading_page_export_failed,
                },
            )

    # ========== 只读模式控制 ==========
    def _on_engine_status_changed(self, event: Base.Event, data: dict) -> None:
        """Engine 状态变更事件"""
        self._check_engine_status()

    def _check_engine_status(self) -> None:
        """检查并更新只读模式"""
        # 获取全局引擎状态，确保 UI 状态与后台任务一致
        engine_status = Engine.get().get_status()
        is_busy = engine_status in (
            Base.TaskStatus.TRANSLATING,
            Base.TaskStatus.STOPPING,
        )

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

    def showEvent(self, event: QShowEvent) -> None:
        """页面显示时自动刷新状态，确保与全局翻译任务同步"""
        super().showEvent(event)
        self._check_engine_status()

    # ========== Loading 指示器 ==========
    def indeterminate_show(self, msg: str) -> None:
        """显示 loading 指示器（不定进度）"""
        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": msg,
                "indeterminate": True,
            },
        )

    def progress_show(self, msg: str, current: int = 0, total: int = 0) -> None:
        """显示确定进度指示器"""
        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": msg,
                "indeterminate": False,
                "current": current,
                "total": total,
            },
        )

    def progress_update(self, msg: str, current: int, total: int) -> None:
        """更新进度"""
        self.emit(
            Base.Event.PROGRESS_TOAST_UPDATE,
            {
                "message": msg,
                "current": current,
                "total": total,
            },
        )

    def indeterminate_hide(self) -> None:
        """隐藏 loading 指示器"""
        self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
