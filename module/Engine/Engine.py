import threading
import time
from typing import Callable
from typing import Self

import rich
from rich import box
from rich import markup
from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Localizer.Localizer import Localizer

class Engine():

    TASK_PREFIX: str = "ENGINE_"

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.status: Base.TaskStatus = Base.TaskStatus.IDLE

        # 线程锁
        self.lock = threading.Lock()

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__

    def run(self) -> None:
        from module.Engine.APITester.APITester import APITester
        self.api_test = APITester()

        from module.Engine.Translator.Translator import Translator
        self.translator = Translator()

    def get_status(self) -> Base.TaskStatus:
        with self.lock:
            return self.status

    def set_status(self, status: Base.TaskStatus) -> None:
        with self.lock:
            self.status = status

    def get_running_task_count(self) -> int:
        return sum(1 for t in threading.enumerate() if t.name.startswith(__class__.TASK_PREFIX))

    def translate_single_item(
        self,
        item: Item,
        config: Config,
        callback: Callable[[Item, bool], None]
    ) -> None:
        """
        对单个条目执行翻译，异步返回结果。

        Args:
            item: 待翻译的 Item 对象
            config: 翻译配置
            callback: 翻译完成后的回调函数，签名为 (item, success) -> None
        """
        def task() -> None:
            # 延迟导入避免循环依赖
            from module.Engine.TaskRequester import TaskRequester
            from module.PromptBuilder import PromptBuilder
            from module.Response.ResponseDecoder import ResponseDecoder
            from module.TextProcessor import TextProcessor

            # 任务开始时间
            start_time = time.time()

            success = False
            src_text = item.get_src()
            dst_text = ""
            try:
                # 获取激活的平台配置
                platform = config.get_platform(config.activate_platform)
                if not platform:
                    return

                # 文本预处理
                processor = TextProcessor(config, item)
                processor.pre_process()

                # 如果没有有效原文，直接使用原文作为译文
                if len(processor.srcs) == 0:
                    item.set_dst(item.get_src())
                    item.set_status(Base.ProjectStatus.PROCESSED)
                    dst_text = item.get_src()
                    success = True
                    return

                # 构建 Prompt
                prompt_builder = PromptBuilder(config)
                if platform.get("api_format") != Base.APIFormat.SAKURALLM:
                    messages, _ = prompt_builder.generate_prompt(
                        srcs=processor.srcs,
                        samples=processor.samples,
                        precedings=[],  # 单条翻译不使用参考上文
                        local_flag=False
                    )
                else:
                    messages, _ = prompt_builder.generate_prompt_sakura(processor.srcs)

                # 发送请求
                requester = TaskRequester(config, platform)
                skip, _, response_result, _, _ = requester.request(messages)

                if skip:
                    return

                # 解析响应
                dsts, _ = ResponseDecoder().decode(response_result)

                # 检查响应结果数量
                if len(dsts) < len(processor.srcs):
                    # 补足缺失的译文
                    dsts.extend([""] * (len(processor.srcs) - len(dsts)))

                # 后处理并更新 Item
                name, dst = processor.post_process(dsts[:len(processor.srcs)])
                item.set_dst(dst)
                if name is not None:
                    item.set_first_name_dst(name)
                item.set_status(Base.ProjectStatus.PROCESSED)
                dst_text = dst
                success = True
            except Exception as e:
                # 记录异常日志便于调试
                LogManager.get().error("Single item translate failed", e)
                success = False
            finally:
                # 打印日志
                self._print_single_translate_log(
                    src_text,
                    dst_text,
                    success,
                    start_time,
                )

                # 回调通知（在当前线程直接调用，UI 层需自行处理线程切换）
                if callback:
                    callback(item, success)

        # 启动后台线程
        thread = threading.Thread(
            target=task,
            name=f"{Engine.TASK_PREFIX}SINGLE"
        )
        thread.start()

    def _print_single_translate_log(
        self,
        src: str,
        dst: str,
        success: bool,
        start_time: float,
    ) -> None:
        """打印单条翻译的日志表格"""
        elapsed = time.time() - start_time

        if success:
            style = "green"
            message = Localizer.get().engine_single_translate_success.replace("{TIME}", f"{elapsed:.2f}")
        else:
            style = "red"
            message = Localizer.get().engine_single_translate_fail

        # 生成表格行
        rows = [markup.escape(message)]
        pair = f"{markup.escape(src.strip())} [bright_blue]-->[/] {markup.escape(dst.strip())}"
        rows.append(pair)

        # 生成并打印表格
        table = Table(
            box=box.ASCII2,
            expand=True,
            title=" ",
            caption=" ",
            highlight=True,
            show_lines=True,
            show_header=False,
            show_footer=False,
            collapse_padding=True,
            border_style=style,
        )
        table.add_column("", style="white", ratio=1, overflow="fold")
        for row in rows:
            table.add_row(row)

        rich.get_console().print(table)
