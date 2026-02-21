import copy
import threading
import time

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Engine.APITester.APITesterResult import APITestResult
from module.Engine.APITester.APITesterResult import KeyTestResult
from module.Engine.Engine import Engine
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskRequesterErrors import RequestHardTimeoutError
from module.Localizer.Localizer import Localizer


class APITester(Base):
    """API 测试器 - 直接使用新的 Model 数据结构"""

    def __init__(self) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.APITEST_RUN, self.api_test_start)

    def mask_api_key(self, key: str) -> str:
        """脱敏 API Key：保留前 8 + 后 8，中间用等长 * 替代。"""

        key = key.strip()
        if len(key) <= 16:
            return key
        return f"{key[:8]}{'*' * (len(key) - 16)}{key[-8:]}"

    # 接口测试开始事件
    def api_test_start(self, event: Base.Event, data: dict) -> None:
        engine = Engine.get()
        with engine.lock:
            if engine.status != Base.TaskStatus.IDLE:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().task_running,
                    },
                )
                return

            # 原子化占用状态，避免短时间重复触发导致多线程并发启动。
            engine.status = Base.TaskStatus.TESTING

        try:
            threading.Thread(
                target=self.api_test_start_target,
                args=(event, data),
            ).start()
        except Exception as e:
            engine.set_status(Base.TaskStatus.IDLE)
            LogManager.get().error(Localizer.get().task_failed, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )

    # 接口测试开始
    def api_test_start_target(self, event: Base.Event, data: dict) -> None:
        try:
            self.api_test_start_target_inner(event, data)
        finally:
            Engine.get().set_status(Base.TaskStatus.IDLE)

    def api_test_start_target_inner(self, event: Base.Event, data: dict) -> None:
        # 加载配置
        config = Config().load()

        # 通过 model_id 获取模型配置
        model_id = data.get("model_id")
        if not model_id:
            self.emit(
                Base.Event.APITEST_DONE,
                {
                    "result": False,
                    "result_msg": "Missing model_id",
                },
            )
            return

        model = config.get_model(model_id)
        if model is None:
            self.emit(
                Base.Event.APITEST_DONE,
                {
                    "result": False,
                    "result_msg": "Model not found",
                },
            )
            return

        # 测试结果 - 收集 KeyTestResult 列表
        key_results: list[KeyTestResult] = []

        # 构造提示词
        api_format = model.get("api_format", "OpenAI")
        if api_format == Base.APIFormat.SAKURALLM:
            messages = [
                {
                    "role": "system",
                    "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
                },
                {
                    "role": "user",
                    "content": "将下面的日文文本翻译成中文：魔導具師ダリヤはうつむかない",
                },
            ]
        else:
            messages = [
                {
                    "role": "system",
                    "content": "任务目标是将内容文本翻译成中文，译文必须严格保持原文的格式。",
                },
                {
                    "role": "user",
                    "content": '{"0":"魔導具師ダリヤはうつむかない"}',
                },
            ]

        # 获取 API 密钥列表
        api_keys_str = str(model.get("api_key", ""))
        api_keys = [k.strip() for k in api_keys_str.split("\n") if k.strip()]

        if not api_keys:
            api_keys = ["no_key_required"]

        TaskRequester.reset()
        for api_key in api_keys:
            model_test = copy.deepcopy(model)
            model_test["api_key"] = api_key

            masked_key = self.mask_api_key(api_key)

            requester = TaskRequester(config, model_test)

            LogManager.get().print("")
            LogManager.get().info(
                Localizer.get().api_tester_key + "\n" + f"[green]{masked_key}[/]"
            )
            LogManager.get().info(
                Localizer.get().api_tester_messages + "\n" + f"{messages}"
            )

            # 记录开始时间
            start_time_ns = time.perf_counter_ns()

            (
                exception,
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = requester.request(messages)

            # 计算响应时间（毫秒）
            response_time_ms = (time.perf_counter_ns() - start_time_ns) // 1_000_000

            if exception:
                # 确定失败原因
                if isinstance(exception, RequestHardTimeoutError):
                    reason = Localizer.get().api_tester_timeout.replace(
                        "{SECONDS}", str(config.request_timeout)
                    )
                else:
                    exception_text = str(exception).strip()
                    reason = (
                        f"{exception.__class__.__name__}: {exception_text}"
                        if exception_text
                        else exception.__class__.__name__
                    )

                key_results.append(
                    KeyTestResult(
                        masked_key=masked_key,
                        success=False,
                        input_tokens=0,
                        output_tokens=0,
                        response_time_ms=response_time_ms,
                        error_reason=reason,
                    )
                )

                LogManager.get().warning(
                    Localizer.get().log_api_test_fail.replace("{REASON}", reason)
                )
            else:
                key_results.append(
                    KeyTestResult(
                        masked_key=masked_key,
                        success=True,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        response_time_ms=response_time_ms,
                        error_reason="",
                    )
                )

                if response_think == "":
                    LogManager.get().info(
                        Localizer.get().engine_response_result + "\n" + response_result
                    )
                else:
                    LogManager.get().info(
                        Localizer.get().engine_response_think + "\n" + response_think
                    )
                    LogManager.get().info(
                        Localizer.get().engine_response_result + "\n" + response_result
                    )

                # Token 信息放在回复之后，便于阅读。
                token_info = (
                    Localizer.get()
                    .api_tester_token_info.replace("{INPUT}", str(input_tokens))
                    .replace("{OUTPUT}", str(output_tokens))
                    .replace("{TIME}", f"{response_time_ms / 1000.0:.2f}")
                )
                LogManager.get().info(token_info)

        # 统计结果
        success_results = [r for r in key_results if r.success]
        failure_results = [r for r in key_results if not r.success]
        total_response_time_ms = sum(r.response_time_ms for r in key_results)

        # 测试结果消息
        result_msg = (
            Localizer.get()
            .api_tester_result.replace("{COUNT}", str(len(api_keys)))
            .replace("{SUCCESS}", str(len(success_results)))
            .replace("{FAILURE}", str(len(failure_results)))
        )
        LogManager.get().print("")
        LogManager.get().info(result_msg)

        # 失败密钥
        if failure_results:
            failed_masked_keys = [r.masked_key for r in failure_results]
            LogManager.get().warning(
                Localizer.get().api_tester_result_failure
                + "\n"
                + "\n".join(failed_masked_keys)
            )

        # 构建结果对象
        test_result = APITestResult(
            success=len(failure_results) == 0,
            result_msg=result_msg,
            total_count=len(api_keys),
            success_count=len(success_results),
            failure_count=len(failure_results),
            total_response_time_ms=total_response_time_ms,
            key_results=tuple(key_results),
        )

        # 发送完成事件
        self.emit(Base.Event.APITEST_DONE, test_result.to_event_dict())
