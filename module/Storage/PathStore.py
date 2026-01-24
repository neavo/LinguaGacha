from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from module.Localizer.Localizer import Localizer
from module.Storage.StorageContext import StorageContext


class PathStore:
    """输出路径管理器

    根据工程文件（.lg）的位置自动生成输出目录：
    - 译文目录：{工程文件所在目录}/{项目名}_{译文}[_{时间戳}]/
    - 双语对照目录：{工程文件所在目录}/{项目名}_{译文_双语对照}[_{时间戳}]/
    """

    timestamp_suffix: str = ""

    @staticmethod
    @contextmanager
    def timestamp_suffix_context():
        """上下文管理器：智能决定是否添加时间戳后缀"""
        old_suffix = PathStore.timestamp_suffix

        # 默认不使用后缀，保持导出路径简洁
        new_suffix = ""

        ctx = StorageContext.get()
        lg_path = ctx.get_lg_path()
        if ctx.is_loaded() and lg_path:
            project_dir = Path(lg_path).parent

            # 检查不带时间戳的默认路径是否已经存在，避免覆盖已有导出结果 (Issue #341)
            base_name_trans = PathStore.get_base_folder_name(
                Localizer.get().path_translated
            )
            base_name_bi = PathStore.get_base_folder_name(
                Localizer.get().path_translated_bilingual
            )

            path_trans = project_dir / base_name_trans
            path_bi = project_dir / base_name_bi

            # 只要有一个路径冲突，就启用时间戳后缀以确保导出安全
            if path_trans.exists() or path_bi.exists():
                new_suffix = datetime.now().strftime("_%Y%m%d_%H%M%S")

        PathStore.timestamp_suffix = new_suffix
        try:
            yield
        finally:
            PathStore.timestamp_suffix = old_suffix

    @staticmethod
    def get_base_folder_name(suffix: str) -> str:
        """获取基础文件夹名称（不含父目录和时间戳）"""
        ctx = StorageContext.get()
        lg_path = ctx.get_lg_path()
        if not ctx.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")

        project_stem = Path(lg_path).stem
        return f"{project_stem}_{suffix}"

    @staticmethod
    def get_translated_path() -> str:
        """获取译文输出目录路径"""
        ctx = StorageContext.get()
        lg_path = ctx.get_lg_path()
        if not ctx.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")

        project_dir = Path(lg_path).parent
        # 路径格式: [项目文件名]_[译文本地化名称][可选时间戳]
        folder_name = (
            f"{PathStore.get_base_folder_name(Localizer.get().path_translated)}"
            f"{PathStore.timestamp_suffix}"
        )
        return str(project_dir / folder_name)

    @staticmethod
    def get_bilingual_path() -> str:
        """获取双语对照输出目录路径"""
        ctx = StorageContext.get()
        lg_path = ctx.get_lg_path()
        if not ctx.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")

        project_dir = Path(lg_path).parent
        # 路径格式: [项目文件名]_[双语对照本地化名称][可选时间戳]
        folder_name = (
            f"{PathStore.get_base_folder_name(Localizer.get().path_translated_bilingual)}"
            f"{PathStore.timestamp_suffix}"
        )
        return str(project_dir / folder_name)

    @staticmethod
    def ensure_translated_path() -> str:
        """确保译文输出目录存在并返回路径"""
        path = PathStore.get_translated_path()
        Path(path).mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def ensure_bilingual_path() -> str:
        """确保双语对照输出目录存在并返回路径"""
        path = PathStore.get_bilingual_path()
        Path(path).mkdir(parents=True, exist_ok=True)
        return path
