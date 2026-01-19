import os

import openpyxl
import openpyxl.styles
import openpyxl.worksheet.worksheet

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.OutputPath import OutputPath
from module.TableManager import TableManager


class WOLFXLSX(Base):
    BLACKLIST_EXT: tuple[str] = (
        ".mp3",
        ".wav",
        ".ogg",
        "mid",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".psd",
        ".webp",
        ".heif",
        ".heic",
        ".avi",
        ".mp4",
        ".webm",
        ".txt",
        ".7z",
        ".gz",
        ".rar",
        ".zip",
        ".json",
        ".sav",
        ".mps",
        ".ttf",
        ".otf",
        ".woff",
    )

    FILL_COLOR_WHITELIST: tuple = (
        9,  # 白色
    )

    FILL_COLOR_BLACKLIST: tuple = (
        44,  # 蓝色
        47,  # 土黄
        55,  # 灰色
    )

    COL_SRC_TEXT = 6
    COL_DST_TEXT = 7

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

    # 读取
    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        items: list[Item] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, input_path)

            # 数据处理
            book: openpyxl.Workbook = openpyxl.load_workbook(abs_path)
            sheet: openpyxl.worksheet.worksheet.Worksheet = book.active

            # 跳过空表格
            if sheet.max_row == 0 or sheet.max_column == 0:
                continue

            # 判断是否为 WOLF 翻译表格文件
            if not self.is_wolf_xlsx(sheet):
                continue

            for row in range(2, sheet.max_row + 1):
                src: str = sheet.cell(row=row, column=self.COL_SRC_TEXT).value
                dst: str = sheet.cell(row=row, column=self.COL_DST_TEXT).value

                # 跳过读取失败的行
                # 数据不存在时为 None，存在时可能是 str int float 等多种类型
                if src is None:
                    continue

                src: str = str(src)
                dst: str = str(dst) if dst is not None else ""

                if (
                    src == ""
                    or self.get_fg_color_index(sheet, row, self.COL_SRC_TEXT)
                    not in WOLFXLSX.FILL_COLOR_WHITELIST
                ):
                    items.append(
                        Item.from_dict(
                            {
                                "src": src,
                                "dst": dst,
                                "row": row,
                                "file_type": Item.FileType.WOLFXLSX,
                                "file_path": rel_path,
                                "text_type": Item.TextType.WOLF,
                                "status": Base.ProjectStatus.EXCLUDED,
                            }
                        )
                    )
                elif dst != "" and src != dst:
                    items.append(
                        Item.from_dict(
                            {
                                "src": src,
                                "dst": dst,
                                "row": row,
                                "file_type": Item.FileType.WOLFXLSX,
                                "file_path": rel_path,
                                "text_type": Item.TextType.WOLF,
                                "status": Base.ProjectStatus.PROCESSED_IN_PAST,
                            }
                        )
                    )
                else:
                    items.append(
                        Item.from_dict(
                            {
                                "src": src,
                                "dst": dst,
                                "row": row,
                                "file_type": Item.FileType.WOLFXLSX,
                                "file_path": rel_path,
                                "text_type": Item.TextType.WOLF,
                                "status": Base.ProjectStatus.NONE,
                            }
                        )
                    )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 获取输出目录
        output_path = OutputPath.get_translated_path()

        target = [
            item for item in items if item.get_file_type() == Item.FileType.WOLFXLSX
        ]

        # 按文件路径分组
        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in group.items():
            # 按行号排序
            items = sorted(items, key=lambda x: x.get_row())

            # 新建工作表
            book: openpyxl.Workbook = openpyxl.Workbook()
            sheet: openpyxl.worksheet.worksheet.Worksheet = book.active

            # 设置表头
            sheet.column_dimensions["A"].width = 64
            sheet.column_dimensions["B"].width = 64

            # 将数据写入工作表
            for item in items:
                row: int = item.get_row()
                TableManager.set_cell_value(
                    sheet, row, column=self.COL_SRC_TEXT, value=item.get_src()
                )
                TableManager.set_cell_value(
                    sheet, row, column=self.COL_DST_TEXT, value=item.get_dst()
                )

            # 保存工作簿
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            book.save(abs_path)

    # 是否为 WOLF 翻译表格文件
    def is_wolf_xlsx(self, sheet: openpyxl.worksheet.worksheet.Worksheet) -> bool:
        value: str = sheet.cell(row=1, column=1).value
        if not isinstance(value, str) or "code" not in value.lower():
            return False

        value: str = sheet.cell(row=1, column=2).value
        if not isinstance(value, str) or "flag" not in value.lower():
            return False

        value: str = sheet.cell(row=1, column=3).value
        if not isinstance(value, str) or "type" not in value.lower():
            return False

        value: str = sheet.cell(row=1, column=4).value
        if not isinstance(value, str) or "info" not in value.lower():
            return False

        return True

    # 获取单元格填充颜色索引
    def get_fg_color_index(
        self, sheet: openpyxl.worksheet.worksheet.Worksheet, row: int, column: int
    ) -> int:
        fill = sheet.cell(row=row, column=column).fill
        if fill.fill_type is not None:
            fg_color = fill.fgColor
            if fg_color:
                if isinstance(fg_color, openpyxl.styles.Color):
                    if fg_color.type == "indexed":
                        return fg_color.indexed

        return -1
