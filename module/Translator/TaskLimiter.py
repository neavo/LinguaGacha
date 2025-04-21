import time

class TaskLimiter:

    def __init__(self, rps: int, rpm: int) -> None:
        self.rps = rps
        self.rpm = rpm
        self.max_tokens = self._calculate_max_tokens()
        self.rate_per_second = self._calculate_stricter_rate()
        self.available_tokens = self.max_tokens
        self.last_request_time = time.time()

    # 计算最大令牌数
    def _calculate_max_tokens(self) -> float:
        return min(
            self.rps if self.rps > 0 else 0,
            self.rpm / 60 if self.rpm > 0 else 0,
        )

    # 计算每秒恢复的请求额度
    def _calculate_stricter_rate(self) -> float:
        return min(
            self.rps if self.rps > 0 else float("inf"),
            self.rpm / 60 if self.rpm > 0 else float("inf"),
        )

    # 等待直到有足够的请求额度
    def wait(self) -> None:
        current_time = time.time()
        elapsed_time = current_time - self.last_request_time

        # 恢复额度
        self.available_tokens = self.available_tokens + elapsed_time * self.rate_per_second
        self.available_tokens = min(self.available_tokens, self.max_tokens)

        # 如果额度不足，等待
        if self.available_tokens < 1:
            time.sleep((1 - self.available_tokens) / self.rate_per_second)
            self.available_tokens = 1

        # 扣减令牌
        self.available_tokens = self.available_tokens - 1

        # 更新最后请求时间
        self.last_request_time = time.time()