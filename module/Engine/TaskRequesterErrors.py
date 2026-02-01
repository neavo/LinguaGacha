class RequestCancelledError(Exception):
    """用户触发停止导致的主动取消（不应记为翻译错误）。"""


class RequestHardTimeoutError(Exception):
    """请求级硬超时（按可恢复失败处理，不等同于用户停止）。"""


class StreamDegradationError(Exception):
    """流式输出检测到明显退化/重复，提前中断。"""
