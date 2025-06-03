import dataclasses
import threading
from typing import Any
from typing import Self

from base.Base import Base

@dataclasses.dataclass
class CacheProject():

    id: str = ""                                                                        # 项目 ID
    status: Base.TranslationStatus = Base.TranslationStatus.UNTRANSLATED                # 翻译状态
    extras: dict = dataclasses.field(default_factory = dict)                            # 额外数据

    # 线程锁
    lock: threading.Lock = dataclasses.field(init = False, repr = False, compare = False, default_factory = threading.Lock)

    @classmethod
    def from_dict(cls, data: dict) -> Self:
        class_fields = {f.name for f in dataclasses.fields(cls)}
        filtered_data = {k: v for k, v in data.items() if k in class_fields}
        return cls(**filtered_data)

    # 获取项目 ID
    def get_id(self) -> str:
        with self.lock:
            return self.id

    # 设置项目 ID
    def set_id(self, id: str) -> None:
        with self.lock:
            self.id = id

    # 获取翻译状态
    def get_status(self) -> Base.TranslationStatus:
        with self.lock:
            return self.status

    # 设置翻译状态
    def set_status(self, status: Base.TranslationStatus) -> None:
        with self.lock:
            self.status = status

    # 获取额外数据
    def get_extras(self) -> dict:
        with self.lock:
            return self.extras

    # 设置额外数据
    def set_extras(self, extras: dict) -> None:
        with self.lock:
            self.extras = extras

    def asdict(self) -> dict[str, Any]:
        with self.lock:
            return {
                v.name: getattr(self, v.name)
                for v in dataclasses.fields(self)
                if v.init != False
            }