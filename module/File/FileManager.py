import os
import random
from datetime import datetime

from base.Base import Base
from model.Item import Item
from model.Project import Project
from module.Config import Config
from module.File.ASS import ASS
from module.File.EPUB import EPUB
from module.File.KVJSON import KVJSON
from module.File.MD import MD
from module.File.MESSAGEJSON import MESSAGEJSON
from module.File.RENPY import RENPY
from module.File.SRT import SRT
from module.File.TRANS.TRANS import TRANS
from module.File.TXT import TXT
from module.File.WOLFXLSX import WOLFXLSX
from module.File.XLSX import XLSX
from module.Localizer.Localizer import Localizer
from module.Storage.PathStore import PathStore


class FileManager(Base):
    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config

    # 读
    def read_from_path(self, input_path: str = None) -> tuple[Project, list[Item]]:
        """读取文件并解析翻译条目

        Args:
            input_path: 输入目录或文件路径，如果不提供则无法读取
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

            items.extend(
                MD(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".md")], base_path
                )
            )
            items.extend(
                TXT(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".txt")],
                    base_path,
                )
            )
            items.extend(
                ASS(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".ass")],
                    base_path,
                )
            )
            items.extend(
                SRT(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".srt")],
                    base_path,
                )
            )
            items.extend(
                EPUB(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".epub")],
                    base_path,
                )
            )
            items.extend(
                XLSX(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".xlsx")],
                    base_path,
                )
            )
            items.extend(
                WOLFXLSX(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".xlsx")],
                    base_path,
                )
            )
            items.extend(
                RENPY(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".rpy")],
                    base_path,
                )
            )
            items.extend(
                TRANS(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".trans")],
                    base_path,
                )
            )
            items.extend(
                KVJSON(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".json")],
                    base_path,
                )
            )
            items.extend(
                MESSAGEJSON(self.config).read_from_path(
                    [path for path in paths if path.lower().endswith(".json")],
                    base_path,
                )
            )
        except Exception as e:
            self.error(f"{Localizer.get().log_read_file_fail}", e)

        return project, items

    # 写
    def write_to_path(self, items: list[Item]) -> str:
        """写入翻译结果到文件，返回实际输出目录路径（带时间戳）"""
        output_path = ""

        try:
            with PathStore.timestamp_suffix_context():
                MD(self.config).write_to_path(items)
                TXT(self.config).write_to_path(items)
                ASS(self.config).write_to_path(items)
                SRT(self.config).write_to_path(items)
                EPUB(self.config).write_to_path(items)
                XLSX(self.config).write_to_path(items)
                WOLFXLSX(self.config).write_to_path(items)
                RENPY(self.config).write_to_path(items)
                TRANS(self.config).write_to_path(items)
                KVJSON(self.config).write_to_path(items)
                MESSAGEJSON(self.config).write_to_path(items)

                # 在上下文内获取路径，确保包含时间戳后缀
                output_path = PathStore.get_translated_path()
        except Exception as e:
            self.error(f"{Localizer.get().log_write_file_fail}", e)

        return output_path
