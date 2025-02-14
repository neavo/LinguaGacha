import os
import threading

from base.Base import Base
from module.TextHelper import TextHelper
from module.Translator.TranslatorRequester import TranslatorRequester

class PlatformTester(Base):

    def __init__(self) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.PLATFORM_TEST_START, self.platform_test_start)

    # 接口测试开始事件
    def platform_test_start(self, event: int, data: dict) -> None:
        thread = threading.Thread(target = self.platform_test_start_target, args = (event, data))
        thread.start()

    # 接口测试开始
    def platform_test_start_target(self, event: int, data: dict) -> None:
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
            self.info(f"网络代理已启动，代理地址：{config.get("proxy_url")}")

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
            self.info(f"正在测试密钥 - {key}")
            self.info(f"正在发送提示词 - {messages}")
            skip, response_think, response_result, _, _ = requester.request(messages)
            if skip == True:
                failure.append(key)
                self.warning(f"接口测试失败 ... ")
            elif response_think == "":
                success.append(key)
                self.info(f"模型返回结果 - {TextHelper.safe_load_json_dict(response_result)}")
            else:
                success.append(key)
                self.info(f"模型思考内容 - {response_think}")
                self.info(f"模型返回结果 - {TextHelper.safe_load_json_dict(response_result)}")

        # 测试结果
        self.print("")
        self.info(f"共测试 {len(platform.get("api_key"))} 个接口，成功 {len(success)} 个，失败 {len(failure)} 个 ...")

        # 发送完成事件
        self.emit(Base.Event.PLATFORM_TEST_DONE, {
            "success": success,
            "failure": failure,
        })