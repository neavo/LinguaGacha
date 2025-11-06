"""
结果修正页面

自动检测并修正翻译结果中的问题：
1. 源语言字符残留
2. 术语未生效
"""

import threading
from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtWidgets import QWidget, QLayout, QVBoxLayout, QTextEdit, QScrollArea
from qfluentwidgets import FluentIcon, PushButton, FluentWindow, ProgressBar, InfoBar, InfoBarPosition

from base.Base import Base
from module.Config import Config
from module.Cache.CacheManager import CacheManager
from module.Toolkit.ResultFixer.ResultFixer import ResultFixer
from module.Localizer.Localizer import Localizer
from widget.EmptyCard import EmptyCard
from widget.CommandBarCard import CommandBarCard


class FixerThread(QThread):
    """后台线程执行修正"""
    finished = pyqtSignal(object)  # 完成信号
    error = pyqtSignal(str)  # 错误信号

    def __init__(self):
        super().__init__()

    def run(self):
        try:
            # 直接加载缓存（无需翻译器）
            config = Config().load()
            cache_manager = CacheManager(service=False)  # 不启用自动保存
            cache_manager.load_from_file(config.output_folder)

            # 验证缓存已加载
            if cache_manager.get_item_count() == 0:
                raise RuntimeError("未找到缓存数据，请先完成翻译")

            fixer = ResultFixer(cache_manager)
            report = fixer.fix_all()
            self.finished.emit(report)
        except Exception as e:
            self.error.emit(str(e))


class ResultFixerPage(QWidget, Base):
    """结果修正页面"""

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.fixer_thread = None

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_head(self.root, config, window)
        self.add_widget_body(self.root, config, window)

        # 绑定事件
        self.bind_events()

    # 头部
    def add_widget_head(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        # 创建头部卡片
        head_card = EmptyCard(
            title="智能结果修正",
            description=(
                "【功能说明】\n"
                "自动检测并修正翻译结果中的常见问题：\n"
                "• 源语言残留 - 译文中遗留未翻译的源语言字符\n"
                "• 术语未生效 - 术语表中的专有名词未被正确应用\n\n"

                "【使用说明】\n"
                "• 至少配置 1 个有效平台（有效平台 = 已配置真实 API key 的平台，非 \"no_key_required\"）\n"
                "• 建议配置 2-3 个不同 API 平台（如 OpenAI + Anthropic）以提高修正成功率\n"
                "• 建议在翻译完成后运行，一次性修正所有问题\n"
                "• 如有失败项，可多次运行本功能，逐步修正至全部成功\n\n"

                "【核心特性】\n"
                "✅ 智能多平台轮换（支持 OpenAI、Anthropic、Google 等跨 API 切换）\n"
                "✅ 全自动并行处理（172个问题约40-50秒）\n"
                "✅ 支持反复执行，直到全部修正成功\n"
                "✅ 自动备份缓存，修正失败自动恢复"
            ),
            init=None,
        )

        # 设置 description 自动换行
        head_card.get_description_label().setWordWrap(True)

        # 创建滚动区域容器
        scroll_area = QScrollArea()
        scroll_area.setWidget(head_card)
        scroll_area.setWidgetResizable(True)
        scroll_area.setMaximumHeight(200)  # 限制最大高度
        scroll_area.setFrameShape(QScrollArea.NoFrame)  # 去掉边框
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)  # 禁用水平滚动条
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)  # 需要时显示垂直滚动条

        parent.addWidget(scroll_area)

    # 主体
    def add_widget_body(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        # 创建控制卡片（只包含标题和按钮）
        control_card = EmptyCard(
            title="开始修正",
            description=(
                "点击下方按钮开始检测和修正问题\n\n"
                "💡 温馨提示：\n"
                "• 如有失败项，可再次运行本功能继续修正\n"
                "• 如反复修正多次仍然失败，建议：\n"
                "  1. 增加更多模型配置（如添加 Anthropic、Google 等不同 API）\n"
                "  2. 或手动检查并修复这些失败问题"
            ),
            init=None,
        )

        # 设置 description 自动换行
        control_card.get_description_label().setWordWrap(True)

        # 添加开始按钮到控制卡片
        self.start_button = PushButton(FluentIcon.PLAY, "开始修正")
        self.start_button.clicked.connect(lambda: self.on_start_fix(window))
        control_card.add_widget(self.start_button)

        parent.addWidget(control_card)

        # 创建独立的日志卡片（使用 CardWidget + VBoxLayout）
        from qfluentwidgets import CardWidget
        log_card = CardWidget(self)
        log_card.setBorderRadius(4)

        # 创建垂直布局
        log_layout = QVBoxLayout(log_card)
        log_layout.setContentsMargins(16, 16, 16, 16)
        log_layout.setSpacing(8)

        # 添加进度条
        self.progress_bar = ProgressBar()
        self.progress_bar.setVisible(False)
        log_layout.addWidget(self.progress_bar)

        # 添加日志显示
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setPlaceholderText("点击'开始修正'后，修正日志将显示在这里...")
        self.log_text.setMinimumHeight(300)
        log_layout.addWidget(self.log_text)

        parent.addWidget(log_card)
        parent.addStretch(1)

    def bind_events(self):
        """绑定事件"""
        self.subscribe(Base.Event.RESULT_FIXER_START, self.on_fix_start)
        self.subscribe(Base.Event.RESULT_FIXER_UPDATE, self.on_fix_update)
        self.subscribe(Base.Event.RESULT_FIXER_DONE, self.on_fix_done)

    def on_start_fix(self, window: FluentWindow):
        """开始修正"""
        self.log_text.clear()
        self.log_text.append("正在检测问题...")
        self.start_button.setEnabled(False)

        # 在后台线程运行
        self.fixer_thread = FixerThread()
        self.fixer_thread.finished.connect(self.on_thread_finished)
        self.fixer_thread.error.connect(self.on_thread_error)
        self.fixer_thread.start()

    def on_fix_start(self, event: str, data: dict):
        """修正开始"""
        total = data["total"]
        valid_platforms = data.get("valid_platforms", [])

        self.progress_bar.setVisible(True)
        self.progress_bar.setMaximum(total)
        self.progress_bar.setValue(0)

        # 显示有效平台信息
        platform_info = "、".join(valid_platforms) if valid_platforms else "无"
        self.log_text.append(f"发现有效平台 {len(valid_platforms)} 个：{platform_info}")
        self.log_text.append(f"\n检测到 {total} 个问题，开始修正...")
        self.log_text.append("━" * 60 + "\n")

    def on_fix_update(self, event: str, data: dict):
        """修正进度更新"""
        current = data["current"]
        total = data["total"]
        success = data["success"]
        problem_type = data.get("problem_type", "")
        problem_details = data.get("problem_details", "")
        attempts = data.get("attempts", 0)
        src_preview = data.get("src_preview", "")
        final_dst_preview = data.get("final_dst_preview", "")
        platform_name = data.get("platform_name", "")
        error_message = data.get("error_message", "")

        self.progress_bar.setValue(current)

        # 问题类型中文化
        problem_type_zh = {
            "residue": "源语言残留",
            "glossary_miss": "术语未生效"
        }.get(problem_type, problem_type)

        # 格式化显示
        if success:
            status_icon = "✓"
            self.log_text.append(f"[{current}/{total}] {status_icon} 修正成功")
            self.log_text.append(f"  • 问题类型：{problem_type_zh}（{problem_details}）")
            self.log_text.append(f"  • 原文片段：「{src_preview}」")
            self.log_text.append(f"  • 尝试次数：{attempts} 次（使用平台：{platform_name}）\n")
        else:
            status_icon = "✗"
            self.log_text.append(f"[{current}/{total}] {status_icon} 修正失败")
            self.log_text.append(f"  • 问题类型：{problem_type_zh}（{problem_details}）")
            self.log_text.append(f"  • 原文片段：「{src_preview}」")
            self.log_text.append(f"  • 最终译文：「{final_dst_preview}」")
            self.log_text.append(f"  • 尝试次数：{attempts} 次")
            if error_message:
                self.log_text.append(f"  • 失败原因：{error_message}\n")
            else:
                self.log_text.append("")

        # 自动滚动到底部
        self.log_text.verticalScrollBar().setValue(
            self.log_text.verticalScrollBar().maximum()
        )

    def on_fix_done(self, event: str, data: dict):
        """修正完成"""
        report = data["report"]
        self.log_text.append("\n" + "━" * 60)
        self.log_text.append("修正完成！\n")
        self.log_text.append(f"总问题数：{report.total}")
        self.log_text.append(f"修正成功：{report.fixed} ({report.fixed/report.total*100:.1f}%)" if report.total > 0 else "修正成功：0")
        self.log_text.append(f"修正失败：{report.failed} ({report.failed/report.total*100:.1f}%)" if report.total > 0 else "修正失败：0")
        self.log_text.append(f"备份路径：{report.backup_path}")
        self.log_text.append("━" * 60)

        # 添加简单的完成提示
        if report.failed == 0:
            self.log_text.append("\n🎉 所有问题修正成功！")
        else:
            self.log_text.append(f"\n⚠️  仍有 {report.failed} 个问题未能修正")

        # 自动滚动到底部
        self.log_text.verticalScrollBar().setValue(
            self.log_text.verticalScrollBar().maximum()
        )

        # 显示提示
        if report.failed == 0:
            InfoBar.success(
                title="修正完成",
                content=f"成功修正 {report.fixed} 个问题",
                parent=self,
                position=InfoBarPosition.TOP
            )
        else:
            InfoBar.warning(
                title="修正完成",
                content=f"成功 {report.fixed} 个，失败 {report.failed} 个",
                parent=self,
                position=InfoBarPosition.TOP
            )

    def on_thread_finished(self, report):
        """线程完成"""
        self.start_button.setEnabled(True)
        self.progress_bar.setVisible(False)

    def on_thread_error(self, error_msg: str):
        """线程错误"""
        self.start_button.setEnabled(True)
        self.progress_bar.setVisible(False)
        self.log_text.append(f"\n❌ 修正失败：{error_msg}")

        InfoBar.error(
            title="修正失败",
            content=error_msg,
            parent=self,
            position=InfoBarPosition.TOP
        )
