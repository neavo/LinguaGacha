import dataclasses
import threading
from typing import Any
from typing import Self


@dataclasses.dataclass
class Project:
    # 默认值
    id: str = ""  # 项目 ID

    # 线程锁
    lock: threading.Lock = dataclasses.field(
        init=False, repr=False, compare=False, default_factory=threading.Lock
    )

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
                if v.init
            }

    def get_id(self) -> str:
        with self.lock:
            return self.id

    def set_id(self, id: str) -> None:
        with self.lock:
            self.id = id
