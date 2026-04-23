from __future__ import annotations

from typing import Any

from api.Client.ApiClient import ApiClient
from api.Models.ProjectRuntime import ProjectMutationAck
from api.Server.Routes.QualityRoutes import QualityRoutes


class QualityRuleApiClient:
    """质量规则 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def save_entries(self, request: dict[str, Any]) -> ProjectMutationAck:
        """保存规则条目列表，并返回统一 mutation ack。"""

        response = self.api_client.post(QualityRoutes.SAVE_ENTRIES_PATH, request)
        return ProjectMutationAck.from_dict(response)

    def import_rules(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        """从本地路径读取规则条目，由页面决定后续合并与保存。"""

        response = self.api_client.post(QualityRoutes.IMPORT_RULES_PATH, request)
        entries_raw = response.get("entries", [])
        if not isinstance(entries_raw, list):
            return []
        return [dict(entry) for entry in entries_raw if isinstance(entry, dict)]

    def export_rules(self, request: dict[str, Any]) -> str:
        """导出当前规则条目到本地路径。"""

        response = self.api_client.post(QualityRoutes.EXPORT_RULES_PATH, request)
        return str(response.get("path", ""))

    def list_rule_presets(
        self,
        preset_dir_name: str,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        """列出质量规则预设。"""

        response = self.api_client.post(
            QualityRoutes.RULE_PRESETS_PATH,
            {"preset_dir_name": preset_dir_name},
        )
        builtin_raw = response.get("builtin_presets", [])
        user_raw = response.get("user_presets", [])
        builtin_presets = [
            {str(key): str(value) for key, value in item.items()}
            for item in builtin_raw
            if isinstance(item, dict)
        ]
        user_presets = [
            {str(key): str(value) for key, value in item.items()}
            for item in user_raw
            if isinstance(item, dict)
        ]
        return builtin_presets, user_presets

    def read_rule_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> list[dict[str, Any]]:
        """读取质量规则预设正文。"""

        response = self.api_client.post(
            QualityRoutes.RULE_PRESET_READ_PATH,
            {
                "preset_dir_name": preset_dir_name,
                "virtual_id": virtual_id,
            },
        )
        entries_raw = response.get("entries", [])
        if not isinstance(entries_raw, list):
            return []
        return [dict(entry) for entry in entries_raw if isinstance(entry, dict)]

    def save_rule_preset(
        self,
        preset_dir_name: str,
        name: str,
        entries: list[dict[str, Any]],
    ) -> dict[str, str]:
        """保存质量规则用户预设。"""

        response = self.api_client.post(
            QualityRoutes.RULE_PRESET_SAVE_PATH,
            {
                "preset_dir_name": preset_dir_name,
                "name": name,
                "entries": entries,
            },
        )
        item_raw = response.get("item", {})
        return (
            {str(key): str(value) for key, value in item_raw.items()}
            if isinstance(item_raw, dict)
            else {}
        )

    def rename_rule_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        """重命名质量规则用户预设。"""

        response = self.api_client.post(
            QualityRoutes.RULE_PRESET_RENAME_PATH,
            {
                "preset_dir_name": preset_dir_name,
                "virtual_id": virtual_id,
                "new_name": new_name,
            },
        )
        item_raw = response.get("item", {})
        return (
            {str(key): str(value) for key, value in item_raw.items()}
            if isinstance(item_raw, dict)
            else {}
        )

    def delete_rule_preset(self, preset_dir_name: str, virtual_id: str) -> str:
        """删除质量规则用户预设。"""

        response = self.api_client.post(
            QualityRoutes.RULE_PRESET_DELETE_PATH,
            {
                "preset_dir_name": preset_dir_name,
                "virtual_id": virtual_id,
            },
        )
        return str(response.get("path", ""))

    def update_meta(self, request: dict[str, Any]) -> ProjectMutationAck:
        """更新规则 meta，并返回统一 mutation ack。"""

        response = self.api_client.post(QualityRoutes.UPDATE_META_PATH, request)
        return ProjectMutationAck.from_dict(response)

    def get_prompt_template(self, task_type: str) -> dict[str, str]:
        """读取提示词页展示所需的模板文本。"""

        response = self.api_client.post(
            QualityRoutes.PROMPT_TEMPLATE_PATH,
            {"task_type": task_type},
        )
        template_raw = response.get("template", {})
        if not isinstance(template_raw, dict):
            return {}
        return {str(key): str(value) for key, value in template_raw.items()}

    def save_prompt(self, request: dict[str, Any]) -> ProjectMutationAck:
        """保存提示词正文与启用状态，并返回统一 mutation ack。"""

        response = self.api_client.post(QualityRoutes.PROMPT_SAVE_PATH, request)
        return ProjectMutationAck.from_dict(response)

    def read_prompt_import_text(self, request: dict[str, Any]) -> str:
        """从本地路径读取提示词正文。"""

        response = self.api_client.post(QualityRoutes.PROMPT_IMPORT_PATH, request)
        return str(response.get("text", ""))

    def export_prompt(self, request: dict[str, Any]) -> str:
        """导出提示词到本地路径。"""

        response = self.api_client.post(QualityRoutes.PROMPT_EXPORT_PATH, request)
        return str(response.get("path", ""))

    def list_prompt_presets(
        self,
        task_type: str,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        """列出提示词预设。"""

        response = self.api_client.post(
            QualityRoutes.PROMPT_PRESETS_PATH,
            {"task_type": task_type},
        )
        builtin_raw = response.get("builtin_presets", [])
        user_raw = response.get("user_presets", [])
        builtin_presets = [
            {str(key): str(value) for key, value in item.items()}
            for item in builtin_raw
            if isinstance(item, dict)
        ]
        user_presets = [
            {str(key): str(value) for key, value in item.items()}
            for item in user_raw
            if isinstance(item, dict)
        ]
        return builtin_presets, user_presets

    def read_prompt_preset(self, task_type: str, virtual_id: str) -> str:
        """读取提示词预设正文。"""

        response = self.api_client.post(
            QualityRoutes.PROMPT_PRESET_READ_PATH,
            {"task_type": task_type, "virtual_id": virtual_id},
        )
        return str(response.get("text", ""))

    def save_prompt_preset(
        self,
        task_type: str,
        name: str,
        text: str,
    ) -> str:
        """保存提示词用户预设。"""

        response = self.api_client.post(
            QualityRoutes.PROMPT_PRESET_SAVE_PATH,
            {"task_type": task_type, "name": name, "text": text},
        )
        return str(response.get("path", ""))

    def rename_prompt_preset(
        self,
        task_type: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        """重命名提示词用户预设。"""

        response = self.api_client.post(
            QualityRoutes.PROMPT_PRESET_RENAME_PATH,
            {
                "task_type": task_type,
                "virtual_id": virtual_id,
                "new_name": new_name,
            },
        )
        item_raw = response.get("item", {})
        return (
            {str(key): str(value) for key, value in item_raw.items()}
            if isinstance(item_raw, dict)
            else {}
        )

    def delete_prompt_preset(self, task_type: str, virtual_id: str) -> str:
        """删除提示词用户预设。"""

        response = self.api_client.post(
            QualityRoutes.PROMPT_PRESET_DELETE_PATH,
            {"task_type": task_type, "virtual_id": virtual_id},
        )
        return str(response.get("path", ""))
