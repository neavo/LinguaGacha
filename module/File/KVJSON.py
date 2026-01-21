import json
import os

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Storage.PathStore import PathStore
from module.Text.TextHelper import TextHelper

class KVJSON(Base):
    # {
    #     "「あ・・」": "「あ・・」",
    #     "「ごめん、ここ使う？」": "「ごめん、ここ使う？」",
    #     "「じゃあ・・私は帰るね」": "「じゃあ・・私は帰るね」",
    # }

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

            # 获取文件编码
            encoding = TextHelper.get_enconding(path=abs_path, add_sig_to_utf8=True)

            # 数据处理
            with open(abs_path, "r", encoding=encoding) as reader:
                json_data: dict[str, str] = json.load(reader)

                # 格式校验
                if not isinstance(json_data, dict):
                    continue

                # 读取数据
                for k, v in json_data.items():
                    if isinstance(k, str) and isinstance(v, str):
                        src = k
                        dst = v
                        if src == "":
                            items.append(
                                Item.from_dict(
                                    {
                                        "src": src,
                                        "dst": dst,
                                        "row": len(items),
                                        "file_type": Item.FileType.KVJSON,
                                        "file_path": rel_path,
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
                                        "row": len(items),
                                        "file_type": Item.FileType.KVJSON,
                                        "file_path": rel_path,
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
                                        "row": len(items),
                                        "file_type": Item.FileType.KVJSON,
                                        "file_path": rel_path,
                                        "status": Base.ProjectStatus.NONE,
                                    }
                                )
                            )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 获取输出目录
        output_path = PathStore.get_translated_path()

        target = [
            item for item in items if item.get_file_type() == Item.FileType.KVJSON
        ]

        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        for rel_path, items in group.items():
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as writer:
                writer.write(
                    json.dumps(
                        {item.get_src(): item.get_dst() for item in items},
                        indent=4,
                        ensure_ascii=False,
                    )
                )
