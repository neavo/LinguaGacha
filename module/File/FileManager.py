import os
import random
from datetime import datetime

from base.Base import Base

from module.File.MD import MD
from module.File.ASS import ASS
from module.File.SRT import SRT
from module.File.TXT import TXT
from module.File.EPUB import EPUB
from module.File.RENPY import RENPY
from module.File.TRANS import TRANS
from module.File.KVJSON import KVJSON
from module.File.MESSAGEJSON import MESSAGEJSON
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheProject import CacheProject
from module.File.XLSX import XLSX
from module.Localizer.Localizer import Localizer

class FileManager(Base):

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 读
    def read_from_path(self) -> tuple[CacheProject, list[CacheItem]]:
        project: CacheProject = CacheProject({
            "id": f"{datetime.now().strftime("%Y%m%d_%H%M%S")}_{random.randint(100000, 999999)}",
        })

        items: list[CacheItem] = []
        try:
            paths: list[str] = []
            input_folder: str = self.config.get("input_folder")
            if os.path.isfile(input_folder):
                paths = [input_folder]
            elif os.path.isdir(input_folder):
                for root, _, files in os.walk(input_folder):
                    paths.extend([f"{root}/{file}".replace("\\", "/") for file in files])

            items.extend(MD(self.config).read_from_path([path for path in paths if path.lower().endswith(".md")]))
            items.extend(TXT(self.config).read_from_path([path for path in paths if path.lower().endswith(".txt")]))
            items.extend(ASS(self.config).read_from_path([path for path in paths if path.lower().endswith(".ass")]))
            items.extend(SRT(self.config).read_from_path([path for path in paths if path.lower().endswith(".srt")]))
            items.extend(EPUB(self.config).read_from_path([path for path in paths if path.lower().endswith(".epub")]))
            items.extend(XLSX(self.config).read_from_path([path for path in paths if path.lower().endswith(".xlsx")]))
            items.extend(RENPY(self.config).read_from_path([path for path in paths if path.lower().endswith(".rpy")]))
            items.extend(TRANS(self.config).read_from_path([path for path in paths if path.lower().endswith(".trans")]))
            items.extend(KVJSON(self.config).read_from_path([path for path in paths if path.lower().endswith(".json")]))
            items.extend(MESSAGEJSON(self.config).read_from_path([path for path in paths if path.lower().endswith(".json")]))
        except Exception as e:
            self.error(f"{Localizer.get().log_read_file_fail}", e)

        return project, items

    # 写
    def write_to_path(self, items: list[CacheItem]) -> None:
        try:
            MD(self.config).write_to_path(items)
            TXT(self.config).write_to_path(items)
            ASS(self.config).write_to_path(items)
            SRT(self.config).write_to_path(items)
            EPUB(self.config).write_to_path(items)
            XLSX(self.config).write_to_path(items)
            RENPY(self.config).write_to_path(items)
            TRANS(self.config).write_to_path(items)
            KVJSON(self.config).write_to_path(items)
            MESSAGEJSON(self.config).write_to_path(items)
        except Exception as e:
            self.error(f"{Localizer.get().log_write_file_fail}", e)