import os

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem

class MESSAGEJSON(Base):

    # [
    #     {
    #         "name": "",
    #         "message": "「同じ人類とは思えん」\r\n「それ」"
    #     },
    #     {
    #         "name": "虎鉄",
    #         "message": "それだけでは誰のことを言っているのか判然としないのに、\r\n誰のことを指しているのかは、一瞬で理解できてしまう。"
    #     },
    #     {
    #         "names": [],
    #         "message": "そこで注目を浴びているのは、\r\n星継\r\n銀音\r\n。\r\nこの学校でも随一の有名人で……俺の妹である。"
    #     },
    #     {
    #         "names": [
    #             "虎鉄",
    #             "銀音"
    #         ],
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
        items: list[CacheItem] = []
        for abs_path in abs_paths:
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
                    name = None
                    result_name = entry.get("name", None)
                    result_names = entry.get("names", None)
                    if isinstance(result_name, str):
                        name = result_name
                    elif isinstance(result_names, list):
                        name = [v for v in result_names if isinstance(v, str)]

                    # 添加数据
                    items.append(
                        CacheItem({
                            "src": entry_message,
                            "dst": entry_message,
                            "name_src": name,
                            "name_dst": name,
                            "row": len(items),
                            "file_type": CacheItem.FileType.MESSAGEJSON,
                            "file_path": rel_path,
                            "text_type": CacheItem.TextType.KAG,
                        })
                    )

        return items

    # 写入数据
    def write_to_path(self, items: list[CacheItem]) -> None:
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.MESSAGEJSON
        ]

        # 统一姓名
        self.uniform_name(target)

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
                name = item.get_name_dst()
                if isinstance(name, str):
                    result.append({
                        "name": name,
                        "message": item.get_dst(),
                    })
                elif isinstance(name, list):
                    result.append({
                        "names": name,
                        "message": item.get_dst(),
                    })
                else:
                    result.append({
                        "message": item.get_dst(),
                    })

            with open(abs_path, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 统一姓名
    def uniform_name(self, items: list[CacheItem]) -> list[CacheItem]:
        # 统计
        result: dict[str, dict] = {}
        for item in items:
            name_src = item.get_name_src()
            name_dst = item.get_name_dst()

            # 有效性检查
            if name_src is None or name_dst is None:
                continue

            if isinstance(name_src, str):
                name_src = [name_src]
            if isinstance(name_dst, str):
                name_dst = [name_dst]
            for src, dst in zip(name_src, name_dst):
                if src not in result:
                    result[src] = {}
                if dst not in result.get(src):
                    result[src][dst] = 1
                else:
                    result[src][dst] = result.get(src).get(dst) + 1

        # 获取译文
        for src, item in result.items():
            result[src] = max(item, key = item.get)

        # 赋值
        for item in items:
            name_src = item.get_name_src()
            name_dst = item.get_name_dst()

            # 有效性检查
            if name_src is None or name_dst is None:
                continue

            if isinstance(name_src, str):
                item.set_name_dst(result.get(name_src))
            elif isinstance(name_src, list):
                item.set_name_dst([result.get(v) for v in name_src])