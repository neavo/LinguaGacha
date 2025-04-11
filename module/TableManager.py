import openpyxl
import openpyxl.worksheet.worksheet

import rapidjson as json
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QTableWidgetItem
from qfluentwidgets import TableWidget

from module.XLSXHelper import XLSXHelper

class TableManager():

    class Type():

        GLOSSARY: str = "GLOSSARY"
        REPLACEMENT: str = "REPLACEMENT"

    def __init__(self, type: str, data: list[dict[str, str]], table: TableWidget) -> None:
        super().__init__()

        # 初始化
        self.type = type
        self.data = data
        self.table = table

    # 向表格更新数据
    def sync(self) -> None:
        # 清空表格
        self.table.clearContents()

        # 设置表格行数
        self.table.setRowCount(max(12, len(self.data)))

        # 去重
        self.data = list({v.get("src"): v for v in self.data}.values())

        # 遍历表格
        if self.type == __class__.Type.GLOSSARY:
            for row, v in enumerate(self.data):
                for col in range(self.table.columnCount()):
                    if col == 0:
                        item = QTableWidgetItem(v.get("src",  ""))
                    elif col == 1:
                        item = QTableWidgetItem(v.get("dst", ""))
                    elif col == 2:
                        item = QTableWidgetItem(v.get("info", ""))
                    self.table.setItem(row, col, item)
        else:
            for row, v in enumerate(self.data):
                for col in range(self.table.columnCount()):
                    if col == 0:
                        item = QTableWidgetItem(v.get("src",  ""))
                    elif col == 1:
                        item = QTableWidgetItem(v.get("dst", ""))
                    elif col == 2:
                        if v.get("regex", False) == True:
                            item = QTableWidgetItem("✅")
                        else:
                            item = QTableWidgetItem("")
                        item.setFlags(item.flags() & ~Qt.ItemIsEditable)
                    self.table.setItem(row, col, item)

    # 导出
    def export(self, path: str) -> None:
        # 新建工作表
        book: openpyxl.Workbook = openpyxl.Workbook()
        sheet: openpyxl.worksheet.worksheet.Worksheet = book.active

        # 设置表头
        sheet.column_dimensions["A"].width = 32
        sheet.column_dimensions["B"].width = 32
        sheet.column_dimensions["C"].width = 32
        sheet.column_dimensions["D"].width = 32
        XLSXHelper.set_cell_value(sheet, 1, 1, "src", 10)
        XLSXHelper.set_cell_value(sheet, 1, 2, "dst", 10)
        XLSXHelper.set_cell_value(sheet, 1, 3, "info", 10)
        XLSXHelper.set_cell_value(sheet, 1, 4, "regex", 10)

        # 将数据写入工作表
        for row, item in enumerate(self.data):
            XLSXHelper.set_cell_value(sheet, row + 2, 1, item.get("src", ""), 10)
            XLSXHelper.set_cell_value(sheet, row + 2, 2, item.get("dst", ""), 10)
            XLSXHelper.set_cell_value(sheet, row + 2, 3, item.get("info", ""), 10)
            XLSXHelper.set_cell_value(sheet, row + 2, 4, item.get("regex", ""), 10)

        # 保存工作簿
        book.save(f"{path}.xlsx")

        # 保存为 JSON
        with open(f"{path}.json", "w", encoding = "utf-8") as writer:
            writer.write(json.dumps(self.data, indent = 4, ensure_ascii = False))

    # 获取数据
    def get_data(self) -> list[dict[str, str]]:
        return self.data

    # 获取数据
    def set_data(self, data: list[dict[str, str]]) -> None:
        self.data = data

    # 从表格加载数据
    def load_from_table(self) -> None:
        for row in range(self.table.rowCount()):
            # 获取当前行所有条目
            data: list[QTableWidgetItem] = [
                self.table.item(row, col)
                for col in range(self.table.columnCount())
            ]

            # 检查数据合法性
            if not isinstance(data[0], QTableWidgetItem) or data[0].text().strip() == "":
                continue

            # 添加数据
            if self.type == __class__.Type.GLOSSARY:
                self.data.append(
                    {
                        "src": data[0].text().strip(),
                        "dst": data[1].text().strip() if isinstance(data[1], QTableWidgetItem) else "",
                        "regex": data[2].text().strip() if isinstance(data[2], QTableWidgetItem) else "",
                    }
                )
            else:
                self.data.append(
                    {
                        "src": data[0].text().strip(),
                        "dst": data[1].text().strip() if isinstance(data[1], QTableWidgetItem) else "",
                        "regex": data[2].text().strip() == "✅" if isinstance(data[2], QTableWidgetItem) else False,
                    }
                )

    # 从文件加载数据
    def load_from_file(self, path: str) -> None:
        result: list[dict[str, str]] = []

        if path.lower().endswith(".json"):
            result = self.load_from_json_file(path)
        elif path.lower().endswith(".xlsx"):
            result = self.load_from_xlsx_file(path)

        # 合并数据并去重
        self.data.extend(result)
        self.data = list({v["src"]: v for v in self.data}.values())

    # 从 json 文件加载数据
    def load_from_json_file(self, path: str) -> list[dict[str, str]]:
            result: list[dict[str, str]] = []

            # 读取文件
            inputs = []
            with open(path, "r", encoding = "utf-8-sig") as reader:
                inputs: dict[str, str] | list[dict[str, str]] = json.load(reader)

            # 标准字典列表
            # [
            #     {
            #         "key": "value",
            #         "key": "value",
            #         "key": "value",
            #     }
            # ]
            if isinstance(inputs, list):
                for entry in inputs:
                    # 格式校验
                    if isinstance(entry, dict) == False:
                        continue
                    if "src" not in entry:
                        continue

                    src: str = entry.get("src", "").strip()
                    if src != "":
                        result.append(
                            {
                                "src": src,
                                "dst": entry.get("dst", "").strip(),
                                "info": entry.get("info", "").strip(),
                                "regex": entry.get("regex", False),
                            }
                        )

            # Actors.json
            # [
            #     null,
            #     {
            #         "id": 1,
            #         "name": "レナリス",
            #         "nickname": "ローズ娼館の娼婦",
            #     },
            # ]
            if isinstance(inputs, list):
                for entry in inputs:
                    # 格式校验
                    if isinstance(entry, dict) == False:
                        continue
                    if isinstance(entry.get("id"), int) == False:
                        continue

                    id: int = entry.get("id", -1)
                    name: str = entry.get("name", "").strip()
                    nickname: str = entry.get("nickname", "").strip()

                    # 添加数据
                    if name != "":
                        result.append(
                            {
                                "src": f"\\n[{id}]",
                                "dst": name,
                                "info": "",
                                "regex": False,
                            }
                        )
                        result.append(
                            {
                                "src": f"\\N[{id}]",
                                "dst": name,
                                "info": "",
                                "regex": False,
                            }
                        )
                    if nickname != "":
                        result.append(
                            {
                                "src": f"\\nn[{id}]",
                                "dst": name,
                                "info": "",
                                "regex": False,
                            }
                        )
                        result.append(
                            {
                                "src": f"\\NN[{id}]",
                                "dst": name,
                                "info": "",
                                "regex": False,
                            }
                        )

            # 标准 KV 字典
            # {
            #     "ダリヤ": "达莉雅"
            # }
            if isinstance(inputs, dict):
                for k, v in inputs.items():
                    # 格式校验
                    if not isinstance(k, str):
                        continue

                    src: str = k.strip()
                    dst: str = v.strip() if v is not None else ""
                    if src != "":
                        result.append(
                            {
                                "src": src,
                                "dst": dst,
                                "info": "",
                                "regex": False,
                            }
                        )

            return result

    # 从 xlsx 文件加载数据
    def load_from_xlsx_file(self, path: str) -> list[dict]:
        result: list[dict[str, str]] = []

        sheet = openpyxl.load_workbook(path).active
        for row in range(1, sheet.max_row + 1):
            # 读取每一行的数据
            data: list[str] = [
                sheet.cell(row = row, column = col).value
                for col in range(1, 5)
            ]

            # 格式校验
            if not isinstance(data[0], str):
                continue

            src: str = data[0].strip()
            dst: str = data[1].strip() if data[1] is not None else ""
            info: str = data[2].strip() if data[2] is not None else ""
            regex: str = data[3].strip().lower() == "true" if data[3] is not None else False

            if src == "src" and dst == "dst":
                continue

            # 添加数据
            if src != "":
                result.append(
                    {
                        "src": src,
                        "dst": dst,
                        "info": info,
                        "regex": regex,
                    }
                )

        return result