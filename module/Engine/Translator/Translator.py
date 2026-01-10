import concurrent.futures
import os
import re
import shutil
import threading
import time
import webbrowser
from itertools import zip_longest

import httpx
from rich.progress import TaskID

from base.Base import Base
from model.Item import Item
from module.CacheManager import CacheManager
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Engine.Translator.TranslatorTask import TranslatorTask
from module.File.FileManager import FileManager
from module.Filter.LanguageFilter import LanguageFilter
from module.Filter.RuleFilter import RuleFilter
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar
from module.PromptBuilder import PromptBuilder
from module.ResultChecker import ResultChecker
from module.TextProcessor import TextProcessor

# 翻译器
class Translator(Base):

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.cache_manager = CacheManager(service = True)

        # 线程锁
        self.data_lock = threading.Lock()

        # 注册事件
        self.subscribe(Base.Event.PROJECT_CHECK_RUN, self.project_check_run)
        self.subscribe(Base.Event.TRANSLATION_RUN, self.translation_run)
        self.subscribe(Base.Event.TRANSLATION_EXPORT, self.translation_export)
        self.subscribe(Base.Event.TRANSLATION_REQUIRE_STOP, self.translation_require_stop)

    # 翻译状态检查事件
    def project_check_run(self, event: Base.Event, data: dict) -> None:

        def task(event: str, data: dict) -> None:
            if Engine.get().get_status() != Base.TaskStatus.IDLE:
                status = Base.ProjectStatus.NONE
            else:
                cache_manager = CacheManager(service = False)
                cache_manager.load_project_from_file(Config().load().output_folder)
                status = cache_manager.get_project().get_status()

            self.emit(Base.Event.PROJECT_CHECK_DONE, {
                "status" : status,
            })
        threading.Thread(target = task, args = (event, data)).start()

    # 翻译开始事件
    def translation_run(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() == Base.TaskStatus.IDLE:
            threading.Thread(
                target = self.start,
                args = (event, data),
            ).start()
        else:
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().engine_task_running,
            })

    # 翻译停止事件
    def translation_require_stop(self, event: Base.Event, data: dict) -> None:
        # 更新运行状态
        Engine.get().set_status(Base.TaskStatus.STOPPING)

        def start(event: str, data: dict) -> None:
            while True:
                time.sleep(0.5)

                if Engine.get().get_running_task_count() == 0:
                    # 等待回调执行完毕
                    time.sleep(1.0)

                    # 写入缓存
                    self.cache_manager.save_to_file(
                        project = self.cache_manager.get_project(),
                        items = self.cache_manager.get_items(),
                        output_folder = self.config.output_folder,
                    )

                    # 日志
                    self.print("")
                    self.info(Localizer.get().engine_task_stop)
                    self.print("")

                    # 通知
                    self.emit(Base.Event.TOAST, {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().engine_task_stop,
                    })

                    # 更新运行状态
                    Engine.get().set_status(Base.TaskStatus.IDLE)
                    self.emit(Base.Event.TRANSLATION_DONE, {})
                    break
        threading.Thread(target = start, args = (event, data)).start()

    # 翻译结果手动导出事件
    def translation_export(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() != Base.TaskStatus.TRANSLATING:
            return None

        # 复制一份以避免影响原始数据
        def start(event: str, data: dict) -> None:
            items = self.cache_manager.copy_items()
            self.mtool_optimizer_postprocess(items)
            self.check_and_wirte_result(items)
        threading.Thread(target = start, args = (event, data)).start()

    # 实际的翻译流程
    def start(self, event: Base.Event, data: dict) -> None:
        config: Base.ProjectStatus = data.get("config")
        status: Base.ProjectStatus = data.get("status")

        # 更新运行状态
        Engine.get().set_status(Base.TaskStatus.TRANSLATING)

        # 初始化
        self.config = config if isinstance(config, Config) else Config().load()
        self.platform = self.config.get_platform(self.config.activate_platform)
        local_flag = self.initialize_local_flag()
        max_workers, rpm_threshold = self.initialize_max_workers()

        # 重置
        TextProcessor.reset()
        TaskRequester.reset()
        PromptBuilder.reset()

        # 生成缓存列表
        if status == Base.ProjectStatus.PROCESSING:
            self.cache_manager.load_from_file(self.config.output_folder)
        else:
            shutil.rmtree(f"{self.config.output_folder}/cache", ignore_errors = True)
            project, items = FileManager(self.config).read_from_path()
            self.cache_manager.set_items(items)
            self.cache_manager.set_project(project)

        # 检查数据是否为空
        if self.cache_manager.get_item_count() == 0:
            # 通知
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().engine_no_items,
            })

            self.emit(Base.Event.TRANSLATION_REQUIRE_STOP, {})
            return None

        # 加载进度数据
        if status == Base.ProjectStatus.PROCESSING:
            self.extras = self.cache_manager.get_project().get_extras()
            self.extras["start_time"] = time.time() - self.extras.get("time", 0)
            # 根据实际的 Item 状态重新计算 line，避免因 items.json 和 project.json 保存时间差导致的不一致
            self.extras["line"] = self.cache_manager.get_item_count_by_status(Base.ProjectStatus.PROCESSED)
        else:
            self.extras = {
                "start_time": time.time(),
                "total_line": 0,
                "line": 0,
                "total_tokens": 0,
                "total_output_tokens": 0,
                "time": 0,
            }

        # 更新翻译进度
        self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)

        # 规则过滤
        self.rule_filter(self.cache_manager.get_items())

        # 语言过滤
        self.language_filter(self.cache_manager.get_items())

        # MTool 优化器预处理
        self.mtool_optimizer_preprocess(self.cache_manager.get_items())

        # 开始循环
        for current_round in range(self.config.max_round):
            # 检测是否需要停止任务
            # 目的是避免用户正好在两轮之间停止任务
            if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                return None

            # 第一轮时更新任务的总行数
            # 从头翻译时：total_line = 0 + 待翻译行数
            # 继续翻译时：total_line = 已完成行数 + 待翻译行数（保持整体进度，避免负数）
            if current_round == 0:
                remaining_count = self.cache_manager.get_item_count_by_status(Base.ProjectStatus.NONE)
                self.extras["total_line"] = self.extras.get("line", 0) + remaining_count

            # 第二轮开始切分
            if current_round > 0:
                self.config.input_token_threshold = max(1, int(self.config.input_token_threshold / 3))

            # 生成缓存数据条目片段
            chunks, precedings = self.cache_manager.generate_item_chunks(
                input_token_threshold = self.config.input_token_threshold,
                preceding_lines_threshold = self.config.preceding_lines_threshold,
            )

            # 仅在第一轮启用参考上文功能
            if current_round > 0:
                precedings = [[] for _ in range(len(precedings))]

            # 生成翻译任务
            self.print("")
            tasks: list[TranslatorTask] = []
            with ProgressBar(transient = False) as progress:
                pid = progress.new()
                for items, precedings in zip(chunks, precedings):
                    progress.update(pid, advance = 1, total = len(chunks))
                    tasks.append(TranslatorTask(self.config, self.platform, local_flag, items, precedings))

            # 打印日志
            self.info(Localizer.get().engine_task_generation.replace("{COUNT}", str(len(chunks))))

            # 输出开始翻译的日志
            self.print("")
            self.print("")
            self.info(f"{Localizer.get().engine_current_round} - {current_round + 1}")
            self.info(f"{Localizer.get().engine_max_round} - {self.config.max_round}")
            self.print("")
            self.info(f"{Localizer.get().engine_api_name} - {self.platform.get("name")}")
            self.info(f"{Localizer.get().engine_api_url} - {self.platform.get("api_url")}")
            self.info(f"{Localizer.get().engine_api_model} - {self.platform.get("model")}")
            self.print("")
            if self.platform.get("api_format") != Base.APIFormat.SAKURALLM:
                self.info(PromptBuilder(self.config).build_main())
                self.print("")

            # 开始执行翻译任务
            task_limiter = TaskLimiter(rps = max_workers, rpm = rpm_threshold)
            with ProgressBar(transient = True) as progress:
                with concurrent.futures.ThreadPoolExecutor(max_workers = max_workers, thread_name_prefix = Engine.TASK_PREFIX) as executor:
                    pid = progress.new()
                    for task in tasks:
                        # 检测是否需要停止任务
                        # 目的是绕过限流器，快速结束所有剩余任务
                        if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                            return None

                        task_limiter.wait()
                        future = executor.submit(task.start)
                        future.add_done_callback(lambda future: self.task_done_callback(future, pid, progress))

            # 判断是否需要继续翻译
            if self.cache_manager.get_item_count_by_status(Base.ProjectStatus.NONE) == 0:
                self.cache_manager.get_project().set_status(Base.ProjectStatus.PROCESSED)

                # 日志
                self.print("")
                self.info(Localizer.get().engine_task_done)
                self.info(Localizer.get().engine_task_save)
                self.print("")

                # 通知
                self.emit(Base.Event.TOAST, {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().engine_task_done,
                })
                break

            # 检查是否达到最大轮次
            if current_round >= self.config.max_round - 1:
                # 日志
                self.print("")
                self.warning(Localizer.get().engine_task_fail)
                self.warning(Localizer.get().engine_task_save)
                self.print("")

                # 通知
                self.emit(Base.Event.TOAST, {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().engine_task_fail,
                })
                break

        # 等待回调执行完毕
        time.sleep(1.0)

        # MTool 优化器后处理
        self.mtool_optimizer_postprocess(self.cache_manager.get_items())

        # 写入缓存
        self.cache_manager.save_to_file(
            project = self.cache_manager.get_project(),
            items = self.cache_manager.get_items(),
            output_folder = self.config.output_folder,
        )

        # 检查结果并写入文件
        self.check_and_wirte_result(self.cache_manager.get_items())

        # 重置内部状态（正常完成翻译）
        Engine.get().set_status(Base.TaskStatus.IDLE)

        # 触发翻译停止完成的事件
        self.emit(Base.Event.TRANSLATION_DONE, {})

    # 初始化本地标识
    def initialize_local_flag(self) -> bool:
        return re.search(
            r"^http[s]*://localhost|^http[s]*://\d+\.\d+\.\d+\.\d+",
            self.platform.get("api_url"),
            flags = re.IGNORECASE,
        ) is not None

    # 初始化速度控制器
    def initialize_max_workers(self) -> tuple[int, int]:
        max_workers: int = self.config.max_workers
        rpm_threshold: int = self.config.rpm_threshold

        # 当 max_workers = 0 时，尝试获取 llama.cpp 槽数
        if max_workers == 0:
            try:
                response_json = None
                response = httpx.get(re.sub(r"/v1$", "", self.platform.get("api_url")) + "/slots")
                response.raise_for_status()
                response_json = response.json()
            except Exception:
                pass
            if isinstance(response_json, list) and len(response_json) > 0:
                max_workers = len(response_json)

        if max_workers == 0 and rpm_threshold == 0:
            max_workers = 8
            rpm_threshold = 0
        elif max_workers > 0 and rpm_threshold == 0:
            pass
        elif max_workers == 0 and rpm_threshold > 0:
            max_workers = 8192
            rpm_threshold = rpm_threshold

        return max_workers, rpm_threshold

    # 规则过滤
    def rule_filter(self, items: list[Item]) -> None:
        if len(items) == 0:
            return None

        # 筛选
        self.print("")
        count: int = 0
        with ProgressBar(transient = False) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance = 1, total = len(items))
                if RuleFilter.filter(item.get_src()) == True:
                    count = count + 1
                    item.set_status(Base.ProjectStatus.EXCLUDED)

        # 打印日志
        self.info(Localizer.get().engine_task_rule_filter.replace("{COUNT}", str(count)))

    # 语言过滤
    def language_filter(self, items: list[Item]) -> None:
        if len(items) == 0:
            return None

        # 筛选
        self.print("")
        count: int = 0
        with ProgressBar(transient = False) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance = 1, total = len(items))
                if LanguageFilter.filter(item.get_src(), self.config.source_language) == True:
                    count = count + 1
                    item.set_status(Base.ProjectStatus.EXCLUDED)

        # 打印日志
        self.info(Localizer.get().engine_task_language_filter.replace("{COUNT}", str(count)))

    # MTool 优化器预处理
    def mtool_optimizer_preprocess(self, items: list[Item]) -> None:
        if len(items) == 0 or self.config.mtool_optimizer_enable == False:
            return None

        # 筛选
        self.print("")
        count: int = 0
        items_kvjson: list[Item] = []
        with ProgressBar(transient = False) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance = 1, total = len(items))
                if item.get_file_type() == Item.FileType.KVJSON:
                    items_kvjson.append(item)

        # 按文件路径分组
        group_by_file_path: dict[str, list[Item]] = {}
        for item in items_kvjson:
            group_by_file_path.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件的数据
        for items_by_file_path in group_by_file_path.values():
            # 找出子句
            target = set()
            for item in items_by_file_path:
                src = item.get_src()
                if src.count("\n") > 0:
                    target.update([line.strip() for line in src.splitlines() if line.strip() != ""])

            # 移除子句
            for item in items_by_file_path:
                if item.get_src() in target:
                    count = count + 1
                    item.set_status(Base.ProjectStatus.EXCLUDED)

        # 打印日志
        self.info(Localizer.get().translator_mtool_optimizer_pre_log.replace("{COUNT}", str(count)))

    # MTool 优化器后处理
    def mtool_optimizer_postprocess(self, items: list[Item]) -> None:
        if len(items) == 0 or self.config.mtool_optimizer_enable == False:
            return None

        # 筛选
        self.print("")
        items_kvjson: list[Item] = []
        with ProgressBar(transient = True) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance = 1, total = len(items))
                if item.get_file_type() == Item.FileType.KVJSON:
                    items_kvjson.append(item)

        # 按文件路径分组
        group_by_file_path: dict[str, list[Item]] = {}
        for item in items_kvjson:
            group_by_file_path.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件的数据
        for items_by_file_path in group_by_file_path.values():
            for item in items_by_file_path:
                src = item.get_src()
                dst = item.get_dst()
                if src.count("\n") > 0:
                    for src_line, dst_line in zip_longest(src.splitlines(), dst.splitlines(), fillvalue = ""):
                        item_ex = Item.from_dict(item.to_dict())
                        item_ex.set_src(src_line.strip())
                        item_ex.set_dst(dst_line.strip())
                        item_ex.set_row(len(items_by_file_path))
                        items.append(item_ex)

        # 打印日志
        self.info(Localizer.get().translator_mtool_optimizer_post_log)

    # 检查结果并写入文件
    def check_and_wirte_result(self, items: list[Item]) -> None:
        # 启用自动术语表的时，更新配置文件
        if self.config.glossary_enable == True and self.config.auto_glossary_enable == True:
            # 更新配置文件
            config = Config().load()
            config.glossary_data = self.config.glossary_data
            config.save()

            # 术语表刷新事件
            self.emit(Base.Event.GLOSSARY_REFRESH, {})

        # 检查结果
        ResultChecker(self.config, items).check()

        # 写入文件
        FileManager(self.config).write_to_path(items)
        self.print("")
        self.info(Localizer.get().engine_task_save_done.replace("{PATH}", self.config.output_folder))
        self.print("")

        # 打开输出文件夹
        if self.config.output_folder_open_on_finish == True:
            webbrowser.open(os.path.abspath(self.config.output_folder))

    # 翻译任务完成时
    def task_done_callback(self, future: concurrent.futures.Future, pid: TaskID, progress: ProgressBar) -> None:
        try:
            # 获取结果
            result = future.result()

            # 结果为空则跳过后续的更新步骤
            if not isinstance(result, dict) or len(result) == 0:
                return

            # 记录数据
            with self.data_lock:
                new = {}
                new["start_time"] = self.extras.get("start_time", 0)
                new["total_line"] = self.extras.get("total_line", 0)
                new["line"] = self.extras.get("line", 0) + result.get("row_count", 0)
                new["total_tokens"] = self.extras.get("total_tokens", 0) + result.get("input_tokens", 0) + result.get("output_tokens", 0)
                new["total_output_tokens"] = self.extras.get("total_output_tokens", 0) + result.get("output_tokens", 0)
                new["time"] = time.time() - self.extras.get("start_time", 0)
                self.extras = new

            # 更新翻译进度
            self.cache_manager.get_project().set_extras(self.extras)

            # 更新翻译状态
            self.cache_manager.get_project().set_status(Base.ProjectStatus.PROCESSING)

            # 请求保存缓存文件
            self.cache_manager.require_save_to_file(self.config.output_folder)

            # 日志
            progress.update(
                pid,
                total = self.extras.get("total_line", 0),
                completed = self.extras.get("line", 0),
            )

            # 触发翻译进度更新事件
            self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)