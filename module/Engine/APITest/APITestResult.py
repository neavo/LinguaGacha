"""API 测试结果数据结构"""

import dataclasses
from typing import Any


@dataclasses.dataclass(frozen=True)
class KeyTestResult:
    """单个密钥的测试结果（不可变快照）"""

    masked_key: str  # 密钥（脱敏：前 8 + 后 8，中间用等长 * 替代）
    success: bool  # 是否成功
    input_tokens: int  # 输入 token 数量
    output_tokens: int  # 输出 token 数量
    response_time_ms: int  # 响应时间（毫秒）
    error_reason: str  # 失败原因（成功时为空字符串）


@dataclasses.dataclass(frozen=True)
class APITestResult:
    """API 测试汇总结果（不可变快照）"""

    success: bool  # 是否全部成功
    result_msg: str  # 结果摘要消息
    total_count: int  # 测试密钥总数
    success_count: int  # 成功数量
    failure_count: int  # 失败数量
    total_response_time_ms: int  # 总响应时间（毫秒）
    key_results: tuple[KeyTestResult, ...]  # 各密钥测试结果（使用 tuple 保证不可变）

    def to_event_dict(self) -> dict[str, Any]:
        """转换为事件传递用的字典格式"""
        return {
            "result": self.success,
            "result_msg": self.result_msg,
            "total_count": self.total_count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "total_response_time_ms": self.total_response_time_ms,
            "key_results": [
                {
                    "masked_key": kr.masked_key,
                    "success": kr.success,
                    "input_tokens": kr.input_tokens,
                    "output_tokens": kr.output_tokens,
                    "response_time_ms": kr.response_time_ms,
                    "error_reason": kr.error_reason,
                }
                for kr in self.key_results
            ],
        }
