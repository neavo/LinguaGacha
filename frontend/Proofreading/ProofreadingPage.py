import re
import threading

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QShowEvent
from PyQt5.QtWidgets import QApplication
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
from module.Storage.StorageContext import StorageContext
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard


class ProofreadingPage(QWidget, Base):
    """校对任务主页面"""

    # 信号定义
    items_loaded = pyqtSignal(list)  # 数据加载完成信号
    filter_done = pyqtSignal(list)  # 筛选完成信号
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
        self.main_window = window
        self.items_all: list[Item] = []  # 全量数据（含结构行）
        self.items: list[Item] = []  # 可校对数据
        self.filtered_items: list[Item] = []  # 筛选后数据
        self.warning_map: dict[int, list[WarningType]] = {}  # 警告映射表
        self.result_checker: ResultChecker | None = None  # 结果检查器
        self.is_readonly: bool = False  # 只读模式标志
        self.config: Config | None = None  # 配置
        self.filter_options: dict = {}  # 当前筛选选项
        self.search_keyword: str = ""  # 当前搜索关键词
        self.search_is_regex: bool = False  # 是否正则搜索
        self.search_filter_mode: bool = False  # 是否筛选模式
        self.search_match_indices: list[int] = []  # 匹配项在 filtered_items 中的索引
        self.search_current_match: int = (
            -1
        )  # 当前匹配项索引（在 search_match_indices 中的位置）
        self.pending_selected_item: Item | None = None

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 初始化 UI 布局
        self.add_widget_body(self.root, window)
        self.add_widget_foot(self.root, window)

        # 注册事件
        self.subscribe(Base.Event.TRANSLATION_RUN, self.on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_UPDATE, self.on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.on_engine_status_changed)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.on_engine_status_changed
        )
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_translation_reset)
        self.subscribe(Base.Event.TRANSLATION_RESET_FAILED, self.on_translation_reset)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

        # 连接信号
        self.items_loaded.connect(self.on_items_loaded_ui)
        self.filter_done.connect(self.on_filter_done_ui)
        self.translate_done.connect(self.on_translate_done_ui)
        self.save_done.connect(self.on_save_done_ui)
        self.export_done.connect(self.on_export_done_ui)
        self.progress_updated.connect(self.on_progress_updated_ui)
        self.progress_finished.connect(self.on_progress_finished_ui)

    # ========== 主体：表格 ==========
    def add_widget_body(self, parent: QVBoxLayout, main_window: FluentWindow) -> None:
        """添加主体控件"""
        self.table_widget = ProofreadingTableWidget()
        self.table_widget.cell_edited.connect(self.on_cell_edited)
        self.table_widget.retranslate_clicked.connect(self.on_retranslate_clicked)
        self.table_widget.batch_retranslate_clicked.connect(
            self.on_batch_retranslate_clicked
        )
        self.table_widget.reset_translation_clicked.connect(
            self.on_reset_translation_clicked
        )
        self.table_widget.batch_reset_translation_clicked.connect(
            self.on_batch_reset_translation_clicked
        )
        self.table_widget.copy_src_clicked.connect(self.on_copy_src_clicked)
        self.table_widget.copy_dst_clicked.connect(self.on_copy_dst_clicked)
        self.table_widget.set_items([], {})

        parent.addWidget(self.table_widget, 1)

    # ========== 底部：命令栏 ==========
    def add_widget_foot(self, parent: QVBoxLayout, main_window: FluentWindow) -> None:
        """添加底部控件"""
        # 搜索栏（默认隐藏）
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        # 绑定搜索回调
        self.search_card.on_back_clicked(lambda w: self.on_search_back_clicked())
        self.search_card.on_prev_clicked(lambda w: self.on_search_prev_clicked())
        self.search_card.on_next_clicked(lambda w: self.on_search_next_clicked())
        self.search_card.on_search_triggered(lambda w: self.do_search())
        self.search_card.on_search_mode_changed(lambda w: self.on_search_mode_changed())

        # 命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.search_card.set_base_font(self.command_bar_card.command_bar.font())

        self.command_bar_card.set_minimum_width(640)

        # 加载按钮
        self.btn_load = self.command_bar_card.add_action(
            Action(
                FluentIcon.DOWNLOAD,
                Localizer.get().proofreading_page_load,
                triggered=self.on_load_clicked,
            )
        )

        # 保存按钮
        action_save = Action(
            FluentIcon.SAVE,
            Localizer.get().proofreading_page_save,
            triggered=self.on_save_clicked,
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
                triggered=self.on_export_clicked,
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
                triggered=self.on_search_clicked,
            )
        )
        self.btn_search.setEnabled(False)

        self.btn_filter = self.command_bar_card.add_action(
            Action(
                FluentIcon.FILTER,
                Localizer.get().proofreading_page_filter,
                triggered=self.on_filter_clicked,
            )
        )
        self.btn_filter.setEnabled(False)

        # 分页组件（放到右侧）
        # 使用 add_widget 添加到 hbox，而非 command_bar 内部，使 stretch 能正确生效
        self.command_bar_card.add_stretch(1)
        self.pagination_bar = PaginationBar()
        self.pagination_bar.page_changed.connect(self.on_page_changed)
        self.command_bar_card.add_widget(self.pagination_bar)

    # ========== 加载功能 ==========
    def on_load_clicked(self) -> None:
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
                db = StorageContext.get().get_db()
                if db is None:
                    self.items_all = []
                    self.items = []
                    self.filtered_items = []
                    self.warning_map = {}
                    self.result_checker = None
                    self.filter_options = {}
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().proofreading_page_no_cache,
                        },
                    )
                    self.items_loaded.emit([])
                    return
                items_all = [Item.from_dict(d) for d in db.get_all_items()]
                items = self.build_review_items(items_all)

                if not items_all:
                    self.items_all = []
                    self.items = []
                    self.filtered_items = []
                    self.warning_map = {}
                    self.result_checker = None
                    self.filter_options = {}
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().proofreading_page_no_cache,
                        },
                    )
                    self.items_loaded.emit([])
                    return

                if not items:
                    self.items_all = items_all
                    self.items = []
                    self.filtered_items = []
                    self.warning_map = {}
                    self.result_checker = None
                    self.filter_options = {}
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().proofreading_page_no_review_items,
                        },
                    )
                    self.items_loaded.emit([])
                    return

                checker = ResultChecker(self.config)
                warning_map = checker.check_items(items)

                self.items_all = items_all
                self.items = items
                self.warning_map = warning_map
                self.result_checker = checker
                self.filter_options = self.build_default_filter_options(
                    items, warning_map, checker
                )

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

    def on_items_loaded_ui(self, items: list[Item]) -> None:
        """数据加载完成的 UI 更新（主线程）"""
        # 隐藏 loading 指示器
        self.indeterminate_hide()

        if items:
            self.apply_filter()
        else:
            # 清空数据并显示占位符
            self.table_widget.set_items([], {})
            self.pagination_bar.reset()

        self.check_engine_status()

    # ========== 筛选功能 ==========
    def on_filter_clicked(self) -> None:
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
            parent=self.main_window,
        )
        dialog.set_filter_options(self.filter_options)

        if dialog.exec():
            self.filter_options = dialog.get_filter_options()
            self.pending_selected_item = None
            self.apply_filter()

    def apply_filter(self) -> None:
        """应用筛选条件 (异步执行)"""
        # 如果正在加载，则不重复触发
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)

        # 捕获当前需要的参数快照，避免竞态
        options = self.filter_options
        items_ref = self.items
        warning_map_ref = self.warning_map
        checker_ref = self.result_checker
        keyword = self.search_keyword
        use_regex = self.search_is_regex
        use_search_filter = self.search_filter_mode

        if use_search_filter and keyword and use_regex:
            try:
                re.compile(keyword)
            except re.error as e:
                self.indeterminate_hide()
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": f"{Localizer.get().search_regex_invalid}: {e}",
                    },
                )
                return

        def filter_task() -> None:
            try:
                warning_types: set[WarningType | str] | None = options.get(
                    FilterDialog.KEY_WARNING_TYPES
                )
                statuses = options.get(FilterDialog.KEY_STATUSES)
                file_paths = options.get(FilterDialog.KEY_FILE_PATHS)
                glossary_terms = options.get(FilterDialog.KEY_GLOSSARY_TERMS)

                if warning_types is None:
                    warning_types = set(WarningType)
                    warning_types.add(FilterDialog.NO_WARNING_TAG)

                default_statuses = {
                    Base.ProjectStatus.NONE,
                    Base.ProjectStatus.PROCESSED,
                    Base.ProjectStatus.ERROR,
                    Base.ProjectStatus.PROCESSED_IN_PAST,
                }
                if statuses is None:
                    statuses = default_statuses

                if file_paths is None:
                    file_paths = {item.get_file_path() for item in items_ref}

                if glossary_terms is None:
                    glossary_terms = set()

                filtered = []
                search_pattern = None
                keyword_lower = ""
                if use_search_filter and keyword:
                    if use_regex:
                        search_pattern = re.compile(keyword, re.IGNORECASE)
                    else:
                        keyword_lower = keyword.lower()
                for item in items_ref:
                    # WHY: 规则跳过条目不需要校对，仅保留给用户可选查看的语言跳过
                    if item.get_status() in (
                        Base.ProjectStatus.EXCLUDED,
                        Base.ProjectStatus.DUPLICATED,
                        Base.ProjectStatus.RULE_SKIPPED,
                    ):
                        continue

                    # 警告类型筛选
                    item_warnings = warning_map_ref.get(id(item), [])
                    if item_warnings and not any(
                        e in warning_types for e in item_warnings
                    ):
                        continue
                    if (
                        not item_warnings
                        and FilterDialog.NO_WARNING_TAG not in warning_types
                    ):
                        continue

                    # 术语级筛选
                    if (
                        WarningType.GLOSSARY in item_warnings
                        and WarningType.GLOSSARY in warning_types
                        and checker_ref
                    ):
                        item_terms = checker_ref.get_failed_glossary_terms(item)
                        if glossary_terms and not any(
                            t in glossary_terms for t in item_terms
                        ):
                            continue
                        if not glossary_terms:
                            continue

                    # 翻译状态和路径筛选
                    if item.get_status() not in statuses:
                        continue

                    if item.get_file_path() not in file_paths:
                        continue

                    if use_search_filter and keyword:
                        src = item.get_src()
                        dst = item.get_dst()
                        if search_pattern:
                            if not (
                                search_pattern.search(src) or search_pattern.search(dst)
                            ):
                                continue
                        elif keyword_lower:
                            if (
                                keyword_lower not in src.lower()
                                and keyword_lower not in dst.lower()
                            ):
                                continue

                    filtered.append(item)

                self.filter_done.emit(filtered)
            except Exception as e:
                self.error("Filter failed", e)
                self.filter_done.emit([])

        threading.Thread(target=filter_task, daemon=True).start()

    def on_filter_done_ui(self, filtered: list[Item]) -> None:
        """筛选完成的 UI 更新 (主线程)"""
        self.indeterminate_hide()
        self.filtered_items = filtered
        self.pagination_bar.set_total(len(filtered))
        self.pagination_bar.set_page(1)
        self.render_page(1)

        # 筛选后更新搜索状态
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()
        if self.search_filter_mode and self.search_keyword:
            self.build_match_indices()
            if not self.search_match_indices:
                self.search_card.set_match_info(0, 0)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().search_no_match,
                    },
                )
            self.restore_selected_item()
        else:
            self.restore_selected_item()

    def build_default_filter_options(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
    ) -> dict:
        warning_types: set[WarningType | str] = set(WarningType)
        warning_types.add(FilterDialog.NO_WARNING_TAG)

        statuses = {
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.ERROR,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        }

        file_paths = {item.get_file_path() for item in items}

        glossary_terms: set[tuple[str, str]] = set()
        if checker:
            for item in items:
                if WarningType.GLOSSARY in warning_map.get(id(item), []):
                    glossary_terms.update(checker.get_failed_glossary_terms(item))

        return {
            FilterDialog.KEY_WARNING_TYPES: warning_types,
            FilterDialog.KEY_STATUSES: statuses,
            FilterDialog.KEY_FILE_PATHS: file_paths,
            FilterDialog.KEY_GLOSSARY_TERMS: glossary_terms,
        }

    def build_review_items(self, items: list[Item]) -> list[Item]:
        """构建可校对条目列表，避免结构行进入 UI。"""
        review_items = []
        for item in items:
            # WHY: 结构行需要保留用于导出，但不应进入校对列表
            if not item.get_src().strip():
                continue
            if item.get_status() in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue
            review_items.append(item)
        return review_items

    # ========== 搜索功能 ==========
    def on_search_clicked(self) -> None:
        """搜索按钮点击"""
        self.search_card.setVisible(True)
        self.command_bar_card.setVisible(False)
        self.attach_pagination_to_search_bar()
        # 聚焦到输入框
        self.search_card.get_line_edit().setFocus()

    def on_search_back_clicked(self) -> None:
        """搜索栏返回点击，清除搜索状态"""
        self.search_keyword = ""
        self.search_is_regex = False
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()
        if self.search_filter_mode:
            self.pending_selected_item = None
            self.apply_filter()
        self.search_card.setVisible(False)
        self.attach_pagination_to_command_bar()
        self.command_bar_card.setVisible(True)

    def do_search(self) -> None:
        """执行搜索，构建匹配索引列表并跳转到第一个匹配项"""
        keyword = self.search_card.get_keyword()
        if not keyword:
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_card.clear_match_info()
            if self.search_filter_mode:
                self.search_keyword = ""
                self.search_is_regex = self.search_card.is_regex_mode()
                self.pending_selected_item = None
                self.apply_filter()
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

        if self.search_filter_mode:
            self.pending_selected_item = None
            self.apply_filter()
            return

        # 构建匹配索引列表
        self.build_match_indices()

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
        self.jump_to_match()

    def on_search_mode_changed(self) -> None:
        self.search_filter_mode = self.search_card.is_filter_mode()
        self.search_keyword = self.search_card.get_keyword()
        self.search_is_regex = self.search_card.is_regex_mode()

        if self.search_filter_mode and self.search_keyword and self.search_is_regex:
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

        selected_items = self.table_widget.get_selected_items()
        self.pending_selected_item = selected_items[0] if selected_items else None

        if self.search_filter_mode:
            if not self.search_keyword:
                self.search_match_indices = []
                self.search_current_match = -1
                self.search_card.clear_match_info()
            self.apply_filter()
            return

        self.apply_filter()

    def build_match_indices(self) -> None:
        """构建匹配项索引列表 (修复变量未绑定隐患)"""
        self.search_match_indices = []

        if not self.search_keyword:
            return

        keyword = self.search_keyword
        is_regex = self.search_is_regex
        pattern = None
        keyword_lower = None

        # 预编译正则或准备小写关键词
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

            if is_regex and pattern:
                if pattern.search(src) or pattern.search(dst):
                    self.search_match_indices.append(idx)
            elif not is_regex and keyword_lower is not None:
                # 使用局部变量确保类型安全
                search_term: str = keyword_lower
                if search_term in src.lower() or search_term in dst.lower():
                    self.search_match_indices.append(idx)

    def restore_selected_item(self) -> None:
        if self.pending_selected_item is None:
            if self.search_filter_mode and self.search_match_indices:
                self.search_current_match = 0
                self.jump_to_match()
            self.pending_selected_item = None
            return

        if self.pending_selected_item not in self.filtered_items:
            self.pending_selected_item = None
            if self.search_filter_mode and self.search_match_indices:
                self.search_current_match = 0
                self.jump_to_match()
            return

        item_index = self.filtered_items.index(self.pending_selected_item)
        if self.search_match_indices:
            if item_index in self.search_match_indices:
                self.search_current_match = self.search_match_indices.index(item_index)
                self.jump_to_match()
        else:
            page_size = self.pagination_bar.get_page_size()
            target_page = (item_index // page_size) + 1
            self.pagination_bar.set_page(target_page)
            self.render_page(target_page)
            row_in_page = item_index % page_size
            self.table_widget.select_row(row_in_page)

        self.pending_selected_item = None

    def on_search_prev_clicked(self) -> None:
        """上一个匹配项"""
        if not self.search_match_indices:
            # 如果没有匹配结果，先执行搜索
            self.do_search()
            return

        selection_index = self.get_selected_item_index()
        if selection_index >= 0:
            prev_matches = [m for m in self.search_match_indices if m < selection_index]
            if prev_matches:
                self.search_current_match = self.search_match_indices.index(
                    prev_matches[-1]
                )
            else:
                self.search_current_match = len(self.search_match_indices) - 1
            self.jump_to_match()
            return

        # 循环跳转到上一个
        self.search_current_match -= 1
        if self.search_current_match < 0:
            self.search_current_match = len(self.search_match_indices) - 1
        self.jump_to_match()

    def on_search_next_clicked(self) -> None:
        """下一个匹配项"""
        if not self.search_match_indices:
            # 如果没有匹配结果，先执行搜索
            self.do_search()
            return

        selection_index = self.get_selected_item_index()
        if selection_index >= 0:
            next_matches = [m for m in self.search_match_indices if m > selection_index]
            if next_matches:
                self.search_current_match = self.search_match_indices.index(
                    next_matches[0]
                )
            else:
                self.search_current_match = 0
            self.jump_to_match()
            return

        # 循环跳转到下一个
        self.search_current_match += 1
        if self.search_current_match >= len(self.search_match_indices):
            self.search_current_match = 0
        self.jump_to_match()

    def get_selected_item_index(self) -> int:
        selected_items = self.table_widget.get_selected_items()
        if not selected_items:
            return -1

        item = selected_items[0]
        if item not in self.filtered_items:
            return -1

        return self.filtered_items.index(item)

    def attach_pagination_to_search_bar(self) -> None:
        self.pagination_bar.setParent(self.search_card)
        self.search_card.add_right_widget(self.pagination_bar)

    def attach_pagination_to_command_bar(self) -> None:
        self.pagination_bar.setParent(self.command_bar_card)
        self.command_bar_card.add_widget(self.pagination_bar)

    def jump_to_match(self) -> None:
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
            self.render_page(target_page)

        # 在表格中选中该行
        row_in_page = item_index % page_size
        self.table_widget.select_row(row_in_page)

    # ========== 分页渲染 ==========
    def on_page_changed(self, page: int) -> None:
        """页码变化"""
        self.render_page(page)

    def render_page(self, page_num: int) -> None:
        """渲染指定页的数据"""
        page_size = self.pagination_bar.get_page_size()
        start_idx = (page_num - 1) * page_size
        end_idx = start_idx + page_size

        page_items = self.filtered_items[start_idx:end_idx]
        page_warning_map = {
            id(item): self.warning_map.get(id(item), []) for item in page_items
        }

        self.table_widget.set_items(page_items, page_warning_map, start_idx)

    # ========== 编辑功能 ==========
    def on_cell_edited(self, item: Item, new_dst: str) -> None:
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

        self.recheck_item(item)

    def recheck_item(self, item: Item) -> None:
        """重新检查单个条目"""
        if not self.config:
            return

        checker = ResultChecker(self.config)
        warnings = checker.check_item(item)

        if warnings:
            self.warning_map[id(item)] = warnings
        else:
            self.warning_map.pop(id(item), None)

        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.update_row_status(row, warnings)

    def on_copy_src_clicked(self, item: Item) -> None:
        """复制原文到剪贴板"""
        clipboard = QApplication.clipboard()
        if clipboard:
            clipboard.setText(item.get_src())

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_src_done,
            },
        )

    def on_copy_dst_clicked(self, item: Item) -> None:
        """复制译文到剪贴板"""
        clipboard = QApplication.clipboard()
        if clipboard:
            clipboard.setText(item.get_dst())

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_dst_done,
            },
        )

    # ========== 重置翻译功能 ==========
    def on_reset_translation_clicked(self, item: Item) -> None:
        """重置翻译按钮点击"""
        if self.is_readonly:
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_reset_translation_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self.do_batch_reset_translation([item])

    def on_batch_reset_translation_clicked(self, items: list[Item]) -> None:
        """批量重置翻译按钮点击"""
        if self.is_readonly or not items:
            return

        count = len(items)
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_batch_reset_translation_confirm.replace(
                "{COUNT}", str(count)
            ),
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self.do_batch_reset_translation(items)

    def do_batch_reset_translation(self, items: list[Item]) -> None:
        """执行批量重置"""
        for item in items:
            item.set_dst("")
            item.set_status(Base.ProjectStatus.NONE)
            item.set_retry_count(0)

            # 更新 UI 和检查结果
            self.recheck_item(item)
            row = self.table_widget.find_row_by_item(item)
            if row >= 0:
                self.table_widget.update_row_dst(row, "")

    # ========== 重新翻译功能 ==========
    def on_retranslate_clicked(self, item: Item) -> None:
        """重新翻译按钮点击 - 单条翻译也使用批量翻译流程"""
        if self.is_readonly or not self.config:
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_retranslate_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        # 使用统一的批量翻译流程（单条也走这个逻辑）
        self.do_batch_retranslate([item])

    def on_batch_retranslate_clicked(self, items: list[Item]) -> None:
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
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self.do_batch_retranslate(items)

    def do_batch_retranslate(self, items: list[Item]) -> None:
        """执行批量翻译（单条和多条统一入口）"""
        count = len(items)
        # 使用最新配置，而非缓存的 self.config
        config = Config().load()

        # 显示进度 Toast（初始显示"正在处理第 1 个"）
        self.progress_show(
            Localizer.get()
            .task_batch_translation_progress.replace("{CURRENT}", "1")
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
                    .task_batch_translation_progress.replace("{CURRENT}", str(current))
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
                    .task_batch_translation_success.replace(
                        "{SUCCESS}", str(success_count)
                    )
                    .replace("{FAILED}", str(fail_count)),
                },
            )

        threading.Thread(target=batch_translate_task, daemon=True).start()

    def on_translate_done_ui(self, item: Item, success: bool) -> None:
        """翻译完成的 UI 更新（主线程）- 逐条刷新，不显示 Toast（批量流程统一显示）"""
        # 1. 无论是否可见，都更新数据层面的警告状态，确保翻页后状态正确
        if success:
            self.recheck_item(item)

        # 2. 如果条目在当前页可见，更新 UI 显示
        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.set_row_loading(row, False)
            if success:
                self.table_widget.update_row_dst(row, item.get_dst())
            else:
                item.set_status(Base.ProjectStatus.PROCESSED)

    def on_progress_updated_ui(self, content: str, current: int, total: int) -> None:
        """进度更新的 UI 处理（主线程）"""
        self.progress_update(content, current, total)

    def on_progress_finished_ui(self) -> None:
        """进度完成的 UI 处理（主线程）"""
        self.indeterminate_hide()
        # 逐条刷新已在 on_translate_done_ui 中完成，无需再次刷新

    # ========== 保存功能 ==========
    def on_save_clicked(self) -> None:
        """保存按钮点击"""
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()

    def save_data(self) -> None:
        """保存数据到缓存文件（异步执行）"""
        if self.is_readonly or not self.config or not self.items_all:
            self.indeterminate_hide()
            return

        # 捕获当前状态的引用，避免在子线程中访问 self 时产生竞态
        items_all = self.items_all
        review_items = self.items

        def task() -> None:
            try:
                # 直接写入工程数据库
                db = StorageContext.get().get_db()
                if db is None:
                    self.save_done.emit(False)
                    return
                db.set_items([item.to_dict() for item in items_all])

                # 保存条目后，同步更新项目级别元数据
                ctx = StorageContext.get()
                if ctx.is_loaded():
                    # 统计 NONE 状态的条目数量（排除 EXCLUDED 和 DUPLICATED）
                    none_count = sum(
                        1
                        for item in review_items
                        if item.get_status() == Base.ProjectStatus.NONE
                    )

                    # 确定项目状态
                    project_status = (
                        Base.ProjectStatus.PROCESSING
                        if none_count > 0
                        else Base.ProjectStatus.PROCESSED
                    )
                    ctx.set_project_status(project_status)

                    # 重新计算翻译进度
                    extras = ctx.get_translation_extras()
                    # 统计已翻译的条目数量（状态为 PROCESSED 或 PROCESSED_IN_PAST）
                    translated_count = sum(
                        1
                        for item in review_items
                        if item.get_status()
                        in (
                            Base.ProjectStatus.PROCESSED,
                            Base.ProjectStatus.PROCESSED_IN_PAST,
                        )
                    )
                    # 更新已翻译行数（其他字段如 Token 统计保持不变）
                    extras["line"] = translated_count
                    ctx.set_translation_extras(extras)

                self.save_done.emit(True)
            except Exception as e:
                self.error(f"{Localizer.get().proofreading_page_save_failed}", e)
                self.save_done.emit(False)

        threading.Thread(target=task, daemon=True).start()

    # ========== 导出功能 ==========
    def on_export_clicked(self) -> None:
        """导出按钮点击"""
        # 弹框让用户确认
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_export_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        # 先保存数据再导出，保证译文文件与缓存数据一致
        self.pending_export = True
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()

    def on_save_done_ui(self, success: bool) -> None:
        """保存完成的 UI 更新（主线程）"""
        # 检查是否有待处理的导出操作
        pending_export = getattr(self, "pending_export", False)
        self.pending_export = False

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
            # 普通保存流程：成功时触发项目状态检查，失败时弹出错误提示
            self.indeterminate_hide()
            if success:
                # 通知翻译页更新按钮状态
                self.emit(Base.Event.PROJECT_CHECK_RUN, {})
            else:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().proofreading_page_save_failed,
                    },
                )

    def export_data(self) -> None:
        """导出数据（异步执行）"""
        if not self.config or not self.items_all:
            self.export_done.emit(False, "")
            return

        # 捕获当前状态的引用，避免子线程中访问 self 时产生竞态
        config = self.config
        items_all = self.items_all

        def task() -> None:
            try:
                FileManager(config).write_to_path(items_all)
                self.export_done.emit(True, "")
            except Exception as e:
                self.error("Export failed", e)
                self.export_done.emit(False, str(e))

        threading.Thread(target=task, daemon=True).start()

    def on_export_done_ui(self, success: bool, error_msg: str) -> None:
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
    def on_engine_status_changed(self, event: Base.Event, data: dict) -> None:
        """Engine 状态变更事件"""
        self.check_engine_status()

    def check_engine_status(self) -> None:
        """检查并更新只读模式"""
        # 获取全局引擎状态，确保 UI 状态与后台任务一致
        engine_status = Engine.get().get_status()
        is_busy = engine_status in (
            Base.TaskStatus.TRANSLATING,
            Base.TaskStatus.STOPPING,
        )

        # 1. 如果处于翻译中/停止中，清空页面数据
        if is_busy and (self.items or self.items_all):
            self.items_all = []
            self.items = []
            self.filtered_items = []
            self.warning_map = {}
            self.table_widget.set_items([], {})
            self.pagination_bar.reset()

        # 2. 更新按钮状态
        has_items_all = bool(self.items_all)
        has_items = bool(self.items)

        # 加载按钮在繁忙时禁用
        self.btn_load.setEnabled(not is_busy)

        # 其他按钮只有在不繁忙且有数据时启用
        can_operate_export = not is_busy and has_items_all
        can_operate_review = not is_busy and has_items
        self.btn_save.setEnabled(can_operate_export)
        self.btn_export.setEnabled(can_operate_export)
        self.btn_search.setEnabled(can_operate_review)
        self.btn_filter.setEnabled(can_operate_review)

        if is_busy != self.is_readonly:
            self.is_readonly = is_busy
            self.table_widget.set_readonly(is_busy)

    def showEvent(self, a0: QShowEvent | None) -> None:
        """页面显示时自动刷新状态，确保与全局翻译任务同步"""
        super().showEvent(a0)
        self.check_engine_status()

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

    def on_translation_reset(self, event: Base.Event, data: dict) -> None:
        """响应翻译重置事件"""
        self.clear_all_data()

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        """工程卸载后清理数据"""
        self.clear_all_data()
        self.config = None

    def clear_all_data(self) -> None:
        """彻底清理页面所有数据和 UI 状态"""
        # 清空数据
        self.items_all = []
        self.items = []
        self.filtered_items = []
        self.warning_map = {}
        self.result_checker = None
        self.filter_options = {}

        # 清空搜索状态
        self.search_keyword = ""
        self.search_is_regex = False
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()
        self.search_card.setVisible(False)
        self.attach_pagination_to_command_bar()
        self.command_bar_card.setVisible(True)

        # 重置表格和分页
        self.table_widget.set_items([], {})
        self.pagination_bar.reset()

        # 重置按钮状态
        self.btn_save.setEnabled(False)
        self.btn_export.setEnabled(False)
        self.btn_search.setEnabled(False)
        self.btn_filter.setEnabled(False)

        # 隐藏 loading
        self.indeterminate_hide()
