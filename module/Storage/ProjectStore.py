from collections.abc import Callable
from pathlib import Path

from base.Base import Base
from module.Config import Config
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.QualityRuleManager import QualityRuleManager
from module.Storage.AssetStore import AssetStore
from module.Storage.DataStore import DataStore


# 进度回调类型：callback(current, total, message)
ProgressCallback = Callable[[int, int, str], None]


class ProjectStore(Base):
    """工程存储管理器"""

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
        self.progress_callback: ProgressCallback | None = None

    def set_progress_callback(self, callback: ProgressCallback | None) -> None:
        """设置进度回调函数 callback(current, total, message)"""
        self.progress_callback = callback

    def report_progress(self, current: int, total: int, message: str) -> None:
        """报告进度"""
        if self.progress_callback is None:
            return
        self.progress_callback(current, total, message)

    def create(
        self,
        source_path: str,
        output_path: str,
    ) -> DataStore:
        """创建工程

        Args:
            source_path: 源文件或目录路径
            output_path: 输出的 .lg 文件路径

        Returns:
            创建的 DataStore 实例
        """
        # 确保输出目录存在
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # 删除已存在的文件
        if Path(output_path).exists():
            Path(output_path).unlink()

        # 创建数据库
        project_name = Path(source_path).name
        db = DataStore.create(output_path, project_name)

        # 初始化质量规则
        QualityRuleManager.get().initialize_project_rules(db)

        # 收集源文件
        source_files = self.collect_source_files(source_path)
        total_files = len(source_files)

        self.report_progress(
            0, total_files, Localizer.get().project_store_ingesting_assets
        )

        # 收纳资产
        for i, file_path in enumerate(source_files):
            self.ingest_asset(db, source_path, file_path)
            self.report_progress(
                i + 1,
                total_files,
                Localizer.get().project_store_ingesting_file.format(
                    NAME=Path(file_path).name
                ),
            )

        # 解析翻译条目
        self.report_progress(
            total_files, total_files, Localizer.get().project_store_parsing_items
        )

        # 构造 Config 对象指向源目录
        config = Config().load()

        # 使用 FileManager 读取翻译条目
        _, items = FileManager(config).read_from_path(source_path)

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

        self.report_progress(
            total_files, total_files, Localizer.get().project_store_created
        )

        return db

    def collect_source_files(self, source_path: str) -> list[str]:
        """收集源文件列表"""
        path_obj = Path(source_path)

        if path_obj.is_file():
            # 单个文件
            return [source_path] if self.is_supported_file(source_path) else []

        # 目录递归扫描
        return [
            str(f)
            for f in path_obj.rglob("*")
            if f.is_file() and self.is_supported_file(str(f))
        ]

    def is_supported_file(self, file_path: str) -> bool:
        """检查是否为支持的文件类型"""
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def ingest_asset(self, db: DataStore, base_path: str, file_path: str) -> None:
        """收纳单个资产到数据库"""
        # 计算相对路径
        relative_path = (
            Path(file_path).name
            if Path(base_path).is_file()
            else str(Path(file_path).relative_to(base_path))
        )

        # 压缩文件
        compressed_data, original_size = AssetStore.compress_file(file_path)

        # 存入数据库
        db.add_asset(relative_path, compressed_data, original_size)

    @staticmethod
    def get_project_preview(lg_path: str) -> dict:
        """获取工程预览信息（不完全加载）

        使用短连接模式，操作完成后自动关闭，WAL 文件会被清理。
        用于在工作台中显示项目详情。
        """
        if not Path(lg_path).exists():
            raise FileNotFoundError(
                Localizer.get().project_store_file_not_found.format(PATH=lg_path)
            )

        # 使用短连接模式（不调用 open()）

        db = DataStore(lg_path)
        return db.get_project_summary()
