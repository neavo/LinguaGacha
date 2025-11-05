"""
结果修正页面

自动检测并修正翻译结果中的问题：
1. 源语言字符残留
2. 术语未生效
"""

import threading
from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtWidgets import QWidget, QLayout, QVBoxLayout, QTextEdit
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
        parent.addWidget(
            EmptyCard(
                title="结果修正",
                description=(
                    "自动检测并修正翻译结果中的问题：\n"
                    "1. 源语言字符残留（如中文→英文时译文中仍有中文字符）\n"
                    "2. 术语未生效（术语表规定的译法未被使用）\n\n"
                    "修正过程会自动备份原结果，使用渐进式增强提示词和温度递减策略进行最多3次重试。"
                ),
                init=None,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        # 创建卡片容器
        card = EmptyCard(
            title="开始修正",
            description="点击下方按钮开始检测和修正问题",
            init=None,
        )

        # 添加开始按钮
        self.start_button = PushButton(FluentIcon.PLAY, "开始修正")
        self.start_button.clicked.connect(lambda: self.on_start_fix(window))
        card.add_widget(self.start_button)

        # 添加进度条
        self.progress_bar = ProgressBar()
        self.progress_bar.setVisible(False)
        card.add_widget(self.progress_bar)

        # 添加日志显示
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setPlaceholderText("点击'开始修正'后，修正日志将显示在这里...")
        self.log_text.setMinimumHeight(300)
        card.add_widget(self.log_text)

        parent.addWidget(card)
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
        self.progress_bar.setVisible(True)
        self.progress_bar.setMaximum(total)
        self.progress_bar.setValue(0)
        self.log_text.append(f"\n检测到 {total} 个问题，开始修正...\n")

    def on_fix_update(self, event: str, data: dict):
        """修正进度更新"""
        current = data["current"]
        total = data["total"]
        success = data["success"]

        self.progress_bar.setValue(current)
        status = "✓ 成功" if success else "✗ 失败"
        self.log_text.append(f"[{current}/{total}] {status}")

    def on_fix_done(self, event: str, data: dict):
        """修正完成"""
        report = data["report"]
        self.log_text.append("\n" + "="*50)
        self.log_text.append("修正完成！")
        self.log_text.append(f"总问题数：{report.total}")
        self.log_text.append(f"修正成功：{report.fixed}")
        self.log_text.append(f"修正失败：{report.failed}")
        success_rate = f"{report.fixed/report.total*100:.1f}%" if report.total > 0 else "N/A"
        self.log_text.append(f"成功率：{success_rate}")
        self.log_text.append(f"备份路径：{report.backup_path}")
        self.log_text.append("="*50)

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
