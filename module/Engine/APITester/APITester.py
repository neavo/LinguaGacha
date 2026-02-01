import copy
import asyncio
import threading

from base.Base import Base
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskRequester import RequestHardTimeoutError
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer


class APITester(Base):
    """API 测试器 - 直接使用新的 Model 数据结构"""

    def __init__(self) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.APITEST_RUN, self.api_test_start)

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
            self.error(Localizer.get().task_failed, e)

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

        # 测试结果
        failure = []
        success = []

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
                    "role": "user",
                    "content": '将下面的日文文本翻译成中文，按输入格式返回结果：{"0":"魔導具師ダリヤはうつむかない"}',
                },
            ]

        # 获取 API 密钥列表
        api_keys_str = str(model.get("api_key", ""))
        api_keys = [k.strip() for k in api_keys_str.split("\n") if k.strip()]

        if not api_keys:
            api_keys = ["no_key_required"]

        async def run_tests() -> None:
            TaskRequester.reset()
            try:
                for key in api_keys:
                    model_test = copy.deepcopy(model)
                    model_test["api_key"] = key

                    requester = TaskRequester(config, model_test)

                    self.print("")
                    self.info(
                        Localizer.get().api_tester_key + "\n" + f"[green]{key}[/]"
                    )
                    self.info(
                        Localizer.get().api_tester_messages + "\n" + f"{messages}"
                    )

                    (
                        exception,
                        response_think,
                        response_result,
                        _,
                        _,
                    ) = await requester.request_async(messages)

                    if exception:
                        failure.append(key)
                        reason = Localizer.get().log_unknown_reason
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

                        self.warning(
                            Localizer.get().log_api_test_fail.replace(
                                "{REASON}", reason
                            )
                        )
                    elif response_think == "":
                        success.append(key)
                        self.info(
                            Localizer.get().engine_response_result
                            + "\n"
                            + response_result
                        )
                    else:
                        success.append(key)
                        self.info(
                            Localizer.get().engine_response_think
                            + "\n"
                            + response_think
                        )
                        self.info(
                            Localizer.get().engine_response_result
                            + "\n"
                            + response_result
                        )
            finally:
                await TaskRequester.aclose_clients_for_running_loop()

        asyncio.run(run_tests())

        # 测试结果
        result_msg = (
            Localizer.get()
            .api_tester_result.replace("{COUNT}", str(len(api_keys)))
            .replace("{SUCCESS}", str(len(success)))
            .replace("{FAILURE}", str(len(failure)))
        )
        self.print("")
        self.info(result_msg)

        # 失败密钥
        if len(failure) > 0:
            self.warning(
                Localizer.get().api_tester_result_failure + "\n" + "\n".join(failure)
            )

        # 发送完成事件
        self.emit(
            Base.Event.APITEST_DONE,
            {
                "result": len(failure) == 0,
                "result_msg": result_msg,
            },
        )
