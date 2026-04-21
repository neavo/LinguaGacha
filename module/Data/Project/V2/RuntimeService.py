from __future__ import annotations

from api.Models.V2.ProjectRuntime import V2RowBlock


class V2ProjectRuntimeService:
    """把当前项目运行态编码成 V2 bootstrap 可消费的稳定分段块。"""

    FILES_BLOCK_SCHEMA: str = "project-files.v1"
    FILES_BLOCK_FIELDS: tuple[str, ...] = (
        "rel_path",
        "file_type",
    )
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

    def build_files_block(self) -> dict[str, object]:
        """把文件主表编码成稳定行块，供工作台和筛选器建立文件索引。"""

        rows = tuple(
            (
                str(record["rel_path"]),
                str(record["file_type"]),
            )
            for record in self.build_file_records()
        )

        return V2RowBlock(
            schema=self.FILES_BLOCK_SCHEMA,
            fields=self.FILES_BLOCK_FIELDS,
            rows=rows,
        ).to_dict()

    def build_items_block(self) -> dict[str, object]:
        """把条目主表编码成稳定行块，避免 TS 端绑定 Python 内部对象结构。"""

        rows = tuple(
            (
                record["item_id"],
                record["file_path"],
                record["src"],
                record["dst"],
                record["status"],
            )
            for record in self.build_item_records()
        )

        return V2RowBlock(
            schema=self.ITEMS_BLOCK_SCHEMA,
            fields=self.ITEMS_BLOCK_FIELDS,
            rows=rows,
        ).to_dict()

    def build_file_records(
        self,
        rel_paths: list[str] | None = None,
    ) -> list[dict[str, object]]:
        """为 patch 与 bootstrap 统一构建稳定文件记录。"""

        target_rel_paths = (
            {str(rel_path).strip() for rel_path in rel_paths if str(rel_path).strip() != ""}
            if rel_paths is not None
            else None
        )
        records_by_path: dict[str, dict[str, object]] = {}
        for item in self.data_manager.get_items_all():
            file_path = str(item.get_file_path() or "")
            if file_path == "":
                continue
            if target_rel_paths is not None and file_path not in target_rel_paths:
                continue

            records_by_path[file_path] = {
                "rel_path": file_path,
                "file_type": self.resolve_file_type_value(item),
            }
        return list(records_by_path.values())

    def build_item_records(
        self,
        item_ids: list[int] | None = None,
    ) -> list[dict[str, object]]:
        """为 patch 与 bootstrap 统一构建稳定条目记录。"""

        target_item_ids = set(item_ids) if item_ids is not None else None
        records: list[dict[str, object]] = []
        for item in self.data_manager.get_items_all():
            item_id = item.get_id()
            if target_item_ids is not None and item_id not in target_item_ids:
                continue

            records.append(
                {
                    "item_id": item_id,
                    "file_path": item.get_file_path(),
                    "src": item.get_src(),
                    "dst": item.get_dst(),
                    "status": self.resolve_status_value(item),
                }
            )
        return records

    def build_quality_block(self) -> dict[str, object]:
        """收口当前项目直接依赖的质量规则运行态。"""

        return {
            "glossary": self.call_data_manager("get_glossary", []),
            "text_preserve": self.call_data_manager("get_text_preserve", []),
            "text_preserve_mode": self.resolve_enum_value(
                self.call_data_manager("get_text_preserve_mode", "NONE")
            ),
            "pre_replacement": self.call_data_manager("get_pre_replacement", []),
            "pre_replacement_enable": bool(
                self.call_data_manager("get_pre_replacement_enable", False)
            ),
            "post_replacement": self.call_data_manager("get_post_replacement", []),
            "post_replacement_enable": bool(
                self.call_data_manager("get_post_replacement_enable", False)
            ),
        }

    def build_prompts_block(self) -> dict[str, object]:
        """收口翻译与分析提示词的当前运行态。"""

        return {
            "translation": {
                "text": str(self.call_data_manager("get_translation_prompt", "")),
                "enabled": bool(
                    self.call_data_manager("get_translation_prompt_enable", False)
                ),
            },
            "analysis": {
                "text": str(self.call_data_manager("get_analysis_prompt", "")),
                "enabled": bool(
                    self.call_data_manager("get_analysis_prompt_enable", False)
                ),
            },
        }

    def build_analysis_block(self) -> dict[str, object]:
        """提供分析候选和摘要的最小运行态视图。"""

        return {
            "extras": self.call_data_manager("get_analysis_extras", {}),
            "candidate_count": int(
                self.call_data_manager("get_analysis_candidate_count", 0) or 0
            ),
            "status_summary": self.call_data_manager("get_analysis_status_summary", {}),
        }

    def build_task_block(self) -> dict[str, object]:
        """提供当前任务快照，供桌面壳层建立最小任务态。"""

        snapshot = self.call_data_manager(
            "get_task_progress_snapshot",
            {},
            "translation",
        )
        if isinstance(snapshot, dict):
            return snapshot
        return {}

    def resolve_status_value(self, item) -> object:
        """统一把 Item 状态规整到可直接序列化的稳定值。"""

        status = item.get_status()
        return getattr(status, "value", status)

    def resolve_file_type_value(self, item) -> str:
        """统一把文件类型规整成稳定字符串。"""

        file_type = item.get_file_type()
        return str(getattr(file_type, "value", file_type))

    def resolve_enum_value(self, value: object) -> str:
        """统一把枚举对象规整成稳定字符串。"""

        return str(getattr(value, "value", value))

    def call_data_manager(
        self,
        method_name: str,
        fallback: object,
        *args: object,
    ) -> object:
        """统一调用 DataManager 可选能力，避免 builder 里重复兜底。"""

        method = getattr(self.data_manager, method_name, None)
        if callable(method):
            return method(*args)
        return fallback
