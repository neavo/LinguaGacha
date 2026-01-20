from pathlib import Path

from module.Localizer.Localizer import Localizer
from module.Storage.StorageContext import StorageContext


class PathStore:
    """输出路径管理器

    根据工程文件（.lg）的位置自动生成输出目录：
    - 译文目录：{工程文件所在目录}/{译文}/
    - 双语对照目录：{工程文件所在目录}/{译文_双语对照}/
    """

    @staticmethod
    def get_translated_path() -> str:
        """获取译文输出目录路径"""
        ctx = StorageContext.get()
        lg_path = ctx.get_lg_path()
        if not ctx.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")

        project_dir = Path(lg_path).parent
        return str(project_dir / Localizer.get().path_translated)

    @staticmethod
    def get_bilingual_path() -> str:
        """获取双语对照输出目录路径"""
        ctx = StorageContext.get()
        lg_path = ctx.get_lg_path()
        if not ctx.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")

        project_dir = Path(lg_path).parent
        return str(project_dir / Localizer.get().path_translated_bilingual)

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
