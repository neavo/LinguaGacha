from __future__ import annotations

from api.v2.Models.ProjectRuntime import RowBlock
from module.Data.Core.Item import Item
from module.Data.Quality.PromptService import PromptService
from module.Data.Quality.QualityRuleSnapshotService import (
    QualityRuleSnapshotService,
)
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService,
)


class ProjectRuntimeService:
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
        "row_number",
        "src",
        "dst",
        "status",
        "text_type",
        "retry_count",
    )

    def __init__(self, data_manager) -> None:
        self.data_manager = data_manager
        quality_rule_service = getattr(
            self.data_manager,
            "quality_rule_service",
            self.data_manager,
        )
        meta_service = getattr(
            self.data_manager,
            "meta_service",
            self.data_manager,
        )
        self.quality_snapshot_service = QualityRuleSnapshotService(
            quality_rule_service,
            meta_service,
        )
        self.prompt_service = PromptService(quality_rule_service, meta_service)
        self.proofreading_revision_service = ProofreadingRevisionService(meta_service)

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

        return RowBlock(
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
                record["row_number"],
                record["src"],
                record["dst"],
                record["status"],
                record["text_type"],
                record["retry_count"],
            )
            for record in self.build_item_records()
        )

        return RowBlock(
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
            {
                str(rel_path).strip()
                for rel_path in rel_paths
                if str(rel_path).strip() != ""
            }
            if rel_paths is not None
            else None
        )
        ordered_rel_paths = self.normalize_rel_paths(
            self.call_data_manager("get_all_asset_paths", [])
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

        if ordered_rel_paths:
            ordered_records: list[dict[str, object]] = []
            for rel_path in ordered_rel_paths:
                if target_rel_paths is not None and rel_path not in target_rel_paths:
                    continue

                ordered_records.append(
                    {
                        "rel_path": rel_path,
                        "file_type": records_by_path.get(rel_path, {}).get(
                            "file_type",
                            Item.FileType.NONE.value,
                        ),
                    }
                )
            return ordered_records

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
                    "row_number": int(item.get_row() or 0),
                    "src": item.get_src(),
                    "dst": item.get_dst(),
                    "status": self.resolve_status_value(item),
                    "text_type": self.resolve_enum_value(item.get_text_type()),
                    "retry_count": int(item.get_retry_count() or 0),
                }
            )
        return records

    def build_quality_block(self) -> dict[str, object]:
        """收口当前项目直接依赖的质量规则运行态。"""

        return {
            "glossary": self.build_quality_rule_slice("glossary"),
            "pre_replacement": self.build_quality_rule_slice("pre_replacement"),
            "post_replacement": self.build_quality_rule_slice("post_replacement"),
            "text_preserve": self.build_quality_rule_slice("text_preserve"),
        }

    def build_prompts_block(self) -> dict[str, object]:
        """收口翻译与分析提示词的当前运行态。"""

        return {
            "translation": self.prompt_service.get_prompt_snapshot("translation"),
            "analysis": self.prompt_service.get_prompt_snapshot("analysis"),
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

    def build_proofreading_block(self) -> dict[str, object]:
        """提供校对运行态需要的最小 revision 视图。"""

        return {
            "revision": self.proofreading_revision_service.get_revision("proofreading"),
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

        if value is None:
            return ""
        return str(getattr(value, "value", value))

    def build_quality_rule_slice(self, rule_type: str) -> dict[str, object]:
        snapshot = self.quality_snapshot_service.get_rule_snapshot(rule_type)
        meta = (
            dict(snapshot.get("meta", {}))
            if isinstance(snapshot.get("meta"), dict)
            else {}
        )
        return {
            "entries": snapshot.get("entries", []),
            "enabled": bool(meta.get("enabled", False)),
            "mode": str(meta.get("mode", "off")),
            "revision": int(snapshot.get("revision", 0) or 0),
        }

    def get_section_revision(self, stage: str) -> int:
        if stage == "quality":
            return max(
                int(self.build_quality_rule_slice("glossary")["revision"]),
                int(self.build_quality_rule_slice("pre_replacement")["revision"]),
                int(self.build_quality_rule_slice("post_replacement")["revision"]),
                int(self.build_quality_rule_slice("text_preserve")["revision"]),
            )
        if stage == "prompts":
            return max(
                int(self.prompt_service.get_revision("translation")),
                int(self.prompt_service.get_revision("analysis")),
            )
        if stage == "proofreading":
            return int(self.proofreading_revision_service.get_revision("proofreading"))
        return 0

    def build_section_revisions(self) -> dict[str, int]:
        return {
            "project": self.get_section_revision("project"),
            "files": self.get_section_revision("files"),
            "items": self.get_section_revision("items"),
            "quality": self.get_section_revision("quality"),
            "prompts": self.get_section_revision("prompts"),
            "analysis": self.get_section_revision("analysis"),
            "proofreading": self.get_section_revision("proofreading"),
            "task": self.get_section_revision("task"),
        }

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

    def normalize_rel_paths(self, value: object) -> list[str]:
        """把文件路径列表规整成稳定顺序，过滤空值并去重。"""

        if not isinstance(value, list):
            return []

        normalized_rel_paths: list[str] = []
        seen_rel_paths: set[str] = set()
        for raw_rel_path in value:
            rel_path = str(raw_rel_path).strip()
            if rel_path == "" or rel_path in seen_rel_paths:
                continue
            seen_rel_paths.add(rel_path)
            normalized_rel_paths.append(rel_path)
        return normalized_rel_paths
