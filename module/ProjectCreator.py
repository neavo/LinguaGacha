"""工程创建器

负责将源文件目录转换为 .lg 工程文件：
1. 递归扫描源目录
2. 压缩文件并存入数据库
3. 解析文件内容提取翻译条目
"""

import os
from pathlib import Path

from base.Base import Base
from module.Config import Config
from module.DataAccessLayer import DataAccessLayer
from module.File.FileManager import FileManager
from module.Storage.AssetCompressor import AssetCompressor
from module.Storage.LGDatabase import LGDatabase


class ProjectCreator(Base):
    """工程创建器"""

    # 支持的文件扩展名
    SUPPORTED_EXTENSIONS = {
        ".txt",
        ".md",
        ".json",
        ".xlsx",
        ".epub",
        ".ass",
        ".srt",
        ".rpy",
        ".trans",
    }

    def __init__(self) -> None:
        super().__init__()
        self._progress_callback = None

    def set_progress_callback(self, callback) -> None:
        """设置进度回调函数 callback(current, total, message)"""
        self._progress_callback = callback

    def _report_progress(self, current: int, total: int, message: str) -> None:
        """报告进度"""
        if self._progress_callback:
            self._progress_callback(current, total, message)

    def create(
        self,
        source_path: str,
        output_path: str,
    ) -> LGDatabase:
        """创建工程

        Args:
            source_path: 源文件或目录路径
            output_path: 输出的 .lg 文件路径

        Returns:
            创建的 LGDatabase 实例
        """

        # 确保输出目录存在
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # 删除已存在的文件
        if os.path.exists(output_path):
            os.remove(output_path)

        # 创建数据库
        project_name = Path(source_path).name
        db = LGDatabase.create(output_path, project_name)

        # 收集源文件
        source_files = self._collect_source_files(source_path)
        total_files = len(source_files)

        self._report_progress(0, total_files, "正在收纳资产...")

        # 收纳资产
        for i, file_path in enumerate(source_files):
            self._ingest_asset(db, source_path, file_path)
            self._report_progress(
                i + 1, total_files, f"正在收纳: {Path(file_path).name}"
            )

        # 解析翻译条目
        self._report_progress(total_files, total_files, "正在解析翻译条目...")

        # 构造 Config 对象指向源目录
        config = Config().load()

        # 使用准备模式上下文，避免 FileManager 复制文件到 cache
        with DataAccessLayer.prepare_mode_context():
            # 使用 FileManager 读取翻译条目
            _, items = FileManager(config).read_from_path()

        # 将条目保存到数据库
        if items:
            db.set_items([item.to_dict() for item in items])

            # 初始化翻译进度元数据
            # 这样在未开始翻译前也能显示正确的进度（0%），且无需遍历所有条目
            extras = {
                "total_line": len(items),
                "line": 0,
                "total_tokens": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "time": 0,
            }
            db.set_meta("translation_extras", extras)

        self._report_progress(total_files, total_files, "工程创建完成")

        return db

    def _collect_source_files(self, source_path: str) -> list[str]:
        """收集源文件列表"""
        source_files = []

        if os.path.isfile(source_path):
            # 单个文件
            if self._is_supported_file(source_path):
                source_files.append(source_path)
        else:
            # 目录递归扫描
            for root, _, files in os.walk(source_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    if self._is_supported_file(file_path):
                        source_files.append(file_path)

        return source_files

    def _is_supported_file(self, file_path: str) -> bool:
        """检查是否为支持的文件类型"""
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def _ingest_asset(self, db: LGDatabase, base_path: str, file_path: str) -> None:
        """收纳单个资产到数据库"""
        # 计算相对路径
        if os.path.isfile(base_path):
            relative_path = Path(file_path).name
        else:
            relative_path = os.path.relpath(file_path, base_path)

        # 压缩文件
        compressed_data, original_size = AssetCompressor.compress_file(file_path)

        # 存入数据库
        db.add_asset(relative_path, compressed_data, original_size)


class ProjectLoader(Base):
    """工程加载器"""

    @staticmethod
    def get_project_preview(lg_path: str) -> dict:
        """获取工程预览信息（不完全加载）

        使用短连接模式，操作完成后自动关闭，WAL 文件会被清理。
        用于在工作台中显示项目详情。
        """
        if not os.path.exists(lg_path):
            raise FileNotFoundError(f"工程文件不存在: {lg_path}")

        # 使用短连接模式（不调用 open()）
        db = LGDatabase(lg_path)
        return db.get_project_summary()
