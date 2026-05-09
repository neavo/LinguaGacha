import os
import random
from datetime import datetime
from typing import Optional

from base.Base import Base
from base.LogManager import LogManager
from module.Data.Core.Item import Item
from module.Data.Core.Project import Project
from module.Config import Config
from module.Data.DataManager import DataManager
from module.File.EPUB.EPUB import EPUB
from module.Localizer.Localizer import Localizer


class FileManager(Base):
    """Python 文件门面只保留 EPUB；非 EPUB 公开路径已迁移到 TS Gateway。"""

    def __init__(self, config: Config) -> None:
        """保存配置对象，供保留的 EPUB 处理器继续复用。"""
        super().__init__()

        # FileManager 不再持有非 EPUB 处理器，避免 Python/TS 两侧并行维护。
        self.config = config

    # 目录和单文件读取都只保留 EPUB 分发，非 EPUB 已迁移到 TS。
    def read_from_path(
        self, input_path: Optional[str] = None
    ) -> tuple[Project, list[Item]]:
        """读取文件并解析翻译条目

        Args:
            input_path: 输入目录 or 文件路径，如果不提供则无法读取
        """
        project: Project = Project.from_dict(
            {
                "id": f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{random.randint(100000, 999999)}",
            }
        )

        items: list[Item] = []
        if input_path is None:
            return project, items

        try:
            paths: list[str] = []
            base_path = input_path
            if os.path.isfile(input_path):
                paths = [input_path]
                base_path = os.path.dirname(input_path)
            elif os.path.isdir(input_path):
                for root, _, files in os.walk(input_path):
                    paths.extend(
                        [f"{root}/{file}".replace("\\", "/") for file in files]
                    )

            # 只把 EPUB 路径交给 Python，非 EPUB 公开路径已由 TS Gateway 接管。
            items.extend(
                EPUB(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".epub")],
                    base_path,
                )
            )
        except Exception as e:
            LogManager.get().error(Localizer.get().log_read_file_fail, e)

        return project, items

    def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
        """解析单个资产内容"""
        items: list[Item] = []
        path_lower = rel_path.lower()
        if path_lower.endswith(".epub"):
            items.extend(EPUB(self.config).read_from_stream(content, rel_path))

        return items

    def write_to_path(self, items: list[Item]) -> str:
        """写入翻译结果到文件，返回实际输出目录路径（带时间戳）"""
        output_path = ""

        try:
            dm = DataManager.get()
            with dm.timestamp_suffix_context():
                EPUB(self.config).write_to_path(items)

                # 在上下文内获取路径，确保包含时间戳后缀。
                output_path = dm.get_translated_path()
        except Exception as e:
            LogManager.get().error(Localizer.get().log_write_file_fail, e)

        return output_path
