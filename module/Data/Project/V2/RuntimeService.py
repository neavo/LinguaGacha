from __future__ import annotations

from api.Models.V2.ProjectRuntime import V2RowBlock


class V2ProjectRuntimeService:
    """把当前项目运行态编码成 V2 bootstrap 可消费的稳定分段块。"""

    ITEMS_BLOCK_SCHEMA: str = "project-items.v1"
    ITEMS_BLOCK_FIELDS: tuple[str, ...] = (
        "item_id",
        "file_path",
        "src",
        "dst",
        "status",
    )

    def __init__(self, data_manager) -> None:
        self.data_manager = data_manager

    def build_project_block(self) -> dict[str, object]:
        """构建最小项目骨架块，供前端先拿到加载态与项目路径。"""

        project_path = ""
        get_lg_path = getattr(self.data_manager, "get_lg_path", None)
        if callable(get_lg_path):
            project_path = str(get_lg_path() or "")

        is_loaded = False
        is_loaded_method = getattr(self.data_manager, "is_loaded", None)
        if callable(is_loaded_method):
            is_loaded = bool(is_loaded_method())

        return {
            "project": {
                "path": project_path,
                "loaded": is_loaded,
            }
        }

    def build_items_block(self) -> dict[str, object]:
        """把条目主表编码成稳定行块，避免 TS 端绑定 Python 内部对象结构。"""

        rows = tuple(
            (
                item.get_id(),
                item.get_file_path(),
                item.get_src(),
                item.get_dst(),
                self.resolve_status_value(item),
            )
            for item in self.data_manager.get_items_all()
        )

        return V2RowBlock(
            schema=self.ITEMS_BLOCK_SCHEMA,
            fields=self.ITEMS_BLOCK_FIELDS,
            rows=rows,
        ).to_dict()

    def resolve_status_value(self, item) -> object:
        """统一把 Item 状态规整到可直接序列化的稳定值。"""

        status = item.get_status()
        return getattr(status, "value", status)
