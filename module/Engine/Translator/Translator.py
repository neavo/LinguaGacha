import concurrent.futures
import os
import re
import threading
import time
import webbrowser
from itertools import zip_longest
from queue import PriorityQueue

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
from module.Storage.StorageContext import StorageContext
from module.TextProcessor import TextProcessor


# 翻译器
class Translator(Base):
    def __init__(self) -> None:
        super().__init__()

        # 翻译过程中的 items 缓存（内存中维护，避免频繁读写数据库）
        self.items_cache: list[Item] | None = None

        # 翻译进度额外数据
        self.extras: dict = {}

        # 正在执行的任务计数器（用于精准判断任务结束）
        self.active_task_count: int = 0

        # 线程锁
        self.data_lock = threading.Lock()

        # 注册事件
        self.subscribe(Base.Event.PROJECT_CHECK_RUN, self.project_check_run)
        self.subscribe(Base.Event.TRANSLATION_RUN, self.translation_run)
        self.subscribe(Base.Event.TRANSLATION_EXPORT, self.translation_export)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.translation_require_stop
        )

    # 翻译状态检查事件
    def project_check_run(self, event: Base.Event, data: dict) -> None:
        def task(event: str, data: dict) -> None:
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

    # 翻译结果手动导出事件

    def translation_export(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() != Base.TaskStatus.TRANSLATING:
            return None

        # 复制一份以避免影响原始数据
        def start(event: str, data: dict) -> None:
            items = self.copy_items()
            self.mtool_optimizer_postprocess(items)
            self.check_and_wirte_result(items)

        threading.Thread(target=start, args=(event, data)).start()

    # 实际的翻译流程
    def start(self, event: Base.Event, data: dict) -> None:
        try:
            config: Config | None = data.get("config")
            status: Base.ProjectStatus | None = data.get("status")

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

            # 从 .lg 文件加载条目到内存缓存
            self.items_cache = [Item.from_dict(d) for d in db.get_all_items()]

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

            # 加载进度数据
            if status == Base.ProjectStatus.PROCESSING:
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
                # 新翻译：重置所有条目状态
                for item in self.items_cache:
                    if item.get_status() not in (Base.ProjectStatus.EXCLUDED,):
                        item.set_status(Base.ProjectStatus.NONE)

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
            for item in initial_tasks:
                self.task_queue.put(item)

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
                pid = progress.new()
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

                            with self.data_lock:
                                self.active_task_count += 1

                            try:
                                future = executor.submit(queue_item.task.start)
                                future.add_done_callback(task_limiter.release)
                                future.add_done_callback(
                                    lambda future,
                                    item=queue_item: self.task_done_callback(
                                        future, pid, progress, item
                                    )
                                )
                            except Exception as e:
                                # 提交失败时，必须减少计数器，否则会导致死锁
                                with self.data_lock:
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
            self.error(f"{Localizer.get().log_task_fail}", e)
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
            if self.items_cache:
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

    def save_items_batch(self, items: list[Item]) -> None:
        """批量保存条目到数据库（即时写入，用于断点续译）"""
        ctx = StorageContext.get()
        if not ctx.is_loaded():
            return

        db = ctx.get_db()
        if db is None:
            return

        # 逐条更新（只更新已翻译的条目，不是全量替换）
        for item in items:
            db.update_item(item.to_dict())

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
        if len(items) == 0:
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
        if len(items) == 0:
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
        if len(items) == 0 or not self.config.mtool_optimizer_enable:
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
        if len(items) == 0 or not self.config.mtool_optimizer_enable:
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
                for new_queue_item in new_tasks:
                    self.task_queue.put(new_queue_item)
            else:
                # 全量成功的路径
                pass

            # 即时写入已翻译或标记错误的条目到数据库（支持断点续译）
            finalized_items = [
                item
                for item in task.items
                if item.get_status()
                in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR)
            ]
            if finalized_items:
                self.save_items_batch(finalized_items)

            # 统计本次完成的行数
            processed_count = len(
                [
                    i
                    for i in task.items
                    if i.get_status() == Base.ProjectStatus.PROCESSED
                ]
            )
            error_count = len(
                [i for i in task.items if i.get_status() == Base.ProjectStatus.ERROR]
            )

            # 记录数据
            with self.data_lock:
                new = self.extras.copy()
                new["processed_line"] = (
                    self.extras.get("processed_line", 0) + processed_count
                )
                new["error_line"] = self.extras.get("error_line", 0) + error_count
                new["line"] = new["processed_line"] + new["error_line"]

                new["total_tokens"] = (
                    self.extras.get("total_tokens", 0)
                    + result.get("input_tokens", 0)
                    + result.get("output_tokens", 0)
                )
                new["total_input_tokens"] = self.extras.get(
                    "total_input_tokens", 0
                ) + result.get("input_tokens", 0)
                new["total_output_tokens"] = self.extras.get(
                    "total_output_tokens", 0
                ) + result.get("output_tokens", 0)
                new["time"] = time.time() - self.extras.get("start_time", 0)
                self.extras = new

            # 保存翻译进度额外数据到数据库（确保进度实时同步）
            if StorageContext.get().is_loaded():
                StorageContext.get().set_translation_extras(self.extras)
                # 同步更新项目状态为进行中，防止异常退出导致状态丢失
                StorageContext.get().set_project_status(Base.ProjectStatus.PROCESSING)

            # 进度更新由 UI 层的 update_ui_tick 自动处理，此处移除冗余调用以保持逻辑一致

            # 触发翻译进度更新事件
            self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)

        except concurrent.futures.CancelledError:
            # 任务取消是正常流程，无需记录错误
            pass
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
        finally:
            with self.data_lock:
                self.active_task_count -= 1
