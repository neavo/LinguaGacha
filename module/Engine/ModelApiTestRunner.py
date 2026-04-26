from __future__ import annotations

import copy
import dataclasses
import time

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Localizer.Localizer import Localizer


@dataclasses.dataclass(frozen=True)
class ModelApiKeyTestResult:
    """单个模型 API Key 的测试结果快照。"""

    masked_key: str
    success: bool
    input_tokens: int
    output_tokens: int
    response_time_ms: int
    error_reason: str


@dataclasses.dataclass(frozen=True)
class ModelApiTestSummary:
    """模型 API 测试的引擎侧聚合结果。"""

    success: bool
    result_msg: str
    total_count: int
    success_count: int
    failure_count: int
    total_response_time_ms: int
    key_results: tuple[ModelApiKeyTestResult, ...]


class ModelApiTestRunner:
    """执行模型 API 连通性测试，并输出旧版控制台诊断日志。"""

    def run(self, model: dict[str, object]) -> ModelApiTestSummary:
        """复用 TaskRequester 执行真实请求测试。"""

        config = Config().load()
        messages = self.build_messages(str(model.get("api_format", "")))
        api_keys = self.collect_api_keys(model)
        key_results: list[ModelApiKeyTestResult] = []

        TaskRequester.reset()
        for api_key in api_keys:
            model_for_test = copy.deepcopy(model)
            model_for_test["api_key"] = api_key

            masked_key = self.mask_api_key(api_key)
            requester = TaskRequester(config, model_for_test)

            LogManager.get().print("")
            LogManager.get().info(Localizer.get().api_test_key + "\n" + masked_key)
            LogManager.get().info(
                Localizer.get().api_test_messages + "\n" + f"{messages}"
            )

            start_time_ns = time.perf_counter_ns()
            (
                exception,
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = requester.request(messages)
            response_time_ms = (time.perf_counter_ns() - start_time_ns) // 1_000_000

            if exception is None:
                key_results.append(
                    ModelApiKeyTestResult(
                        masked_key=masked_key,
                        success=True,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        response_time_ms=response_time_ms,
                        error_reason="",
                    )
                )
                self.log_success_response(
                    response_think=response_think,
                    response_result=response_result,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    response_time_ms=response_time_ms,
                )
                continue

            reason = self.build_error_reason(
                exception,
                int(config.request_timeout),
                Localizer.get().api_test_timeout,
            )
            key_results.append(
                ModelApiKeyTestResult(
                    masked_key=masked_key,
                    success=False,
                    input_tokens=0,
                    output_tokens=0,
                    response_time_ms=response_time_ms,
                    error_reason=reason,
                )
            )
            LogManager.get().warning(
                Localizer.get().log_api_test_fail.replace("{REASON}", reason),
                exception,
            )

        return self.build_summary(api_keys, key_results)

    def log_success_response(
        self,
        *,
        response_think: str,
        response_result: str,
        input_tokens: int,
        output_tokens: int,
        response_time_ms: int,
    ) -> None:
        """按旧版顺序输出模型响应和 token 统计。"""

        if response_think == "":
            LogManager.get().info(
                Localizer.get().engine_task_response_result + "\n" + response_result
            )
        else:
            LogManager.get().info(
                Localizer.get().engine_task_response_think + "\n" + response_think
            )
            LogManager.get().info(
                Localizer.get().engine_task_response_result + "\n" + response_result
            )

        token_info = (
            Localizer.get()
            .api_test_token_info.replace("{INPUT}", str(input_tokens))
            .replace("{OUTPUT}", str(output_tokens))
            .replace("{TIME}", f"{response_time_ms / 1000.0:.2f}")
        )
        LogManager.get().info(token_info)

    def build_summary(
        self,
        api_keys: list[str],
        key_results: list[ModelApiKeyTestResult],
    ) -> ModelApiTestSummary:
        """生成汇总结果，并输出旧版测试结尾日志。"""

        success_results = [result for result in key_results if result.success]
        failure_results = [result for result in key_results if not result.success]
        result_msg = (
            Localizer.get()
            .api_test_result.replace("{COUNT}", str(len(api_keys)))
            .replace("{SUCCESS}", str(len(success_results)))
            .replace("{FAILURE}", str(len(failure_results)))
        )

        LogManager.get().print("")
        LogManager.get().info(result_msg)

        if failure_results:
            failed_masked_keys = [result.masked_key for result in failure_results]
            LogManager.get().warning(
                Localizer.get().api_test_result_failure
                + "\n"
                + "\n".join(failed_masked_keys)
            )

        return ModelApiTestSummary(
            success=len(failure_results) == 0,
            result_msg=result_msg,
            total_count=len(api_keys),
            success_count=len(success_results),
            failure_count=len(failure_results),
            total_response_time_ms=sum(
                result.response_time_ms for result in key_results
            ),
            key_results=tuple(key_results),
        )

    def collect_api_keys(self, model: dict[str, object]) -> list[str]:
        """按旧版规则切分 API Key，空值使用无密钥占位。"""

        api_keys_raw = str(model.get("api_key", ""))
        api_keys = [key.strip() for key in api_keys_raw.splitlines() if key.strip()]
        if api_keys:
            return api_keys
        return ["no_key_required"]

    def build_messages(self, api_format: str) -> list[dict[str, str]]:
        """模型测试统一复用旧测试入口的提示词。"""

        if api_format == Base.APIFormat.SAKURALLM:
            return [
                {
                    "role": "system",
                    "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
                },
                {
                    "role": "user",
                    "content": "将下面的日文文本翻译成中文：魔導具師ダリヤはうつむかない",
                },
            ]

        return [
            {
                "role": "system",
                "content": "任务目标是将内容文本翻译成中文，译文必须严格保持原文的格式。",
            },
            {
                "role": "user",
                "content": '{"0":"魔導具師ダリヤはうつむかない"}',
            },
        ]

    def build_error_reason(
        self,
        exception: Exception,
        request_timeout: int,
        timeout_template: str,
    ) -> str:
        """统一归一化测试失败原因，避免返回结果和日志口径漂移。"""

        if isinstance(exception, RequestHardTimeoutError):
            return timeout_template.replace("{SECONDS}", str(request_timeout))

        exception_text = str(exception).strip()
        if exception_text != "":
            return f"{exception.__class__.__name__}: {exception_text}"
        return exception.__class__.__name__

    def mask_api_key(self, key: str) -> str:
        """只暴露脱敏密钥，避免控制台和响应泄露完整密钥。"""

        normalized_key = key.strip()
        if len(normalized_key) <= 16:
            return normalized_key
        return (
            f"{normalized_key[:8]}"
            f"{'*' * (len(normalized_key) - 16)}"
            f"{normalized_key[-8:]}"
        )
