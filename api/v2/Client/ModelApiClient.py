from typing import Any

from api.v2.Client.ApiClient import ApiClient
from api.v2.Models.Model import ModelPageSnapshot
from api.v2.Server.Routes.ModelRoutes import ModelRoutes


class ModelApiClient:
    """模型 API 客户端，屏蔽具体路由细节并统一返回冻结快照。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def post_data(
        self,
        path: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """统一发送模型接口请求，避免客户端方法重复拼装请求。"""

        return self.api_client.post(path, payload)

    def post_snapshot(
        self,
        path: str,
        payload: dict[str, Any],
    ) -> ModelPageSnapshot:
        """统一发送模型接口请求并解码快照，避免各动作重复反序列化。"""

        response = self.post_data(path, payload)
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))

    def get_snapshot(self) -> ModelPageSnapshot:
        """读取模型页完整快照，供页面首屏 hydration 使用。"""

        return self.post_snapshot(ModelRoutes.SNAPSHOT_PATH, {})

    def update_model(
        self,
        model_id: str,
        patch: dict[str, Any],
    ) -> ModelPageSnapshot:
        """按白名单 patch 更新模型，并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.UPDATE_PATH,
            {
                "model_id": model_id,
                "patch": patch,
            },
        )

    def activate_model(self, model_id: str) -> ModelPageSnapshot:
        """切换激活模型并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.ACTIVATE_PATH,
            {"model_id": model_id},
        )

    def add_model(self, model_type: str) -> ModelPageSnapshot:
        """新增自定义模型并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.ADD_PATH,
            {"model_type": model_type},
        )

    def delete_model(self, model_id: str) -> ModelPageSnapshot:
        """删除模型并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.DELETE_PATH,
            {"model_id": model_id},
        )

    def reset_preset_model(self, model_id: str) -> ModelPageSnapshot:
        """重置预设模型并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.RESET_PRESET_PATH,
            {"model_id": model_id},
        )

    def reorder_model(self, model_id: str, operation: str) -> ModelPageSnapshot:
        """兼容旧前端的离散排序动作，并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.REORDER_PATH,
            {
                "model_id": model_id,
                "operation": operation,
            },
        )

    def reorder_models(self, ordered_model_ids: list[str]) -> ModelPageSnapshot:
        """提交分组内的最终模型顺序，并返回最新快照。"""

        return self.post_snapshot(
            ModelRoutes.REORDER_PATH,
            {
                "ordered_model_ids": ordered_model_ids,
            },
        )

    def list_available_models(self, model_id: str) -> list[str]:
        """获取当前模型可见的模型标识列表。"""

        response = self.post_data(
            ModelRoutes.LIST_AVAILABLE_PATH,
            {"model_id": model_id},
        )
        models = response.get("models", [])
        if not isinstance(models, list):
            return []
        return [str(model_name) for model_name in models]

    def test_model(self, model_id: str) -> dict[str, Any]:
        """触发模型测试，并返回稳定的结果载荷。"""

        return self.post_data(
            ModelRoutes.TEST_PATH,
            {"model_id": model_id},
        )
