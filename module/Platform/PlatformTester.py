import os
import threading

from base.Base import Base
from module.Localizer.Localizer import Localizer
from module.Translator.TranslatorRequester import TranslatorRequester

class PlatformTester(Base):

    def __init__(self) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.PLATFORM_TEST_START, self.platform_test_start)

    # 接口测试开始事件
    def platform_test_start(self, event: int, data: dict) -> None:
        if Base.WORK_STATUS != Base.Status.IDLE:
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().platofrm_tester_running,
            })
        else:
            threading.Thread(
                target = self.platform_test_start_target,
                args = (event, data),
            ).start()

    # 接口测试开始
    def platform_test_start_target(self, event: int, data: dict) -> None:
        # 更新运行状态
        Base.WORK_STATUS = Base.Status.TESTING

        platform = {}
        config = self.load_config()
        for item in config.get("platforms"):
            if item.get("id") == data.get("id"):
                platform = item
                break

        # 网络代理
        if config.get("proxy_enable") == False or config.get("proxy_url") == "":
            os.environ.pop("http_proxy", None)
            os.environ.pop("https_proxy", None)
        else:
            os.environ["http_proxy"] = config.get("proxy_url")
            os.environ["https_proxy"] = config.get("proxy_url")
            self.info(f"{Localizer.get().platofrm_tester_proxy}{config.get("proxy_url")}")

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
        elif platform.get("api_format") == Base.APIFormat.GOOGLE:
            messages = [
                {
                    "role": "user",
                    "parts": "将下面的日文文本翻译成中文：魔導具師ダリヤはうつむかない\n遵循以下JSON格式返回结果：\n{\"<ID>\":\"<译文文本>\"}",
                },
            ]
        else:
            messages = [
                {
                    "role": "user",
                    "content": "将下面的日文文本翻译成中文：魔導具師ダリヤはうつむかない\n遵循以下JSON格式返回结果：\n{\"<ID>\":\"<译文文本>\"}",
                },
            ]

        # 开始测试
        requester = TranslatorRequester(config, platform, 0)
        for key in platform.get("api_key"):
            self.print("")
            self.info(f"{Localizer.get().platofrm_tester_key} - {key}")
            self.info(f"{Localizer.get().platofrm_tester_messages} - {messages}")
            skip, response_think, response_result, _, _ = requester.request(messages)

            # 提取回复内容
            if skip == True:
                failure.append(key)
                self.warning(Localizer.get().log_api_test_fail)
            elif response_think == "":
                success.append(key)
                self.info(f"{Localizer.get().platofrm_tester_response_result} - {response_result}")
            else:
                success.append(key)
                self.info(f"{Localizer.get().platofrm_tester_response_think} - {response_result}")
                self.info(f"{Localizer.get().platofrm_tester_response_result} - {response_result}")

        # 测试结果
        result_msg = (
            Localizer.get().platofrm_tester_result.replace("{COUNT}", f"{len(platform.get("api_key"))}")
                                                  .replace("{SUCCESS}", f"{len(success)}")
                                                  .replace("{FAILURE}", f"{len(failure)}")
        )
        self.print("")
        self.info(result_msg)

        # 更新运行状态
        Base.WORK_STATUS = Base.Status.IDLE

        # 发送完成事件
        self.emit(Base.Event.PLATFORM_TEST_DONE, {
            "result": len(failure) == 0,
            "result_msg": result_msg,
        })