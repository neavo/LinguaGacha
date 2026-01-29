from collections.abc import Callable
from pathlib import Path

from base.Base import Base
from module.Config import Config
from module.Data.LGDatabase import LGDatabase
from module.Data.Type import ProgressCallback
from module.Data.ZstdCodec import ZstdCodec
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer


class ProjectService(Base):
    """工程创建/预览服务。"""

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
        self.progress_callback = callback

    def report_progress(self, current: int, total: int, message: str) -> None:
        if self.progress_callback is None:
            return
        self.progress_callback(current, total, message)

    def create(
        self,
        source_path: str,
        output_path: str,
        init_rules: Callable[[LGDatabase], list[str]] | None = None,
    ) -> list[str]:
        """创建工程并写入 assets/items/meta。

        返回：初始化成功加载的默认预设名称列表。
        """
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        if Path(output_path).exists():
            Path(output_path).unlink()

        project_name = Path(source_path).name
        db = LGDatabase.create(output_path, project_name)

        loaded_presets: list[str] = []
        if init_rules is not None:
            loaded_presets = init_rules(db)

        source_files = self.collect_source_files(source_path)
        total_files = len(source_files)

        self.report_progress(
            0, total_files, Localizer.get().project_store_ingesting_assets
        )

        config = Config().load()
        file_manager = FileManager(config)
        items = []

        for i, file_path in enumerate(source_files):
            rel_path = self.get_relative_path(source_path, file_path)

            try:
                with open(file_path, "rb") as f:
                    original_data = f.read()
            except Exception as e:
                self.error(f"Failed to read source file: {file_path}", e)
                continue

            compressed = ZstdCodec.compress(original_data)
            db.add_asset(rel_path, compressed, len(original_data))

            try:
                items.extend(file_manager.parse_asset(rel_path, original_data))
            except Exception as e:
                self.error(f"Failed to parse asset: {rel_path}", e)

            self.report_progress(
                i + 1,
                total_files,
                Localizer.get().project_store_ingesting_file.format(
                    NAME=Path(file_path).name
                ),
            )

        self.report_progress(
            total_files, total_files, Localizer.get().project_store_parsing_items
        )

        if items:
            db.set_items([item.to_dict() for item in items])

            # 将 total_line 设为 0，标记该工程尚未进行翻译扫描
            extras = {
                "total_line": 0,
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

        return loaded_presets

    def collect_source_files(self, source_path: str) -> list[str]:
        path_obj = Path(source_path)
        if path_obj.is_file():
            return [source_path] if self.is_supported_file(source_path) else []

        return [
            str(f)
            for f in path_obj.rglob("*")
            if f.is_file() and self.is_supported_file(str(f))
        ]

    def is_supported_file(self, file_path: str) -> bool:
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def get_relative_path(self, base_path: str, file_path: str) -> str:
        return (
            Path(file_path).name
            if Path(base_path).is_file()
            else str(Path(file_path).relative_to(base_path))
        )

    def get_project_preview(self, lg_path: str) -> dict:
        """获取工程预览信息（不完全加载）。"""
        if not Path(lg_path).exists():
            raise FileNotFoundError(
                Localizer.get().project_store_file_not_found.format(PATH=lg_path)
            )

        db = LGDatabase(lg_path)
        return db.get_project_summary()
