from __future__ import annotations

from typing import Any

from module.QualityRulePathResolver import QualityRulePathResolver


class QualityRulePresetService:
    """质量规则预设服务。

    这个服务把 JSON 预设的路径解析、读取与保存收口起来，避免 UI
    直接碰文件系统和路径拼接规则。
    """

    def list_presets(
        self,
        preset_dir_name: str,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        """列出内置与用户预设。"""

        return QualityRulePathResolver.list_presets(preset_dir_name)

    def read_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> list[dict[str, Any]]:
        """读取指定预设的 JSON 内容。"""

        return QualityRulePathResolver.read_preset(preset_dir_name, virtual_id)

    def save_user_preset(
        self,
        preset_dir_name: str,
        name: str,
        data: list[dict[str, Any]],
    ) -> dict[str, str]:
        """保存用户预设并返回列表项。"""

        return QualityRulePathResolver.save_user_preset(preset_dir_name, name, data)

    def rename_user_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        """重命名用户预设并返回新的列表项。"""

        return QualityRulePathResolver.rename_user_preset(
            preset_dir_name,
            virtual_id,
            new_name,
        )

    def delete_user_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> str:
        """删除用户预设并返回被删除的路径。"""

        return QualityRulePathResolver.delete_user_preset(preset_dir_name, virtual_id)
