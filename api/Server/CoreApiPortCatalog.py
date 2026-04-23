import os
from urllib.parse import urlparse


class CoreApiPortCatalog:
    """统一维护 Core API 默认端口与开发态覆盖入口。"""

    CORE_API_BASE_URL_ENV_NAME: str = "LINGUAGACHA_CORE_API_BASE_URL"
    DEFAULT_PORT: int = 38191

    @classmethod
    def load_candidates(cls) -> tuple[int, ...]:
        """优先读取环境变量覆盖，否则回退到默认端口。"""

        overridden_port = cls.load_overridden_port()
        if overridden_port is not None:
            return (overridden_port,)
        return (cls.DEFAULT_PORT,)

    @classmethod
    def load_overridden_port(cls) -> int | None:
        """开发态允许通过统一 base URL 环境变量把端口钉死为单候选。"""

        env_base_url = os.environ.get(cls.CORE_API_BASE_URL_ENV_NAME, "").strip()
        if env_base_url == "":
            return None

        parsed_url = urlparse(env_base_url)
        if parsed_url.scheme not in ("http", "https") or parsed_url.hostname is None:
            raise ValueError(
                "LINGUAGACHA_CORE_API_BASE_URL 必须是包含协议与主机的完整地址。"
            )

        try:
            port = parsed_url.port
        except ValueError as e:
            raise ValueError("LINGUAGACHA_CORE_API_BASE_URL 的端口配置无效。") from e

        if port is None or port <= 0:
            raise ValueError("LINGUAGACHA_CORE_API_BASE_URL 必须显式包含有效端口。")

        return port
