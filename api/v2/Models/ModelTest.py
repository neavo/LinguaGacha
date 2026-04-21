from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ModelKeyTestResult:
    """单个 API Key 的模型测试结果。"""

    masked_key: str
    success: bool
    input_tokens: int
    output_tokens: int
    response_time_ms: int
    error_reason: str

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定字典，供模型测试响应直接复用。"""

        return {
            "masked_key": self.masked_key,
            "success": self.success,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "response_time_ms": self.response_time_ms,
            "error_reason": self.error_reason,
        }


@dataclass(frozen=True)
class ModelApiTestResult:
    """模型测试聚合结果，供模型页 API 统一输出。"""

    success: bool
    result_msg: str
    total_count: int
    success_count: int
    failure_count: int
    total_response_time_ms: int
    key_results: tuple[ModelKeyTestResult, ...]

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定字典，避免应用服务手写响应字段。"""

        return {
            "success": self.success,
            "result_msg": self.result_msg,
            "total_count": self.total_count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "total_response_time_ms": self.total_response_time_ms,
            "key_results": [key_result.to_dict() for key_result in self.key_results],
        }
