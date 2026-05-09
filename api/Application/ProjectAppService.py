from typing import Any

from module.Config import Config
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.Data.Translation.TranslationExportItemService import (
    TranslationExportItemService,
)
from api.Contract.ProjectPayloads import ProjectSnapshotPayload


class ProjectAppService:
    """工程用例层，负责把数据层调用收口为稳定响应载荷。"""

    def __init__(
        self,
        project_manager: Any | None = None,
        config_loader: Any | None = None,
        file_manager_factory: Any | None = None,
    ) -> None:
        """初始化 ProjectAppService 依赖和状态，保持对象写入口明确。"""

        self.project_manager = (
            project_manager if project_manager is not None else DataManager.get()
        )
        self.config_loader = (
            config_loader if config_loader is not None else lambda: Config().load()
        )
        self.file_manager_factory = (
            file_manager_factory
            if file_manager_factory is not None
            else lambda config: FileManager(config)
        )

    def load_project(self, request: dict[str, str]) -> dict[str, object]:
        """加载既有工程，并返回序列化后的工程快照。"""

        path = str(request.get("path", ""))
        self.project_manager.load_project(path)
        return {"project": self.build_project_snapshot(path)}

    def create_project_preview(self, request: dict[str, Any]) -> dict[str, object]:
        """解析新建工程草稿，不落盘、不预过滤。"""

        source_paths = self.normalize_string_list_payload(request.get("source_paths"))
        return {
            "draft": self.project_manager.build_create_project_preview(source_paths)
        }

    def create_project_commit(self, request: dict[str, Any]) -> dict[str, object]:
        """持久化前端预过滤后的新建工程草稿并加载工程。"""

        source_paths = self.normalize_string_list_payload(request.get("source_paths"))
        output_path = str(request.get("path", "") or "")
        draft = self.normalize_dict_payload(request.get("draft"))
        files = self.normalize_list_of_dicts(draft.get("files", []))
        items = self.normalize_list_of_dicts(draft.get("items", []))
        project_settings = self.normalize_dict_payload(request.get("project_settings"))
        translation_extras = self.normalize_dict_payload(
            request.get("translation_extras")
        )
        prefilter_config = self.normalize_dict_payload(request.get("prefilter_config"))
        self.project_manager.commit_create_project_preview(
            source_paths=source_paths,
            output_path=output_path,
            files=files,
            items=items,
            project_settings=project_settings,
            translation_extras=translation_extras,
            prefilter_config=prefilter_config,
        )
        self.project_manager.load_project(output_path)
        return {"project": self.build_project_snapshot(output_path)}

    def get_open_project_alignment_preview(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        """读取打开工程前的设置对齐预览，不进入 loaded 状态。"""

        path = str(request.get("path", "") or "")
        return {
            "preview": self.project_manager.build_open_project_alignment_preview(path)
        }

    def export_converted_translation(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        """导出 TS 侧已完成简繁转换的条目，不写回工程运行态。"""

        is_loaded = getattr(self.project_manager, "is_loaded", None)
        if not callable(is_loaded) or not is_loaded():
            raise ValueError(Localizer.get().alert_project_not_loaded)

        suffix = str(request.get("suffix", "") or "")
        if suffix not in ("_S2T", "_T2S"):
            raise ValueError(Localizer.get().alert_invalid_export_data)

        converted_items_raw = request.get("items", [])
        converted_items = (
            [dict(item) for item in converted_items_raw if isinstance(item, dict)]
            if isinstance(converted_items_raw, list)
            else []
        )
        if len(converted_items) == 0:
            raise ValueError(Localizer.get().alert_no_data)

        current_items = self.project_manager.get_items_all()
        if len(current_items) == 0:
            raise ValueError(Localizer.get().alert_no_data)

        converted_item_by_id = self.build_converted_item_map(converted_items)
        export_items = [
            self.apply_converted_item_payload(item, converted_item_by_id)
            for item in current_items
        ]
        TranslationExportItemService.fill_duplicated_translations(export_items)

        with self.project_manager.export_custom_suffix_context(suffix):
            output_path = self.file_manager_factory(self.config_loader()).write_to_path(
                export_items
            )

        if str(output_path).strip() == "":
            raise RuntimeError(Localizer.get().export_translation_failed)
        return {"accepted": True, "output_path": str(output_path)}

    def build_project_snapshot(self, fallback_path: str = "") -> dict[str, object]:
        """所有工程类响应都通过这里生成，保持字段来源单一。"""

        project_path = ""
        get_lg_path = getattr(self.project_manager, "get_lg_path", None)
        if callable(get_lg_path):
            project_path = str(get_lg_path() or "")
        if project_path == "":
            project_path = fallback_path

        is_loaded = bool(self.project_manager.is_loaded())
        return ProjectSnapshotPayload(path=project_path, loaded=is_loaded).to_dict()

    def build_converted_item_map(
        self,
        converted_items: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        """构建转换条目映射，避免导出链路重复遍历 payload。"""

        item_by_id: dict[int, dict[str, Any]] = {}
        for converted_item in converted_items:
            raw_item_id = converted_item.get("item_id", converted_item.get("id"))
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue

            item_by_id[item_id] = dict(converted_item)
        return item_by_id

    def apply_converted_item_payload(
        self,
        item: Item,
        converted_item_by_id: dict[int, dict[str, Any]],
    ) -> Item:
        """合并转换后的条目字段，确保导出快照不回写项目事实。"""

        item_id = item.get_id()
        export_item = Item.from_dict(item.to_dict())
        if item_id is None:
            return export_item

        converted_item = converted_item_by_id.get(int(item_id))
        if converted_item is None:
            return export_item

        export_item.set_dst(str(converted_item.get("dst", export_item.get_dst()) or ""))
        if "name_dst" in converted_item:
            export_item.set_name_dst(
                self.normalize_name_dst_payload(converted_item.get("name_dst"))
            )
        return export_item

    def normalize_name_dst_payload(self, value: Any) -> str | list[str] | None:
        """归一姓名译文字段，兼容缺失或非字符串载荷。"""

        if value is None:
            return None
        if isinstance(value, list):
            return [str(name) for name in value]
        return str(value)

    def normalize_dict_payload(self, value: Any) -> dict[str, Any]:
        """把未知载荷收窄为字典，防止调用方直接信任请求体。"""

        return dict(value) if isinstance(value, dict) else {}

    def normalize_list_of_dicts(self, value: Any) -> list[dict[str, Any]]:
        """把未知载荷收窄为字典列表，保护批量 mutation 输入。"""

        if not isinstance(value, list):
            return []
        return [dict(item) for item in value if isinstance(item, dict)]

    def normalize_string_list_payload(self, value: Any) -> list[str]:
        """把未知载荷收窄为字符串列表，统一路径和 id 列表语义。"""

        if not isinstance(value, list):
            return []
        return [str(item) for item in value if isinstance(item, str)]
