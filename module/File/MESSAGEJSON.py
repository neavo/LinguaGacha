import json
import os

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Storage.PathStore import PathStore
from module.Text.TextHelper import TextHelper


class MESSAGEJSON(Base):
    # [
    #     {
    #         "name": "",
    #         "message": "「同じ人类とは思えん」\r\n「それ」"
    #     },
    #     {
    #         "name": "虎铁",
    #         "message": "それだけでは谁のことを言っているのか判然としないのに、\r\n谁のことを指しているのかは、一瞬で理解できてしまう。"
    #     },
    #     {
    #         "names": [],
    #         "message": "そこで注目を浴びているのは、\r\n星継\r\n银音\r\n。\r\nこの学校でも随一の有名人で……俺の妹である。"
    #     },
    #     {
    #         "names": [
    #             "虎铁",
    #             "银音"
    #         ],
    #         "message": "华丽に踊る银音。その周囲には、女子が大勢いて、\r\n手拍子をしたり、スマホのカメラを向けている。\r\n当然、その轮の外からも、多くの視线を集めていて――"
    #     },
    #     {
    #         "message": "「顔ちっさ。つか、ダンスうまくね？」\r\n「そりゃそーでしょ。かーっ、存在感やべー」\r\n「まずビジュアルが反则だよな。あの髪も含めて」"
    #     },
    # ]

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
            with open(abs_path, "rb") as reader:
                items.extend(self.read_from_stream(reader.read(), rel_path))

        return items

    # 从流读取
    def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
        items: list[Item] = []

        # 获取文件编码
        encoding = TextHelper.get_encoding(content=content, add_sig_to_utf8=True)

        # 数据处理
        json_data: list[dict] = json.loads(content.decode(encoding))

        # 格式校验
        if not isinstance(json_data, list):
            return items

        for entry in json_data:
            # 有效性校验
            if not isinstance(entry, dict):
                continue
            entry_message: str | None = entry.get("message")
            if entry_message is None:
                continue

            # 获取姓名
            name: str | list[str] | None = None
            result_name = entry.get("name")
            result_names = entry.get("names")
            if isinstance(result_name, str):
                name = result_name
            elif isinstance(result_names, list):
                name = [v for v in result_names if isinstance(v, str)]

            # 添加数据
            items.append(
                Item.from_dict(
                    {
                        "src": entry_message,
                        "dst": entry_message,
                        "name_src": name,
                        "name_dst": name,
                        "row": len(items),
                        "file_type": Item.FileType.MESSAGEJSON,
                        "file_path": rel_path,
                        "text_type": Item.TextType.KAG,
                    }
                )
            )

        return items

    # 写入数据
    def write_to_path(self, items: list[Item]) -> None:
        # 获取输出目录
        output_path = PathStore.get_translated_path()

        target = [
            item for item in items if item.get_file_type() == Item.FileType.MESSAGEJSON
        ]

        # 统一或还原姓名字段
        if not self.config.write_translated_name_fields_to_file:
            self.revert_name(target)
        else:
            self.uniform_name(target)

        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        for rel_path, group_items in group.items():
            # 按行号排序
            sorted_items = sorted(group_items, key=lambda x: x.get_row())

            # 数据处理
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            result = []
            for item in sorted_items:
                name = item.get_name_dst()
                if isinstance(name, str):
                    result.append(
                        {
                            "name": name,
                            "message": item.get_dst(),
                        }
                    )
                elif isinstance(name, list):
                    result.append(
                        {
                            "names": name,
                            "message": item.get_dst(),
                        }
                    )
                else:
                    result.append(
                        {
                            "message": item.get_dst(),
                        }
                    )

            with open(abs_path, "w", encoding="utf-8") as writer:
                writer.write(json.dumps(result, indent=4, ensure_ascii=False))

    # 还原姓名字段
    def revert_name(self, items: list[Item]) -> None:
        for item in items:
            name_src = item.get_name_src()
            if name_src is not None:
                item.set_name_dst(name_src)

    # 统一姓名字段
    def uniform_name(self, items: list[Item]) -> None:
        # 统计
        result: dict[str, dict[str, int]] = {}
        for item in items:
            name_src_raw = item.get_name_src()
            name_dst_raw = item.get_name_dst()

            # 有效性检查
            if name_src_raw is None or name_dst_raw is None:
                continue

            name_src = [name_src_raw] if isinstance(name_src_raw, str) else name_src_raw
            name_dst = [name_dst_raw] if isinstance(name_dst_raw, str) else name_dst_raw

            for src, dst in zip(name_src, name_dst):
                if src not in result:
                    result[src] = {}
                result[src][dst] = result[src].get(dst, 0) + 1

        # 获取译文
        final_names: dict[str, str] = {}
        for src, name_counts in result.items():
            final_names[src] = max(name_counts, key=lambda k: name_counts[k])

        # 赋值
        for item in items:
            name_src_raw = item.get_name_src()
            if name_src_raw is None:
                continue

            if isinstance(name_src_raw, str):
                item.set_name_dst(final_names.get(name_src_raw, name_src_raw))
            elif isinstance(name_src_raw, list):
                item.set_name_dst([final_names.get(v, v) for v in name_src_raw])
