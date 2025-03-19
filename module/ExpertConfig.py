import os
from typing import Self

import rapidjson as json

from base.Base import Base
from base.BaseData import BaseData
from module.Localizer.Localizer import Localizer

class ExpertConfig(Base, BaseData):

    # 专家配置路径
    EXPERT_CONFIG_PATH = "./resource/expert_config.json"

    def __init__(self) -> None:
        super().__init__()

        # 参考上文行数阈值
        self.preceding_lines_threshold: int = 3

        # 初始化
        del self.default
        if not os.path.isfile(ExpertConfig.EXPERT_CONFIG_PATH):
            os.makedirs(os.path.dirname(ExpertConfig.EXPERT_CONFIG_PATH), exist_ok = True)
            with open(ExpertConfig.EXPERT_CONFIG_PATH, "w", encoding = "utf-8") as writer:
                json.dump(self.get_vars(), writer, indent = 4, ensure_ascii = False)
        else:
            try:
                with open(ExpertConfig.EXPERT_CONFIG_PATH, "r", encoding = "utf-8-sig") as reader:
                    json_data: dict[str, str | int | float] = json.load(reader)
                    for k, v in json_data.items():
                        setattr(self, k, v)
            except Exception as e:
                self.error(f"{Localizer.get().log_read_file_fail}", e)

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__