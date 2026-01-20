import re
from typing import Any

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Storage.DataStore import DataStore
from module.Storage.StorageContext import StorageContext
from widget.CommandBarCard import CommandBarCard
from widget.EmptyCard import EmptyCard
from widget.SearchCard import SearchCard


class NameFieldExtractionPage(QWidget, Base):
    BASE: str = "name_field_extraction"

    # 定义信号用于跨线程更新 UI
    update_signal = pyqtSignal(int)

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 数据存储
        # 结构: [{"src": str, "dst": str, "context": str, "status": str}]
        self.items: list[dict[str, Any]] = []

        # 添加控件
        self.add_widget_head(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_foot(self.root, config, window)

        # 注册事件
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)

        # 连接信号
        self.update_signal.connect(self.update_row)

    # 头部
    def add_widget_head(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        parent.addWidget(
            EmptyCard(
                title=Localizer.get().name_field_extraction_page,
                description=Localizer.get().name_field_extraction_page_desc,
                init=None,
            )
        )

    # 主体
    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def delete_row() -> None:
            row = self.table.currentRow()
            if row >= 0 and row < len(self.items):
                del self.items[row]
                self.refresh_table()

        def custom_context_menu_requested(position: QPoint) -> None:
            menu = RoundMenu("", self.table)
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().quality_delete_row,
                    triggered=delete_row,
                )
            )
            menu.exec(self.table.viewport().mapToGlobal(position))

        self.table = TableWidget(self)
        parent.addWidget(self.table)

        # 设置表格属性
        self.table.setColumnCount(3)
        self.table.setBorderVisible(False)
        self.table.setSelectRightClickedRow(True)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(True)

        # 设置表格列宽
        self.table.setColumnWidth(0, 300)
        self.table.setColumnWidth(1, 300)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )

        # 设置水平表头
        self.table.verticalHeader().setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        self.table.setHorizontalHeaderLabels(
            (
                Localizer.get().glossary_page_table_row_01,  # 原文
                Localizer.get().glossary_page_table_row_02,  # 译文
                Localizer.get().proofreading_page_col_status,  # 状态
            )
        )

        # 绑定表格修改事件
        self.table.itemChanged.connect(self.on_table_item_changed)
        self.table.customContextMenuRequested.connect(custom_context_menu_requested)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

        self.table.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Interactive
        )

        self.refresh_table()

    # 底部
    def add_widget_foot(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        # 创建搜索栏
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        def back_clicked(widget: SearchCard) -> None:
            self.search_card.setVisible(False)
            self.command_bar_card.setVisible(True)

        self.search_card.on_back_clicked(back_clicked)

        def prev_clicked(widget: SearchCard) -> None:
            keyword: str = widget.get_line_edit().text().strip()
            self.search(keyword, reverse=True)

        def next_clicked(widget: SearchCard) -> None:
            keyword: str = widget.get_line_edit().text().strip()
            self.search(keyword, reverse=False)

        self.search_card.on_prev_clicked(prev_clicked)
        self.search_card.on_next_clicked(next_clicked)
        self.search_card.on_search_triggered(next_clicked)

        # 创建命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.command_bar_card.set_minimum_width(640)

        # 提取按钮
        self.add_command_bar_action_extract(self.command_bar_card)
        # 翻译按钮
        self.add_command_bar_action_translate(self.command_bar_card)

        self.command_bar_card.add_separator()

        # 搜索按钮
        self.add_command_bar_action_search(self.command_bar_card)

        self.command_bar_card.add_separator()

        # 重置按钮
        self.add_command_bar_action_reset(self.command_bar_card)

        self.command_bar_card.add_separator()

        # 导入按钮

        self.add_command_bar_action_save(self.command_bar_card)

    # 提取操作
    def add_command_bar_action_extract(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.extract_names()

        parent.add_action(
            Action(
                FluentIcon.SYNC,
                Localizer.get().name_field_extraction_action_extract,
                parent,
                triggered=triggered,
            ),
        )

    # 翻译操作
    def add_command_bar_action_translate(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.translate_names()

        parent.add_action(
            Action(
                FluentIcon.LANGUAGE,
                Localizer.get().name_field_extraction_action_translate,
                parent,
                triggered=triggered,
            ),
        )

    # 重置操作
    def add_command_bar_action_reset(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.reset_table()

        parent.add_action(
            Action(
                FluentIcon.DELETE,
                Localizer.get().quality_reset,
                parent,
                triggered=triggered,
            ),
        )

    # 保存操作
    def add_command_bar_action_save(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.save_to_glossary()

        parent.add_action(
            Action(
                FluentIcon.SAVE,
                Localizer.get().name_field_extraction_action_import,
                parent,
                triggered=triggered,
            ),
        )

    # 搜索操作
    def add_command_bar_action_search(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.search_card.setVisible(True)
            self.command_bar_card.setVisible(False)

        parent.add_action(
            Action(
                FluentIcon.SEARCH,
                Localizer.get().search,
                parent,
                triggered=triggered,
            ),
        )

    # ================= 业务逻辑 =================

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        """工程加载完成事件"""
        # 可以选择自动加载，也可以等待用户操作。这里保持空白比较安全。
        pass

    def extract_names(self) -> None:
        """从工程中提取名字，并智能匹配最佳上下文"""
        db = StorageContext.get().get_db()
        if db is None:
            self.show_toast(Base.ToastType.ERROR, Localizer.get().alert_no_data)
            return

        # 获取所有 Items
        items = [Item.from_dict(d) for d in db.get_all_items()]

        if not items:
            self.show_toast(Base.ToastType.WARNING, Localizer.get().alert_no_data)
            return

        # 获取现有术语表用于预填
        glossary_rules = db.get_rules(DataStore.RuleType.GLOSSARY)

        glossary_map = {rule["src"]: rule["dst"] for rule in glossary_rules}

        # 临时存储：name -> context list
        name_contexts: dict[str, list[str]] = {}

        # 扫描工程
        for item in items:
            name_src = item.get_name_src()
            names_to_process = []

            if isinstance(name_src, str):
                names_to_process.append(name_src)
            elif isinstance(name_src, list):
                names_to_process.extend(name_src)

            # 只有当该条目也有正文时，才将其正文作为上下文
            context = item.get_src()
            if not context:
                continue

            for name in names_to_process:
                if not name:
                    continue
                if name not in name_contexts:
                    name_contexts[name] = []
                name_contexts[name].append(context)

        # 构建最终列表
        new_items: list[dict] = []

        for name, contexts in name_contexts.items():
            # 上下文选择策略：选择长度最长的一条台词，通常语义更完整
            best_context = max(contexts, key=len) if contexts else ""

            # 预填现有翻译
            dst = glossary_map.get(name, "")

            new_items.append(
                {
                    "src": name,
                    "dst": dst,
                    "context": best_context,
                    "status": Localizer.get().proofreading_page_status_processed
                    if dst
                    else Localizer.get().proofreading_page_status_none,
                }
            )

        # 按原文排序
        new_items.sort(key=lambda x: x["src"])
        self.items = new_items

        self.refresh_table()
        self.show_toast(Base.ToastType.SUCCESS, Localizer.get().task_success)

    def reset_table(self) -> None:
        """重置表格（清空列表）"""
        if not self.items:
            return

        title = Localizer.get().alert
        content = Localizer.get().quality_reset_alert

        # 弹窗确认
        w = MessageBox(title, content, self.window())
        if w.exec():
            self.items = []
            self.refresh_table()
            self.show_toast(Base.ToastType.SUCCESS, Localizer.get().quality_reset_toast)

    def refresh_table(self) -> None:
        """完全刷新表格显示"""
        self.table.blockSignals(True)  # 暂停信号，避免批量更新时触发 itemChanged

        # 确保至少有 30 行，避免页面空白
        target_count = max(30, len(self.items))
        self.table.setRowCount(target_count)

        for row in range(target_count):
            if row < len(self.items):
                item_data = self.items[row]
                src = item_data["src"]
                dst = item_data["dst"]
                status = item_data["status"]
                tooltip = f"{Localizer.get().name_field_extraction_context}:\n{item_data['context']}"
            else:
                # 空白行
                src = ""
                dst = ""
                status = ""
                tooltip = ""

            # 原文 (带上下文 Tooltip)
            item_src = self.table.item(row, 0)
            if not item_src:
                item_src = QTableWidgetItem()
                item_src.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.table.setItem(row, 0, item_src)

            item_src.setText(src)
            item_src.setToolTip(tooltip)
            item_src.setFlags(item_src.flags() & ~Qt.ItemFlag.ItemIsEditable)  # 只读

            # 译文
            item_dst = self.table.item(row, 1)
            if not item_dst:
                item_dst = QTableWidgetItem()
                item_dst.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.table.setItem(row, 1, item_dst)

            item_dst.setText(dst)
            if not src:
                # 如果没有原文，译文也禁止编辑，避免误操作
                item_dst.setFlags(item_dst.flags() & ~Qt.ItemFlag.ItemIsEditable)
            else:
                # 恢复可编辑状态
                item_dst.setFlags(item_dst.flags() | Qt.ItemFlag.ItemIsEditable)

            # 状态
            item_status = self.table.item(row, 2)
            if not item_status:
                item_status = QTableWidgetItem()
                item_status.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.table.setItem(row, 2, item_status)

            item_status.setText(status)
            item_status.setFlags(
                item_status.flags() & ~Qt.ItemFlag.ItemIsEditable
            )  # 只读

        self.table.blockSignals(False)

    def on_table_item_changed(self, item: QTableWidgetItem) -> None:
        """处理表格手动编辑"""
        row = item.row()
        col = item.column()

        # 越界检查 (防止编辑空白行导致崩溃)
        if row >= len(self.items):
            return

        # 只有译文列(1)是可编辑的
        if col == 1:
            new_val = item.text().strip()
            self.items[row]["dst"] = new_val
            # 如果用户手动输入了内容，状态设为 Processed，否则 None
            self.items[row]["status"] = (
                Localizer.get().proofreading_page_status_processed
                if new_val
                else Localizer.get().proofreading_page_status_none
            )

            # 更新状态列显示
            self.table.blockSignals(True)
            item_status = self.table.item(row, 2)
            if item_status:
                item_status.setText(self.items[row]["status"])
            self.table.blockSignals(False)

    def translate_names(self) -> None:
        """翻译列表中的名字"""
        # 找出需要翻译的索引
        indices_to_translate = []
        for i, item in enumerate(self.items):
            if not item["dst"]:  # 只翻译未完成的
                indices_to_translate.append(i)

        if not indices_to_translate:
            self.show_toast(Base.ToastType.WARNING, Localizer.get().alert_no_data)
            return

        config = Config().load()
        if not config.activate_model_id:
            self.show_toast(
                Base.ToastType.ERROR, Localizer.get().model_selector_page_fail
            )
            return

        # 更新状态为 处理中
        self.table.blockSignals(True)
        for i in indices_to_translate:
            self.items[i]["status"] = (
                Localizer.get().translation_page_status_translating
            )
            item_status = self.table.item(i, 2)
            if item_status:
                item_status.setText(Localizer.get().translation_page_status_translating)
        self.table.blockSignals(False)

        # 启动翻译任务
        for i in indices_to_translate:
            self.start_single_translation(i, config)

    def start_single_translation(self, index: int, config: Config) -> None:
        item_data = self.items[index]
        src_name = item_data["src"]
        context = item_data["context"]

        # 构造 prompt: "【名字】\n参考台词"
        # 这样模型能看到名字在对话中的用法
        prompt_src = f"【{src_name}】\n{context}"

        # 构造临时 Item
        temp_item = Item()
        temp_item.set_src(prompt_src)
        # 使用 NONE 类型，避免特殊正则处理干扰，或者使用 TXT
        temp_item.set_file_type(Item.FileType.TXT)
        temp_item.set_text_type(Item.TextType.NONE)

        # 回调函数
        def callback(result_item: Item, success: bool) -> None:
            if success:
                raw_dst = result_item.get_dst()
                # 尝试提取 【】 中的内容
                match = re.search(r"【(.*?)】", raw_dst)
                if match:
                    final_name = match.group(1)
                else:
                    # 如果没有匹配到括号，可能模型直接输出了名字，也可能输出了整句
                    # 这是一个 fallback。如果结果太长，可能是有问题的
                    if len(raw_dst) < len(src_name) * 3 + 10:  # 简单启发式
                        final_name = raw_dst
                    else:
                        # 翻译失败或格式错误，保持原样或标记错误
                        final_name = ""

                # 更新内存数据 (检查用户是否在翻译期间修改了)
                if not self.items[index]["dst"]:
                    self.items[index]["dst"] = final_name

                self.items[index]["status"] = (
                    Localizer.get().proofreading_page_status_processed
                    if self.items[index]["dst"]
                    else "Format Error"
                )
            else:
                self.items[index]["status"] = "Network Error"

            # 通知主线程刷新
            self.update_signal.emit(index)

        # 发送请求
        Engine.get().translate_single_item(temp_item, config, callback)

    def update_row(self, row: int) -> None:
        """信号槽：更新指定行的 UI"""
        if 0 <= row < self.table.rowCount():
            item_data = self.items[row]

            self.table.blockSignals(True)
            # 更新译文
            item_dst = self.table.item(row, 1)
            if item_dst and item_dst.text() != item_data["dst"]:
                item_dst.setText(item_data["dst"])
            # 更新状态
            item_status = self.table.item(row, 2)
            if item_status:
                item_status.setText(item_data["status"])
            self.table.blockSignals(False)

    def save_to_glossary(self) -> None:
        """保存到术语表"""
        db = StorageContext.get().get_db()
        if db is None:
            return

        # 获取现有 Glossary (src -> rule dict)
        current_rules = db.get_rules(DataStore.RuleType.GLOSSARY)
        glossary_map = {rule["src"]: rule for rule in current_rules}

        count = 0
        for item in self.items:
            src = item["src"]
            dst = item["dst"]

            if not dst:
                continue

            # 检查是否需要更新
            if src in glossary_map:
                if glossary_map[src]["dst"] != dst:
                    glossary_map[src]["dst"] = dst
                    count += 1
            else:
                # 新增
                glossary_map[src] = {
                    "src": str(src),
                    "dst": str(dst),
                    "info": "",  # 默认为空
                    "case_sensitive": False,
                }
                count += 1

        if count > 0:
            # 写回 DB
            new_rules: list[dict[str, Any]] = list(glossary_map.values())

            # 简单按 src 排序
            new_rules.sort(key=lambda x: x["src"])
            db.set_rules(DataStore.RuleType.GLOSSARY, new_rules)

            # 发送全局刷新事件，通知术语表页面更新
            self.emit(Base.Event.GLOSSARY_REFRESH, {})

            self.show_toast(Base.ToastType.SUCCESS, Localizer.get().quality_save_toast)
        else:
            self.show_toast(
                Base.ToastType.INFO, Localizer.get().task_success
            )  # 无需更新

    def search(self, keyword: str, reverse: bool = False) -> None:
        """搜索表格"""
        if not keyword:
            self.search_card.clear_match_info()
            return

        row_count = self.table.rowCount()

        # 避免只有一行或空表时的无意义操作
        if row_count < 1:
            return

        # 获取搜索配置
        use_regex = self.search_card.is_regex_mode()

        # 预编译正则
        pattern = None
        if use_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                # 正则错误时不执行搜索
                self.search_card.clear_match_info()
                return

        # 1. 扫描所有匹配项
        matches: list[int] = []
        for row in range(row_count):
            # 获取原文和译文
            item_src = self.table.item(row, 0)
            item_dst = self.table.item(row, 1)

            src_text = item_src.text() if item_src else ""
            dst_text = item_dst.text() if item_dst else ""

            # 跳过空数据行
            if not src_text and not dst_text:
                continue

            is_match = False
            if use_regex and pattern:
                if pattern.search(src_text) or pattern.search(dst_text):
                    is_match = True
            else:
                # 普通模式：不区分大小写
                if (
                    keyword.lower() in src_text.lower()
                    or keyword.lower() in dst_text.lower()
                ):
                    is_match = True

            if is_match:
                matches.append(row)

        # 2. 更新 UI 显示
        total_matches = len(matches)
        if total_matches == 0:
            self.search_card.clear_match_info()
            self.show_toast(Base.ToastType.WARNING, Localizer.get().search_no_match)
            return

        # 3. 计算跳转目标
        current_row = self.table.currentRow()
        target_row = -1

        if reverse:
            # 向上查找：找小于 current_row 的最大值
            prev_matches = [m for m in matches if m < current_row]
            if prev_matches:
                target_row = prev_matches[-1]
            else:
                # 循环到末尾
                target_row = matches[-1]
        else:
            # 向下查找：找大于 current_row 的最小值
            next_matches = [m for m in matches if m > current_row]
            if next_matches:
                target_row = next_matches[0]
            else:
                # 循环到开头
                target_row = matches[0]

        # 计算当前是第几个匹配 (1-based)
        current_match_index = matches.index(target_row) + 1
        self.search_card.set_match_info(current_match_index, total_matches)

        # 4. 执行跳转
        self.table.setCurrentCell(target_row, 0)
        item = self.table.item(target_row, 0)
        if item:
            self.table.scrollToItem(item)

    def show_toast(self, type: Base.ToastType, message: str) -> None:
        self.emit(
            Base.Event.TOAST,
            {
                "type": type,
                "message": message,
            },
        )
