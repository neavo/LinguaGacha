import os

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem

class MESSAGEJSON(Base):

    # [
    #     {
    #         "name": [
    #             "x",
    #             "y"
    #         ],
    #         "message": "「同じ人類とは思えん」\r\n「それ」"
    #     },
    #     {
    #         "names": [
    #             "虎鉄",
    #             "銀音"
    #         ],
    #         "message": "それだけでは誰のことを言っているのか判然としないのに、\r\n誰のことを指しているのかは、一瞬で理解できてしまう。"
    #     },
    #     {
    #         "name": "虎鉄",
    #         "message": "そこで注目を浴びているのは、\r\n星継\r\n銀音\r\n。\r\nこの学校でも随一の有名人で……俺の妹である。"
    #     },
    #     {
    #         "name": "",
    #         "message": "華麗に踊る銀音。その周囲には、女子が大勢いて、\r\n手拍子をしたり、スマホのカメラを向けている。\r\n当然、その輪の外からも、多くの視線を集めていて――"
    #     },
    #     {
    #         "message": "「顔ちっさ。つか、ダンスうまくね？」\r\n「そりゃそーでしょ。かーっ、存在感やべー」\r\n「まずビジュアルが反則だよな。あの髪も含めて」"
    #     },
    # ]

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        return self.read_name_and_items_from_path(abs_paths)[1]

    # 读取名称和数据
    def read_name_and_items_from_path(self, abs_paths: list[str]) -> tuple[list[str], list[CacheItem]]:
        names: list[str] = []
        items: list[CacheItem] = []
        for abs_path in set(abs_paths):
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, self.input_path)

            # 数据处理
            with open(abs_path, "r", encoding = "utf-8-sig") as reader:
                json_data: list[dict[str, dict]] = json.load(reader)

                # 格式校验
                if not isinstance(json_data, list):
                    continue

                for entry in json_data:
                    # 有效性校验
                    entry_message: str = entry.get("message", None)
                    if not isinstance(entry, dict) or entry_message is None:
                        continue

                    # 添加数据
                    result_name = self.generate_names(entry.get("name", None), {})
                    result_names = self.generate_names(entry.get("names", None), {})
                    if isinstance(result_name, str):
                        names.append(result_name)
                    elif isinstance(result_name, list):
                        names.extend(result_name)
                    if isinstance(result_names, str):
                        names.append(result_names)
                    elif isinstance(result_names, list):
                        names.extend(result_names)

                    # 添加数据
                    items.append(
                        CacheItem({
                            "src": entry_message,
                            "dst": entry_message,
                            "extra_field": {
                                "name": entry.get("name", None),
                                "names": entry.get("names", None),
                            },
                            "row": len(items),
                            "file_type": CacheItem.FileType.MESSAGEJSON,
                            "file_path": rel_path,
                        })
                    )

        return names, items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:
        self.write_name_and_items_to_path({}, items)

    # 写入名称和数据
    def write_name_and_items_to_path(self, names: dict[str, str], items: list[CacheItem]) -> None:
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.MESSAGEJSON
        ]

        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        for rel_path, items in group.items():
            # 按行号排序
            items = sorted(items, key = lambda x: x.get_row())

            # 数据处理
            abs_path = os.path.join(self.output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)

            result = []
            for item in items:
                extra_field: dict = item.get_extra_field()
                result_name: str | list[str] = self.generate_names(extra_field.get("name", None), names)
                result_names: str | list[str] = self.generate_names(extra_field.get("names", None), names)

                if isinstance(result_name, str) or isinstance(result_name, list):
                    result.append({
                        "name": result_name,
                        "message": item.get_dst(),
                    })
                elif isinstance(result_names, str) or isinstance(result_names, list):
                    result.append({
                        "names": result_names,
                        "message": item.get_dst(),
                    })
                else:
                    result.append({
                        "message": item.get_dst(),
                    })

            with open(abs_path, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 生成名称
    def generate_names(self, name: str | list[str], translation: dict[str, str]) -> str | list[str]:
        result: list[str] = []

        if isinstance(name, str):
            result.append(translation.get(name, name))
        elif isinstance(name, list):
            result = [translation.get(v, v) for v in name if isinstance(v, str)]

        if len(result) == 0:
            return None
        elif len(result) == 1:
            return result[0]
        else:
            return result