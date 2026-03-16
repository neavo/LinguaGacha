from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
import threading

from module.Localizer.Localizer import Localizer


class ExportPathService:
    """导出路径生成服务（线程隔离的后缀上下文）。"""

    def __init__(self) -> None:
        self.local = threading.local()

    def get_custom_suffix(self) -> str:
        value = getattr(self.local, "custom_suffix", "")
        return value if isinstance(value, str) else ""

    def set_custom_suffix(self, suffix: str) -> None:
        self.local.custom_suffix = suffix

    @contextmanager
    def custom_suffix_context(self, suffix: str):
        old = self.get_custom_suffix()
        self.set_custom_suffix(suffix)
        try:
            yield
        finally:
            self.set_custom_suffix(old)

    def get_timestamp_suffix(self) -> str:
        value = getattr(self.local, "timestamp_suffix", "")
        return value if isinstance(value, str) else ""

    def set_timestamp_suffix(self, suffix: str) -> None:
        self.local.timestamp_suffix = suffix

    @contextmanager
    def timestamp_suffix_context(self, lg_path: str):
        """智能决定是否添加时间戳后缀，避免覆盖已有导出结果。"""
        old_suffix = self.get_timestamp_suffix()

        # 默认不使用后缀，保持导出路径简洁
        new_suffix = ""

        project_dir = Path(lg_path).parent

        base_name_trans = self.get_base_folder_name(
            lg_path, Localizer.get().path_translated
        )
        if self.get_custom_suffix():
            base_name_trans += self.get_custom_suffix()

        base_name_bi = self.get_base_folder_name(
            lg_path,
            Localizer.get().path_translated_bilingual,
        )
        if self.get_custom_suffix():
            base_name_bi += self.get_custom_suffix()

        path_trans = project_dir / base_name_trans
        path_bi = project_dir / base_name_bi

        if (path_trans.exists() and path_trans.is_dir()) or (
            path_bi.exists() and path_bi.is_dir()
        ):
            new_suffix = datetime.now().strftime("_%Y%m%d_%H%M%S")

        self.set_timestamp_suffix(new_suffix)
        try:
            yield
        finally:
            self.set_timestamp_suffix(old_suffix)

    def get_base_folder_name(self, lg_path: str, suffix: str) -> str:
        """获取基础文件夹名称（不含父目录和时间戳）。"""
        project_stem = Path(lg_path).stem
        return f"{project_stem}_{suffix}"

    def get_translated_path(self, lg_path: str) -> str:
        project_dir = Path(lg_path).parent
        folder_name = (
            f"{self.get_base_folder_name(lg_path, Localizer.get().path_translated)}"
            f"{self.get_custom_suffix()}"
            f"{self.get_timestamp_suffix()}"
        )
        return str(project_dir / folder_name)

    def get_bilingual_path(self, lg_path: str) -> str:
        project_dir = Path(lg_path).parent
        folder_name = (
            f"{self.get_base_folder_name(lg_path, Localizer.get().path_translated_bilingual)}"
            f"{self.get_custom_suffix()}"
            f"{self.get_timestamp_suffix()}"
        )
        return str(project_dir / folder_name)

    def ensure_translated_path(self, lg_path: str) -> str:
        path = self.get_translated_path(lg_path)
        Path(path).mkdir(parents=True, exist_ok=True)
        return path

    def ensure_bilingual_path(self, lg_path: str) -> str:
        path = self.get_bilingual_path(lg_path)
        Path(path).mkdir(parents=True, exist_ok=True)
        return path
