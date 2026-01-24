import os
import random
from datetime import datetime
from typing import Optional

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
from module.Storage.AssetStore import AssetStore
from module.Storage.DataStore import DataStore
from module.Storage.PathStore import PathStore
from module.Storage.StorageContext import StorageContext


class FileManager(Base):
    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config

    # 读
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

    # 从资产读取
    def read_from_assets(self, assets: dict[str, bytes]) -> list[Item]:
        """从 Assets 字典读取并解析翻译条目

        Args:
            assets: 相对路径 -> 字节数据的字典
        """
        items: list[Item] = []

        for rel_path, content in assets.items():
            path_lower = rel_path.lower()
            if path_lower.endswith(".md"):
                items.extend(MD(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".txt"):
                items.extend(TXT(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".ass"):
                items.extend(ASS(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".srt"):
                items.extend(SRT(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".epub"):
                items.extend(EPUB(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".xlsx"):
                # 先尝试 WOLF
                wolf_items = WOLFXLSX(self.config).read_from_stream(content, rel_path)
                if wolf_items:
                    items.extend(wolf_items)
                else:
                    items.extend(XLSX(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".rpy"):
                items.extend(RENPY(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".trans"):
                items.extend(TRANS(self.config).read_from_stream(content, rel_path))
            elif path_lower.endswith(".json"):
                # 先尝试 KVJSON
                kv_items = KVJSON(self.config).read_from_stream(content, rel_path)
                if kv_items:
                    items.extend(kv_items)
                else:
                    items.extend(
                        MESSAGEJSON(self.config).read_from_stream(content, rel_path)
                    )

        return items

    # 从工程数据库读取资产并解析
    def read_from_storage(self, db: DataStore) -> list[Item]:
        """从 DataStore 中读取所有 Assets 并解析为条目"""
        asset_paths = db.get_all_asset_paths()
        assets: dict[str, bytes] = {}
        for path in asset_paths:
            compressed = db.get_asset(path)
            if compressed:
                assets[path] = AssetStore.decompress(compressed)

        return self.read_from_assets(assets)

    # 获取用于翻译的条目
    def get_items_for_translation(
        self,
        mode: Base.TranslationMode,
        db: Optional[DataStore] = None,
    ) -> list[Item]:
        """根据翻译模式决定加载策略，并返回条目列表

        Args:
            mode: 翻译模式 (NEW, CONTINUE, RESET)
            db: 可选的数据库实例。如果提供，则强制从该数据库的资产中解析条目。
        """
        if db is not None:
            # 外部指定数据库（如 ProjectStore 创建时），强制从 Assets 解析以初始化条目
            return self.read_from_storage(db)

        # 默认从当前上下文获取数据库
        ctx = StorageContext.get()
        current_db = ctx.get_db()
        if current_db is None:
            return []

        # CONTINUE 模式：直接从数据库缓存加载
        if mode == Base.TranslationMode.CONTINUE:
            return [Item.from_dict(d) for d in current_db.get_all_items()]

        # RESET 模式：强制从 Assets 重解析
        if mode == Base.TranslationMode.RESET:
            return self.read_from_storage(current_db)

        # NEW 模式：直接使用数据库中的初始解析结果（由创建工程时解析产生）
        if mode == Base.TranslationMode.NEW:
            return [Item.from_dict(d) for d in current_db.get_all_items()]

        # 兜底：读缓存
        return [Item.from_dict(d) for d in current_db.get_all_items()]

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
