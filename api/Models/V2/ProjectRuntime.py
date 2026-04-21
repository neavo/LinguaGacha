from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class V2RowBlock:
    """统一描述 V2 bootstrap 的行块载荷，避免事件层重复拼装结构。"""

    schema: str
    fields: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 V2 bootstrap 和 patch 复用。"""

        return {
            "schema": self.schema,
            "fields": list(self.fields),
            "rows": [list(row) for row in self.rows],
        }
