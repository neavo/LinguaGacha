from typing import Any

import openpyxl
import openpyxl.styles
import openpyxl.worksheet.worksheet


class SpreadsheetUtil:
    """openpyxl 相关的轻量工具。

    这些函数不应依赖 Qt/UI，供 File 模块与 Data 导入导出复用。
    """

    @staticmethod
    def get_cell_value(
        sheet: openpyxl.worksheet.worksheet.Worksheet, row: int, column: int
    ) -> str:
        value = sheet.cell(row=row, column=column).value

        # 强制转换为字符串，保持和旧 TableManager 行为一致。
        if value is None:
            result = ""
        else:
            result = str(value)

        return result.strip()

    @staticmethod
    def set_cell_value(
        sheet: openpyxl.worksheet.worksheet.Worksheet,
        row: int,
        column: int,
        value: Any,
        font_size: int = 9,
    ) -> None:
        if value is None:
            value = ""
        # 如果单元格内容以 '=' 开头，Excel 会将其视为公式；前置单引号可强制按文本写入。
        elif isinstance(value, str) and value.startswith("="):
            value = "'" + value

        cell = sheet.cell(row=row, column=column)
        cell.value = value
        cell.font = openpyxl.styles.Font(size=font_size)
        cell.alignment = openpyxl.styles.Alignment(
            wrap_text=True,
            vertical="center",
            horizontal="left",
        )
