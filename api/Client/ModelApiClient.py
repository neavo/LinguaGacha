from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.ModelRoutes import ModelRoutes
from model.Api.ModelModels import ModelPageSnapshot


class ModelApiClient:
    """模型 API 客户端，屏蔽具体路由细节并统一返回冻结快照。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_snapshot(self) -> ModelPageSnapshot:
        """读取模型页完整快照，供页面首屏 hydration 使用。"""

        response = self.api_client.post(ModelRoutes.SNAPSHOT_PATH, {})
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def update_model(
        self,
        model_id: str,
        patch: dict[str, Any],
    ) -> ModelPageSnapshot:
        """按白名单 patch 更新模型，并返回最新快照。"""

        response = self.api_client.post(
            ModelRoutes.UPDATE_PATH,
            {
                "model_id": model_id,
                "patch": patch,
            },
        )
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def activate_model(self, model_id: str) -> ModelPageSnapshot:
        """切换激活模型并返回最新快照。"""

        response = self.api_client.post(
            ModelRoutes.ACTIVATE_PATH,
            {"model_id": model_id},
        )
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def add_model(self, model_type: str) -> ModelPageSnapshot:
        """新增自定义模型并返回最新快照。"""

        response = self.api_client.post(
            ModelRoutes.ADD_PATH,
            {"model_type": model_type},
        )
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def delete_model(self, model_id: str) -> ModelPageSnapshot:
        """删除模型并返回最新快照。"""

        response = self.api_client.post(
            ModelRoutes.DELETE_PATH,
            {"model_id": model_id},
        )
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def reset_preset_model(self, model_id: str) -> ModelPageSnapshot:
        """重置预设模型并返回最新快照。"""

        response = self.api_client.post(
            ModelRoutes.RESET_PRESET_PATH,
            {"model_id": model_id},
        )
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def reorder_model(self, model_id: str, operation: str) -> ModelPageSnapshot:
        """调整模型顺序并返回最新快照。"""

        response = self.api_client.post(
            ModelRoutes.REORDER_PATH,
            {
                "model_id": model_id,
                "operation": operation,
            },
        )
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))
