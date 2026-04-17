from collections.abc import Callable

from module.Config import Config


class LaboratoryService:
    """把实验室页读取与写入配置的入口收口，避免页面继续散写配置。"""

    def __init__(self, config_loader: Callable[[], Config] | None = None) -> None:
        self.config_loader = config_loader or Config

    def get_snapshot(self) -> dict[str, object]:
        """把实验室页依赖的稳定配置裁剪成快照，方便 API 直接复用。"""

        config = self.config_loader().load()
        return {
            "mtool_optimizer_enabled": bool(config.mtool_optimizer_enable),
            "force_thinking_enabled": bool(config.force_thinking_enable),
        }

    def update_settings(self, request: dict[str, object]) -> dict[str, object]:
        """只按显式字段更新实验室设置，避免写入未声明的配置键。"""

        config = self.config_loader().load()

        if "mtool_optimizer_enabled" in request:
            config.mtool_optimizer_enable = bool(request["mtool_optimizer_enabled"])
        if "force_thinking_enabled" in request:
            config.force_thinking_enable = bool(request["force_thinking_enabled"])

        config.save()
        return self.get_snapshot()
