import concurrent.futures
import os
import re
import threading
import time
import webbrowser
from itertools import zip_longest
from queue import PriorityQueue
from typing import Optional

import httpx
from rich.progress import TaskID

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskScheduler import PriorityQueueItem
from module.Engine.TaskScheduler import TaskScheduler
from module.File.FileManager import FileManager
from module.Filter.LanguageFilter import LanguageFilter
from module.Filter.RuleFilter import RuleFilter
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar
from module.PromptBuilder import PromptBuilder
from module.QualityRuleManager import QualityRuleManager
from module.Storage.DataStore import DataStore
from module.Storage.StorageContext import StorageContext
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor


# 翻译器
class Translator(Base):
    def __init__(self) -> None:
        super().__init__()

        # 翻译过程中的 items 缓存（内存中维护，避免频繁读写数据库）
        self.items_cache: Optional[list[Item]] = None

        # 翻译进度额外数据
        self.extras: dict = {}

        # 正在执行的任务计数器（用于精准判断任务结束）
        self.active_task_count: int = 0

        # 线程锁
        self.db_lock = threading.Lock()

        # 配置
        self.config = Config().load()

        # 注册事件
        self.subscribe(Base.Event.PROJECT_CHECK_RUN, self.project_check_run)
        self.subscribe(Base.Event.TRANSLATION_RUN, self.translation_run)
        self.subscribe(Base.Event.TRANSLATION_EXPORT, self.translation_export)
        self.subscribe(Base.Event.TRANSLATION_RESET, self.translation_reset)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.translation_require_stop
        )

    # 翻译状态检查事件
    def project_check_run(self, event: Base.Event, data: dict) -> None:
        def task(event_name: str, task_data: dict) -> None:
            ctx = StorageContext.get()
            extras = {}

            if Engine.get().get_status() != Base.TaskStatus.IDLE:
                # 引擎忙碌时，依然从数据库获取真实状态和进度，避免 UI 按钮被错误禁用
                if ctx.is_loaded():
                    status = ctx.get_project_status()
                    extras = ctx.get_translation_extras()
                else:
                    status = Base.ProjectStatus.NONE
            else:
                # 引擎空闲，获取工程状态和进度
                if ctx.is_loaded():
                    status = ctx.get_project_status()
                    extras = ctx.get_translation_extras()
                else:
                    status = Base.ProjectStatus.NONE

            self.emit(
                Base.Event.PROJECT_CHECK_DONE,
                {
                    "status": status,
                    "extras": extras,
                },
            )

        threading.Thread(target=task, args=(event, data)).start()

    # 翻译开始事件
    def translation_run(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() == Base.TaskStatus.IDLE:
            threading.Thread(
                target=self.start,
                args=(event, data),
            ).start()
        else:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().engine_task_running,
                },
            )

    # 翻译停止事件
    def translation_require_stop(self, event: Base.Event, data: dict) -> None:
        # 更新运行状态
        Engine.get().set_status(Base.TaskStatus.STOPPING)

    # 翻译重置事件
    def translation_reset(self, event: Base.Event, data: dict) -> None:
        def task() -> None:
            ctx = StorageContext.get()
            if not ctx.is_loaded():
                return

            db = ctx.get_db()
            if db is None:
                return

            # 1. 重新解析资产以获取初始状态的条目
            # 这里必须使用 RESET 模式来强制重新解析，而不是读缓存
            items = FileManager(self.config).get_items_for_translation(
                Base.TranslationMode.RESET
            )

            # 2. 清空并重新写入条目到数据库
            db.set_items([item.to_dict() for item in items])

            # 3. 清除元数据中的进度信息
            ctx.set_translation_extras({})

            # 4. 设置项目状态为 NONE
            ctx.set_project_status(Base.ProjectStatus.NONE)

            # 5. 更新本地缓存
            self.extras = ctx.get_translation_extras()

            # 触发状态检查以同步 UI
            self.emit(Base.Event.PROJECT_CHECK_RUN, {})
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_reset_toast,
                },
            )

        threading.Thread(target=task).start()

    # 翻译结果手动导出事件

    def translation_export(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() == Base.TaskStatus.STOPPING:
            return None

        # 复制一份以避免影响原始数据
        def start_export(event_name: str, task_data: dict) -> None:
            # 如果正在翻译，从缓存获取数据以保证实时性；否则从数据库加载
            if self.items_cache is not None:
                items = self.copy_items()
            else:
                ctx = StorageContext.get()
                if not ctx.is_loaded():
                    return
                db = ctx.get_db()
                if db is None:
                    return
                items = [Item.from_dict(d) for d in db.get_all_items()]

            if not items:
                return

            self.mtool_optimizer_postprocess(items)
            self.check_and_wirte_result(items)

        threading.Thread(target=start_export, args=(event, data)).start()

    # 实际的翻译流程
    def start(self, event: Base.Event, data: dict) -> None:
        try:
            config: Config | None = data.get("config")
            mode_raw = data.get("mode")
            mode: Base.TranslationMode = (
                mode_raw
                if isinstance(mode_raw, Base.TranslationMode)
                else Base.TranslationMode.NEW
            )

            # 更新运行状态
            Engine.get().set_status(Base.TaskStatus.TRANSLATING)

            # 初始化
            self.config = config if isinstance(config, Config) else Config().load()

            # 检查工程是否已加载
            ctx = StorageContext.get()
            if not ctx.is_loaded():
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": "请先加载工程文件",
                    },
                )
                return None

            db = ctx.get_db()
            if db is None:
                return None

            # 翻译期间打开长连接（提升高频写入性能，翻译结束后关闭以清理 WAL 文件）
            db.open()

            # 从新模型系统获取激活模型
            self.model = self.config.get_active_model()
            if self.model is None:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": "未找到激活的模型配置",
                    },
                )
                return None

            max_workers, rpm_threshold = self.initialize_max_workers()

            # 重置
            TextProcessor.reset()
            TaskRequester.reset()
            PromptBuilder.reset()

            # 1. 获取数据 (交给文件管理器，翻译器不再关心是读缓存还是重解析)
            # 文件管理器会根据 mode 自动决定是从 DataStore 还是 Assets 加载
            self.items_cache = FileManager(self.config).get_items_for_translation(mode)

            # 检查数据是否为空
            if len(self.items_cache) == 0:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().engine_no_items,
                    },
                )
                return None

            # 2. 进度管理与初始化
            if mode == Base.TranslationMode.CONTINUE:
                # 继续翻译：恢复进度
                self.extras = ctx.get_translation_extras()
                self.extras["start_time"] = time.time() - self.extras.get("time", 0)
                self.extras["processed_line"] = self.get_item_count_by_status(
                    Base.ProjectStatus.PROCESSED
                )
                self.extras["error_line"] = self.get_item_count_by_status(
                    Base.ProjectStatus.ERROR
                )
                self.extras["line"] = (
                    self.extras["processed_line"] + self.extras["error_line"]
                )
            else:
                # 新翻译或重置翻译：初始化全新的进度数据
                self.extras = {
                    "start_time": time.time(),
                    "total_line": 0,
                    "line": 0,
                    "processed_line": 0,
                    "error_line": 0,
                    "total_tokens": 0,
                    "total_input_tokens": 0,
                    "total_output_tokens": 0,
                    "time": 0,
                }

            # 更新翻译进度
            self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)

            # 3. 过滤与预处理 (核心业务逻辑保留在翻译器)
            # 规则过滤
            self.rule_filter(self.items_cache)

            # 语言过滤
            self.language_filter(self.items_cache)

            # MTool 优化器预处理
            self.mtool_optimizer_preprocess(self.items_cache)

            # 持久化初始化后的状态（包括过滤掉的条目）
            db.set_items([item.to_dict() for item in self.items_cache])

            # 初始化任务调度器
            self.scheduler = TaskScheduler(self.config, self.model, self.items_cache)
            self.task_queue: "PriorityQueue[PriorityQueueItem]" = PriorityQueue()

            # 生成初始任务并加入队列
            initial_tasks = self.scheduler.generate_initial_tasks()
            for task_item in initial_tasks:
                self.task_queue.put(task_item)

            # 更新任务的总行数
            remaining_count = self.get_item_count_by_status(Base.ProjectStatus.NONE)
            self.extras["total_line"] = self.extras.get("line", 0) + remaining_count

            # 打印日志
            self.info(
                Localizer.get().engine_task_generation.replace(
                    "{COUNT}", str(len(initial_tasks))
                )
            )

            # 输出开始翻译的日志
            self.print("")
            self.info(
                f"{Localizer.get().engine_api_name} - {self.model.get('name', '')}"
            )
            self.info(
                f"{Localizer.get().engine_api_url} - {self.model.get('api_url', '')}"
            )
            self.info(
                f"{Localizer.get().engine_api_model} - {self.model.get('model_id', '')}"
            )
            self.print("")
            if self.model.get("api_format") != Base.APIFormat.SAKURALLM:
                self.info(PromptBuilder(self.config).build_main())
                self.print("")

            # 启动消费者线程池
            task_limiter = TaskLimiter(
                rps=max_workers, rpm=rpm_threshold, max_concurrency=max_workers
            )

            with ProgressBar(transient=True) as progress:
                pid = progress.new(
                    total=self.extras.get("total_line", 0),
                    completed=self.extras.get("line", 0),
                )
                with concurrent.futures.ThreadPoolExecutor(
                    max_workers=max_workers, thread_name_prefix=Engine.TASK_PREFIX
                ) as executor:
                    # 消费者循环
                    while not self.scheduler.should_stop(
                        self.task_queue, self.active_task_count
                    ):
                        # 检测是否需要停止任务
                        if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                            break

                        try:
                            # 尝试从队列获取任务 (阻塞式等待，提升响应性能)
                            try:
                                queue_item = self.task_queue.get(timeout=0.1)
                            except Exception:
                                continue

                            # 流量限制
                            if not task_limiter.acquire(
                                lambda: Engine.get().get_status()
                                == Base.TaskStatus.STOPPING
                            ):
                                break

                            if not task_limiter.wait(
                                lambda: Engine.get().get_status()
                                == Base.TaskStatus.STOPPING
                            ):
                                break

                            # 等待限流后再次检查停止状态，避免提交即将被取消的任务
                            if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                                break

                            # 提交任务
                            if queue_item.task is None:
                                continue

                            with self.db_lock:
                                self.active_task_count += 1

                            try:
                                future = executor.submit(queue_item.task.start)
                                future.add_done_callback(task_limiter.release)
                                future.add_done_callback(
                                    lambda fut,
                                    q_item=queue_item: self.task_done_callback(
                                        fut, pid, progress, q_item
                                    )
                                )
                            except Exception as e:
                                # 提交失败时，必须减少计数器，否则会导致死锁
                                with self.db_lock:
                                    self.active_task_count -= 1

                                self.error("提交任务失败", e)
                                task_limiter.release(None)  # 释放限流锁
                        except Exception:
                            time.sleep(0.1)
                            continue

            # 判断翻译是否完成
            if self.get_item_count_by_status(Base.ProjectStatus.NONE) == 0:
                # 日志
                self.print("")
                self.info(Localizer.get().engine_task_done)
                self.info(Localizer.get().engine_task_save)
                self.print("")

                # 通知
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().engine_task_done,
                    },
                )
            else:
                # 停止翻译（可能是主动停止，也可能是其他原因未完成）
                self.print("")
                if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                    self.info(Localizer.get().engine_task_stop)
                else:
                    self.warning(Localizer.get().engine_task_fail)
                self.info(Localizer.get().engine_task_save)
                self.print("")

                # 通知
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().engine_task_stop
                        if Engine.get().get_status() == Base.TaskStatus.STOPPING
                        else Localizer.get().engine_task_fail,
                    },
                )
        except Exception as e:
            self.error(f"{Localizer.get().task_failed}", e)
        finally:
            # 等待最后的回调执行完毕
            time.sleep(1.0)

            # MTool 优化器后处理
            if self.items_cache:
                self.mtool_optimizer_postprocess(self.items_cache)

            # 确定最终项目状态
            final_status = (
                Base.ProjectStatus.PROCESSED
                if self.get_item_count_by_status(Base.ProjectStatus.NONE) == 0
                else Base.ProjectStatus.PROCESSING
            )

            # 保存翻译结果到 .lg 文件
            self.save_translation_state(final_status)

            # 关闭长连接（WAL 文件将被清理）
            self.close_db_connection()

            # 检查结果并写入文件
            if (
                self.items_cache
                and Engine.get().get_status() != Base.TaskStatus.STOPPING
            ):
                self.check_and_wirte_result(self.items_cache)

            # 重置内部状态（正常完成翻译）
            Engine.get().set_status(Base.TaskStatus.IDLE)

            # 清理缓存
            self.items_cache = None

            # 触发翻译停止完成的事件
            self.emit(Base.Event.TRANSLATION_DONE, {})

    # ========== 辅助方法 ==========

    def get_item_count_by_status(self, status: Base.ProjectStatus) -> int:
        """按状态统计缓存中的条目数量"""
        if self.items_cache is None:
            return 0
        return len([item for item in self.items_cache if item.get_status() == status])

    def copy_items(self) -> list[Item]:
        """深拷贝缓存中的条目列表"""
        if self.items_cache is None:
            return []
        return [Item.from_dict(item.to_dict()) for item in self.items_cache]

    def close_db_connection(self) -> None:
        """关闭数据库长连接（翻译结束时调用，触发 WAL checkpoint）"""
        ctx = StorageContext.get()
        if ctx.is_loaded():
            db = ctx.get_db()
            if db is not None:
                db.close()

    def merge_glossary(self, glossary_list: list[dict[str, str]]) -> list[dict] | None:
        """
        合并术语表并更新缓存，返回待写入的数据（若无变化返回 None）
        """
        # 有效性检查
        if not QualityRuleManager.get().get_glossary_enable():
            return None

        # 提取现有术语表的原文列表
        data: list[dict] = QualityRuleManager.get().get_glossary()
        keys = {item.get("src", "") for item in data}

        # 合并去重后的术语表
        changed: bool = False
        for item in glossary_list:
            src = item.get("src", "").strip()
            dst = item.get("dst", "").strip()
            info = item.get("info", "").strip()

            # 有效性校验
            if not any(x in info.lower() for x in ("男", "女", "male", "female")):
                continue

            # 将原文和译文都按标点切分
            srcs: list[str] = TextHelper.split_by_punctuation(src, split_by_space=True)
            dsts: list[str] = TextHelper.split_by_punctuation(dst, split_by_space=True)
            if len(srcs) != len(dsts):
                srcs = [src]
                dsts = [dst]

            for src, dst in zip(srcs, dsts):
                src = src.strip()
                dst = dst.strip()
                if src == dst or src == "" or dst == "":
                    continue
                if not any(key == src for key in keys):
                    changed = True
                    keys.add(src)
                    data.append(
                        {
                            "src": src,
                            "dst": dst,
                            "info": info,
                        }
                    )

        if changed:
            # 更新术语表（仅更新内存缓存，待后续统一写入）
            QualityRuleManager.get().set_glossary(data, save=False)
            return data

        return None

    def save_translation_state(
        self, status: Base.ProjectStatus = Base.ProjectStatus.PROCESSING
    ) -> None:
        """保存翻译状态到 .lg 文件"""
        ctx = StorageContext.get()
        if not ctx.is_loaded() or self.items_cache is None:
            return

        # 保存翻译进度额外数据（仅当存在时）
        if self.extras:
            ctx.set_translation_extras(self.extras)

        # 设置项目状态
        ctx.set_project_status(status)

    # 初始化本地标识
    def initialize_local_flag(self) -> bool:
        if not hasattr(self, "model") or self.model is None:
            return False
        api_url = self.model.get("api_url", "")
        return (
            re.search(
                r"^http[s]*://localhost|^http[s]*://\d+\.\d+\.\d+\.\d+",
                api_url,
                flags=re.IGNORECASE,
            )
            is not None
        )

    # 初始化速度控制器
    def initialize_max_workers(self) -> tuple[int, int]:
        # 从模型的 threshold 读取
        if not hasattr(self, "model") or self.model is None:
            return 8, 0
        threshold = self.model.get("threshold", {})
        max_workers: int = threshold.get("concurrency_limit", 0)
        rpm_threshold: int = threshold.get("rpm_limit", 0)

        # 当 max_workers = 0 时，尝试获取 llama.cpp 槽数
        if max_workers == 0:
            try:
                api_url = self.model.get("api_url", "")
                response = httpx.get(re.sub(r"/v1$", "", api_url) + "/slots")
                response.raise_for_status()
                response_json = response.json()
                if isinstance(response_json, list) and len(response_json) > 0:
                    max_workers = len(response_json)
            except Exception:
                pass

        if max_workers == 0 and rpm_threshold == 0:
            max_workers = 8
            rpm_threshold = 0
        elif max_workers > 0 and rpm_threshold == 0:
            pass
        elif max_workers == 0 and rpm_threshold > 0:
            max_workers = 8192

        return max_workers, rpm_threshold

    # 规则过滤
    def rule_filter(self, items: list[Item]) -> None:
        if items is None or len(items) == 0:
            return None

        # 筛选
        self.print("")
        count: int = 0
        with ProgressBar(transient=False) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance=1, total=len(items))
                if RuleFilter.filter(item.get_src()):
                    count = count + 1
                    item.set_status(Base.ProjectStatus.EXCLUDED)

        # 打印日志
        self.info(
            Localizer.get().engine_task_rule_filter.replace("{COUNT}", str(count))
        )

    # 语言过滤
    def language_filter(self, items: list[Item]) -> None:
        if items is None or len(items) == 0:
            return None

        # 筛选
        self.print("")
        count: int = 0
        with ProgressBar(transient=False) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance=1, total=len(items))
                if LanguageFilter.filter(item.get_src(), self.config.source_language):
                    count = count + 1
                    item.set_status(Base.ProjectStatus.EXCLUDED)

        # 打印日志
        self.info(
            Localizer.get().engine_task_language_filter.replace("{COUNT}", str(count))
        )

    # MTool 优化器预处理
    def mtool_optimizer_preprocess(self, items: list[Item]) -> None:
        if items is None or len(items) == 0 or not self.config.mtool_optimizer_enable:
            return None

        # 筛选
        self.print("")
        count: int = 0
        items_kvjson: list[Item] = []
        with ProgressBar(transient=False) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance=1, total=len(items))
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
                    target.update(
                        [
                            line.strip()
                            for line in src.splitlines()
                            if line.strip() != ""
                        ]
                    )

            # 移除子句
            for item in items_by_file_path:
                if item.get_src() in target:
                    count = count + 1
                    item.set_status(Base.ProjectStatus.EXCLUDED)

        # 打印日志
        self.info(
            Localizer.get().translator_mtool_optimizer_pre_log.replace(
                "{COUNT}", str(count)
            )
        )

    # MTool 优化器后处理
    def mtool_optimizer_postprocess(self, items: list[Item]) -> None:
        if items is None or len(items) == 0 or not self.config.mtool_optimizer_enable:
            return None

        # 筛选
        self.print("")
        items_kvjson: list[Item] = []
        with ProgressBar(transient=True) as progress:
            pid = progress.new()
            for item in items:
                progress.update(pid, advance=1, total=len(items))
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
                    for src_line, dst_line in zip_longest(
                        src.splitlines(), dst.splitlines(), fillvalue=""
                    ):
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
        if (
            QualityRuleManager.get().get_glossary_enable()
            and self.config.auto_glossary_enable
        ):
            # 更新规则管理器 (已在 TranslatorTask.merge_glossary 中即时处理，此处仅作为冗余检查或保留事件触发)

            # 实际上 TranslatorTask 已经处理了保存，这里只需要触发事件即可
            # 术语表刷新事件
            self.emit(Base.Event.GLOSSARY_REFRESH, {})

        # 写入文件并获取实际输出路径（带时间戳）
        output_path = FileManager(self.config).write_to_path(items)
        self.print("")

        self.info(Localizer.get().engine_task_save_done.replace("{PATH}", output_path))
        self.print("")

        # 打开输出文件夹
        if self.config.output_folder_open_on_finish:
            webbrowser.open(os.path.abspath(output_path))

    # 翻译任务完成时
    def task_done_callback(
        self,
        future: concurrent.futures.Future,
        pid: TaskID,
        progress: ProgressBar,
        queue_item: PriorityQueueItem,
    ) -> None:
        try:
            # 获取结果 (防御性处理，确保异常被捕获)
            try:
                result = future.result()
            except Exception as e:
                self.error("任务执行异常", e)
                result = {"row_count": 0, "input_tokens": 0, "output_tokens": 0}

            task = queue_item.task
            if task is None:
                return

            # 处理失败或部分失败的任务
            # 只要还有 NONE 状态的条目，就说明该任务未完全成功，需要重试或切分
            unprocessed_items = [
                i for i in task.items if i.get_status() == Base.ProjectStatus.NONE
            ]
            if unprocessed_items:
                # 构造一个仅包含未处理条目的临时 Context 进行重试处理
                new_tasks = self.scheduler.handle_failed_task(queue_item, result)
                for new_q_item in new_tasks:
                    self.task_queue.put(new_q_item)

            # --- 合并写入事务 (锁定一次，写入一次) ---
            with self.db_lock:
                new_glossary_data = None
                # 1. 尝试合并术语表（如果任务返回了术语）
                glossaries = result.get("glossaries", [])
                if glossaries and self.config.auto_glossary_enable:
                    new_glossary_data = self.merge_glossary(glossaries)

                # 2. 筛选待存条目
                finalized_items = [
                    item.to_dict()
                    for item in task.items
                    if item.get_status()
                    in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR)
                ]

                # 3. 更新统计数据
                processed_count = len(
                    [
                        i
                        for i in task.items
                        if i.get_status() == Base.ProjectStatus.PROCESSED
                    ]
                )
                error_count = len(
                    [
                        i
                        for i in task.items
                        if i.get_status() == Base.ProjectStatus.ERROR
                    ]
                )

                new_extras = self.extras.copy()
                new_extras["processed_line"] = (
                    self.extras.get("processed_line", 0) + processed_count
                )
                new_extras["error_line"] = (
                    self.extras.get("error_line", 0) + error_count
                )
                new_extras["line"] = (
                    new_extras["processed_line"] + new_extras["error_line"]
                )
                new_extras["total_tokens"] = (
                    self.extras.get("total_tokens", 0)
                    + result.get("input_tokens", 0)
                    + result.get("output_tokens", 0)
                )
                new_extras["total_input_tokens"] = self.extras.get(
                    "total_input_tokens", 0
                ) + result.get("input_tokens", 0)
                new_extras["total_output_tokens"] = self.extras.get(
                    "total_output_tokens", 0
                ) + result.get("output_tokens", 0)
                new_extras["time"] = time.time() - self.extras.get("start_time", 0)
                self.extras = new_extras

                # 4. 执行综合批量更新
                ctx = StorageContext.get()
                if ctx.is_loaded():
                    db = ctx.get_db()
                    if db:
                        rules_map = {}
                        if new_glossary_data is not None:
                            rules_map[DataStore.RuleType.GLOSSARY] = new_glossary_data

                        db.update_batch(
                            items=finalized_items,
                            rules=rules_map,
                            meta={
                                "translation_extras": self.extras,
                                "project_status": Base.ProjectStatus.PROCESSING,
                            },
                        )

            # --- 后续处理 (非锁区) ---
            if new_glossary_data is not None:
                self.emit(Base.Event.GLOSSARY_REFRESH, {})

            # 更新终端进度条
            progress.update(
                pid,
                completed=self.extras.get("line", 0),
                total=self.extras.get("total_line", 0),
            )

            # 触发翻译进度更新事件
            self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)

        except concurrent.futures.CancelledError:
            # 任务取消是正常流程，无需记录错误
            pass
        except Exception as e:
            self.error(f"{Localizer.get().task_failed}", e)
        finally:
            with self.db_lock:
                self.active_task_count -= 1
