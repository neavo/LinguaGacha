from __future__ import annotations

from typing import Any

from api.Application.ModelAppService import ModelAppService


class V2ModelAppService:
    """V2 模型路由的薄包装层，复用现有模型用例实现。"""

    def __init__(self, model_app_service: ModelAppService | None = None) -> None:
        self.model_app_service = (
            model_app_service if model_app_service is not None else ModelAppService()
        )

    def get_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.get_snapshot(request)

    def update_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.update_model(request)

    def activate_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.activate_model(request)

    def add_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.add_model(request)

    def delete_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.delete_model(request)

    def reset_preset_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.reset_preset_model(request)

    def reorder_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.reorder_model(request)

    def list_available_models(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.list_available_models(request)

    def test_model(self, request: dict[str, Any]) -> dict[str, object]:
        return self.model_app_service.test_model(request)
