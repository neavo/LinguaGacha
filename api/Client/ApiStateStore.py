from typing import Any


class ApiStateStore:
    """维护 UI 当前真正需要的序列化快照。"""

    def __init__(self) -> None:
        self.project_snapshot: dict[str, Any] = {
            "loaded": False,
            "path": "",
        }

    def hydrate_project(self, snapshot: dict[str, Any]) -> None:
        """用服务端快照覆盖本地工程状态，保持单一缓存入口。"""

        self.project_snapshot = {
            "loaded": bool(snapshot.get("loaded", False)),
            "path": str(snapshot.get("path", "")),
        }

    def reset_project(self) -> None:
        """工程关闭后恢复到未加载态，避免 UI 继续读到陈旧路径。"""

        self.project_snapshot = {
            "loaded": False,
            "path": "",
        }

    def is_project_loaded(self) -> bool:
        """给 UI 提供稳定布尔值，减少页面自己猜状态。"""

        return bool(self.project_snapshot["loaded"])

    def get_project_path(self) -> str:
        """统一读取当前工程路径。"""

        return str(self.project_snapshot["path"])

    def get_project_snapshot(self) -> dict[str, Any]:
        """返回快照副本，避免外部持有内部可变引用。"""

        return dict(self.project_snapshot)
