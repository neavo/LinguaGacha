import threading

from base.Base import Base
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Engine.TaskRequester import TaskRequester

class APITester(Base):

    def __init__(self) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.APITEST_RUN, self.platform_test_start)

    # 接口测试开始事件
    def platform_test_start(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().api_tester_running,
            })
        else:
            threading.Thread(
                target = self.platform_test_start_target,
                args = (event, data),
            ).start()

    # 接口测试开始
    def platform_test_start_target(self, event: Base.Event, data: dict) -> None:
        # 更新运行状态
        Engine.get().set_status(Base.TaskStatus.TESTING)

        # 加载配置
        config = Config().load()
        platform = config.get_platform(data.get("id"))

        # 测试结果
        failure = []
        success = []

        # 构造提示词
        if platform.get("api_format") == Base.APIFormat.SAKURALLM:
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
                    "content": "将下面的日文文本翻译成中文，按输入格式返回结果：{\"0\":\"魔導具師ダリヤはうつむかない\"}",
                },
            ]

        # 重置请求器
        TaskRequester.reset()

        # 开始测试
        requester = TaskRequester(config, platform)
        for key in platform.get("api_key"):
            self.print("")
            self.info(Localizer.get().api_tester_key + "\n" + f"[green]{key}[/]")
            self.info(Localizer.get().api_tester_messages + "\n" + f"{messages}")
            skip, response_think, response_result, _, _ = requester.request(messages)

            # 提取回复内容
            if skip == True:
                failure.append(key)
                self.warning(Localizer.get().log_api_test_fail)
            elif response_think == "":
                success.append(key)
                self.info(Localizer.get().engine_response_result + "\n" + response_result)
            else:
                success.append(key)
                self.info(Localizer.get().engine_response_think + "\n" + response_think)
                self.info(Localizer.get().engine_response_result + "\n" + response_result)

        # 测试结果
        result_msg = (
            Localizer.get().api_tester_result.replace("{COUNT}", str(len(platform.get("api_key"))))
                                             .replace("{SUCCESS}", str(len(success)))
                                             .replace("{FAILURE}", str(len(failure)))
        )
        self.print("")
        self.info(result_msg)

        # 失败密钥
        if len(failure) > 0:
            self.warning(Localizer.get().api_tester_result_failure + "\n" + "\n".join(failure))

        # 发送完成事件
        self.emit(Base.Event.APITEST_DONE, {
            "result": len(failure) == 0,
            "result_msg": result_msg,
        })

        # 更新运行状态
        Engine.get().set_status(Base.TaskStatus.IDLE)