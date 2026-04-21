from dataclasses import dataclass


@dataclass(frozen=True)
class ApiError:
    """统一描述 API 错误，避免路由层直接拼散乱字典。"""

    code: str
    message: str
