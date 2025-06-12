import dataclasses
import threading
from typing import Any
from typing import Self

from base.Base import Base

@dataclasses.dataclass
class Project():

    # 默认值
    id: str = ""                                                                                    # 项目 ID
    status: Base.ProjectStatus = Base.ProjectStatus.NONE                                            # 任务状态
    extras: dict[str, Any] = dataclasses.field(default_factory = dict)                              # 额外数据

    # 线程锁
    lock: threading.Lock = dataclasses.field(init = False, repr = False, compare = False, default_factory = threading.Lock)

    @classmethod
    def from_dict(cls, data: dict) -> Self:
        class_fields = {f.name for f in dataclasses.fields(cls)}
        filtered_data = {k: v for k, v in data.items() if k in class_fields}
        return cls(**filtered_data)

    def to_dict(self) -> dict[str, Any]:
        with self.lock:
            return {
                v.name: getattr(self, v.name)
                for v in dataclasses.fields(self)
                if v.init != False
            }

    def get_id(self) -> str:
        with self.lock:
            return self.id

    def set_id(self, id: str) -> None:
        with self.lock:
            self.id = id

    def get_status(self) -> Base.ProjectStatus:
        with self.lock:
            return self.status

    def set_status(self, status: Base.ProjectStatus) -> None:
        with self.lock:
            self.status = status

    def get_extras(self) -> dict[str, Any]:
        with self.lock:
            return self.extras

    def set_extras(self, extras: dict[str, Any]) -> None:
        with self.lock:
            self.extras = extras