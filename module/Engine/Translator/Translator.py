import os
import threading
import time
import webbrowser
from itertools import zip_longest
from typing import Any
from typing import Optional

from rich.progress import TaskID

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.QualityRuleSnapshot import QualityRuleSnapshot
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskScheduler import TaskScheduler
from module.Engine.Translator.TranslatorTaskPipeline import TranslatorTaskPipeline
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar
from module.PromptBuilder import PromptBuilder
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

        # 当前翻译任务的限流器（用于 UI 展示真实并发）
        self.task_limiter: TaskLimiter | None = None

        # 停止请求标记（用于避免手动停止后自动生成译文）
        self.stop_requested: bool = False

        # 配置
        self.config = Config().load()

        # 翻译期间使用的质量规则快照（开始/继续时捕获）
        self.quality_snapshot: QualityRuleSnapshot | None = None

        # 是否允许把质量规则写回工程（GUI 为 True；CLI 可传 False 仅本次生效）。
        self.persist_quality_rules: bool = True

        # 注册事件
        self.subscribe(Base.Event.PROJECT_CHECK_RUN, self.project_check_run)
        self.subscribe(Base.Event.TRANSLATION_RUN, self.translation_run)
        self.subscribe(Base.Event.TRANSLATION_EXPORT, self.translation_export)
        self.subscribe(Base.Event.TRANSLATION_RESET, self.translation_reset)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED, self.translation_reset_failed
        )
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.translation_require_stop
        )

    def get_concurrency_in_use(self) -> int:
        limiter = self.task_limiter
        if limiter is None:
            return 0
        return limiter.get_concurrency_in_use()

    def get_concurrency_limit(self) -> int:
        limiter = self.task_limiter
        if limiter is None:
            return 0
        return limiter.get_concurrency_limit()

    def update_extras_snapshot(
        self,
        *,
        processed_count: int,
        error_count: int,
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, Any]:
        """更新翻译进度统计并返回不可变快照。"""
        self.extras.update(
            {
                "processed_line": self.extras.get("processed_line", 0)
                + processed_count,
                "error_line": self.extras.get("error_line", 0) + error_count,
                "total_tokens": self.extras.get("total_tokens", 0)
                + input_tokens
                + output_tokens,
                "total_input_tokens": self.extras.get("total_input_tokens", 0)
                + input_tokens,
                "total_output_tokens": self.extras.get("total_output_tokens", 0)
                + output_tokens,
                "time": time.time() - self.extras.get("start_time", 0),
            }
        )
        self.extras["line"] = self.extras["processed_line"] + self.extras["error_line"]
        return dict(self.extras)

    def sync_extras_line_stats(self) -> None:
        """以 items_cache 为权威来源，重算行数统计。

        在高并发 + 动态拆分/重试的情况下，增量计数可能出现极小漂移；
        最终以实际 Item 状态回填，保证 UI/元数据一致。
        """
        if self.items_cache is None:
            return

        processed_line = 0
        error_line = 0
        remaining_line = 0
        for item in self.items_cache:
            status = item.get_status()
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
            elif status == Base.ProjectStatus.ERROR:
                error_line += 1
            elif status == Base.ProjectStatus.NONE:
                remaining_line += 1

        self.extras["processed_line"] = processed_line
        self.extras["error_line"] = error_line
        self.extras["line"] = processed_line + error_line
        self.extras["total_line"] = self.extras["line"] + remaining_line
        self.extras["time"] = time.time() - self.extras.get("start_time", 0)

    # 翻译状态检查事件
    def project_check_run(self, event: Base.Event, data: dict) -> None:
        def task(event_name: str, task_data: dict) -> None:
            dm = DataManager.get()
            extras = {}

            if dm.is_loaded():
                status = dm.get_project_status()
                extras = dm.get_translation_extras()
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
            engine.status = Base.TaskStatus.TRANSLATING

        self.stop_requested = False
        try:
            threading.Thread(
                target=self.start,
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

    # 翻译停止事件
    def translation_require_stop(self, event: Base.Event, data: dict) -> None:
        # 更新运行状态
        self.stop_requested = True
        Engine.get().set_status(Base.TaskStatus.STOPPING)
        # 同步流式下 stop 依赖底层 SDK/HTTP 超时收尾，响应可能有延迟；后续可优化为可中断 IO。

    # 翻译重置事件
    def translation_reset(self, event: Base.Event, data: dict) -> None:
        dm = DataManager.get()
        if not dm.is_loaded():
            return

        # 先给用户即时反馈：重置可能非常耗时（尤其是强制重解析资产时）
        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": Localizer.get().translation_page_toast_resetting,
                "indeterminate": True,
            },
        )

        def task() -> None:
            resetting_toast_active = True
            try:
                # 1. 重新解析资产以获取初始状态的条目
                # 这里必须使用 RESET 模式来强制重新解析，而不是读缓存
                items = dm.get_items_for_translation(
                    self.config, Base.TranslationMode.RESET
                )

                # 2. 清空并重新写入条目到数据库
                dm.replace_all_items(items)

                # 3. 清除元数据中的进度信息
                dm.set_translation_extras({})

                # 4. 设置项目状态为 NONE
                dm.set_project_status(Base.ProjectStatus.NONE)

                # 5. 更新本地缓存
                self.extras = dm.get_translation_extras()

                # 6. 预过滤重算并落库（已移除翻译期过滤，reset 后必须补上）
                dm.run_project_prefilter(self.config, reason="translation_reset")

                # 触发状态检查以同步 UI
                self.emit(Base.Event.PROJECT_CHECK_RUN, {})
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )
            finally:
                if resetting_toast_active:
                    self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})

        threading.Thread(target=task).start()

    def translation_reset_failed(self, event: Base.Event, data: dict) -> None:
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            return

        dm = DataManager.get()
        if not dm.is_loaded():
            return

        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": Localizer.get().translation_page_toast_resetting,
                "indeterminate": True,
            },
        )

        def task() -> None:
            try:
                extras = dm.reset_failed_items_sync()
                if extras is None:
                    return

                self.extras = extras

                self.emit(Base.Event.PROJECT_CHECK_RUN, {})
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )
            finally:
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})

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
                dm = DataManager.get()
                if not dm.is_loaded():
                    return
                items = dm.get_all_items()

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

            # 初始化
            self.config = config if isinstance(config, Config) else Config().load()

            # 检查工程是否已加载
            dm = DataManager.get()
            if not dm.is_loaded():
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().alert_project_not_loaded,
                    },
                )
                return None

            # 翻译期间打开长连接（提升高频写入性能，翻译结束后关闭以清理 WAL 文件）
            dm.open_db()

            # 从新模型系统获取激活模型
            self.model = self.config.get_active_model()
            if self.model is None:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().alert_no_active_model,
                    },
                )
                return None

            max_workers, rps_limit, rpm_threshold = self.initialize_task_limits()

            persist_quality_rules = data.get("persist_quality_rules", True)
            self.persist_quality_rules = bool(persist_quality_rules)

            snapshot_override = data.get("quality_snapshot")
            self.quality_snapshot = (
                snapshot_override
                if isinstance(snapshot_override, QualityRuleSnapshot)
                else QualityRuleSnapshot.capture()
            )

            # 重置
            TextProcessor.reset()
            TaskRequester.reset()
            PromptBuilder.reset()

            # 1. 获取数据 (交给文件管理器，翻译器不再关心是读缓存还是重解析)
            # 文件管理器会根据 mode 自动决定是从 DataStore 还是 Assets 加载
            self.items_cache = dm.get_items_for_translation(self.config, mode)

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
                self.extras = dm.get_translation_extras()
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

            # 3. 预过滤已在工程创建/配置变更/重置翻译阶段完成并落库。
            # 翻译开始阶段不再重复执行过滤，避免双跑与语义漂移。

            # 初始化任务调度器
            self.scheduler = TaskScheduler(
                self.config,
                self.model,
                self.items_cache,
                quality_snapshot=self.quality_snapshot,
            )

            # 更新任务的总行数
            remaining_count = self.get_item_count_by_status(Base.ProjectStatus.NONE)
            self.extras["total_line"] = self.extras.get("line", 0) + remaining_count

            # 输出开始翻译的日志
            LogManager.get().print("")
            LogManager.get().info(
                f"{Localizer.get().engine_api_name} - {self.model.get('name', '')}"
            )
            LogManager.get().info(
                f"{Localizer.get().api_url} - {self.model.get('api_url', '')}"
            )
            LogManager.get().info(
                f"{Localizer.get().engine_api_model} - {self.model.get('model_id', '')}"
            )
            LogManager.get().print("")
            if self.model.get("api_format") != Base.APIFormat.SAKURALLM:
                LogManager.get().info(
                    PromptBuilder(
                        self.config,
                        quality_snapshot=self.quality_snapshot,
                    ).build_main()
                )
                LogManager.get().print("")

            task_limiter = TaskLimiter(
                rps=rps_limit,
                rpm=rpm_threshold,
                max_concurrency=max_workers,
            )
            self.task_limiter = task_limiter

            with ProgressBar(transient=True) as progress:
                pid = progress.new(
                    total=self.extras.get("total_line", 0),
                    completed=self.extras.get("line", 0),
                )

                self.start_translation_pipeline(
                    progress=progress,
                    pid=pid,
                    task_limiter=task_limiter,
                    max_workers=max_workers,
                )

            # 任务结束后以最终状态回填行数统计，避免 UI 出现“少量剩余行数”但实际已完成。
            self.sync_extras_line_stats()
            self.emit(Base.Event.TRANSLATION_UPDATE, dict(self.extras))

            # 判断翻译是否完成
            if self.get_item_count_by_status(Base.ProjectStatus.NONE) == 0:
                # 日志
                LogManager.get().print("")
                LogManager.get().info(Localizer.get().engine_task_done)
                LogManager.get().info(Localizer.get().engine_task_save)
                LogManager.get().print("")

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
                LogManager.get().print("")
                if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                    LogManager.get().info(Localizer.get().engine_task_stop)
                else:
                    LogManager.get().warning(Localizer.get().engine_task_fail)
                LogManager.get().info(Localizer.get().engine_task_save)
                LogManager.get().print("")

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
            LogManager.get().error(Localizer.get().task_failed, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
        finally:
            # 等待最后的回调执行完毕
            time.sleep(1.0)

            # 清理限流器引用，避免 UI 读取到上一次任务的并发数据
            self.task_limiter = None

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
                and not self.stop_requested
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
        DataManager.get().close_db()

    def merge_glossary(
        self, glossary_list: list[dict[str, str]], *, persist: bool = True
    ) -> list[dict] | None:
        """
        合并术语表并更新缓存，返回待写入的数据（若无变化返回 None）
        """
        snapshot = self.quality_snapshot
        if snapshot is None:
            return None
        if not snapshot.glossary_enable:
            return None

        incoming: list[dict[str, Any]] = []
        for item in glossary_list:
            src = str(item.get("src", "")).strip()
            dst = str(item.get("dst", "")).strip()
            info = str(item.get("info", "")).strip()

            # 有效性校验
            if not any(x in info.lower() for x in ("男", "女", "male", "female")):
                continue

            # 将原文和译文都按标点切分
            srcs: list[str] = TextHelper.split_by_punctuation(src, split_by_space=True)
            dsts: list[str] = TextHelper.split_by_punctuation(dst, split_by_space=True)
            if len(srcs) != len(dsts):
                srcs = [src]
                dsts = [dst]

            for src_part, dst_part in zip(srcs, dsts):
                src_part = src_part.strip()
                dst_part = dst_part.strip()
                if not src_part or not dst_part:
                    continue
                if src_part == dst_part:
                    continue
                incoming.append(
                    {
                        "src": src_part,
                        "dst": dst_part,
                        "info": info,
                        "case_sensitive": False,
                    }
                )

        added_entries = snapshot.merge_glossary_entries(incoming)
        if not added_entries:
            return None

        # CLI 模式可禁用规则写回：保留本次快照的增量效果，但不触碰工程缓存/落库。
        if not persist:
            return None

        dm = DataManager.get()
        # 与 UI 写入串行化：避免 auto glossary 覆盖用户在翻译过程中的手动编辑。
        with dm.state_lock:
            current_data: list[dict] = dm.get_glossary()
            current_keys = {str(v.get("src", "")).strip() for v in current_data}

            changed = False
            for entry in added_entries:
                src = str(entry.get("src", "")).strip()
                if not src:
                    continue
                if src in current_keys:
                    continue
                current_data.append(dict(entry))
                current_keys.add(src)
                changed = True

            if not changed:
                return None

            # 仅更新内存缓存，实际写入由外层 update_batch 统一提交。
            dm.set_glossary(current_data, save=False)
            return current_data

    def save_translation_state(
        self, status: Base.ProjectStatus = Base.ProjectStatus.PROCESSING
    ) -> None:
        """保存翻译状态到 .lg 文件"""
        dm = DataManager.get()
        if not dm.is_loaded() or self.items_cache is None:
            return

        # 保存翻译进度额外数据（仅当存在时）
        if self.extras:
            dm.set_translation_extras(self.extras)

        # 设置项目状态
        dm.set_project_status(status)

    def initialize_task_limits(self) -> tuple[int, int, int]:
        """推导任务并发与速率上限。

        - `concurrency_limit=0` 表示自动：根据 rpm 估算。
        - 未配置 rpm 时，沿用旧行为：rps 默认为 concurrency，避免短时间突发。
        """
        if not hasattr(self, "model") or self.model is None:
            return 8, 8, 0

        threshold = self.model.get("threshold", {})
        max_concurrency = max(0, int(threshold.get("concurrency_limit", 0) or 0))
        rpm_limit = max(0, int(threshold.get("rpm_limit", 0) or 0))

        if max_concurrency == 0:
            if rpm_limit > 0:
                # 估算：假设平均请求耗时 ~250ms，取 4 倍 rps 作为并发冗余，并限制上限避免失控。
                derived = (rpm_limit * 4 + 59) // 60
                max_concurrency = max(8, min(64, derived))
            else:
                max_concurrency = 8

        rps_limit = 0 if rpm_limit > 0 else max_concurrency
        return max_concurrency, rps_limit, rpm_limit

    def get_task_buffer_size(self, max_workers: int) -> int:
        # 缓冲区用于控制“已创建但未执行”的任务数量，避免一次性创建海量任务对象。
        return max(64, min(4096, max_workers * 4))

    def apply_batch_update_sync(
        self,
        finalized_items: list[dict[str, Any]],
        glossaries: list[dict[str, str]],
        extras_snapshot: dict[str, Any],
    ) -> None:
        """
        同步执行批量更新（在翻译后台线程中串行落库）。

        为什么串行：DataManager.update_batch(...) 需要事务一致性，并且要保证缓存/事件顺序稳定。
        """
        new_glossary_data = None
        if glossaries and self.config.auto_glossary_enable:
            new_glossary_data = self.merge_glossary(
                glossaries, persist=self.persist_quality_rules
            )

        rules_map = (
            {DataManager.RuleType.GLOSSARY: new_glossary_data}
            if new_glossary_data
            else {}
        )
        DataManager.get().update_batch(
            items=finalized_items,
            rules=rules_map,
            meta={
                "translation_extras": extras_snapshot,
                "project_status": Base.ProjectStatus.PROCESSING,
            },
        )

    def start_translation_pipeline(
        self,
        *,
        progress: ProgressBar,
        pid: TaskID,
        task_limiter: TaskLimiter,
        max_workers: int,
    ) -> None:
        """
        同步翻译调度入口。

        具体的生产者/消费者/提交逻辑封装在 TranslatorTaskPipeline 中，避免本方法过长。
        """
        pipeline = TranslatorTaskPipeline(
            translator=self,
            progress=progress,
            pid=pid,
            task_limiter=task_limiter,
            max_workers=max_workers,
        )
        pipeline.run()

    # MTool 优化器后处理
    def mtool_optimizer_postprocess(self, items: list[Item]) -> None:
        if items is None or len(items) == 0 or not self.config.mtool_optimizer_enable:
            return None

        # 筛选
        LogManager.get().print("")
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
        LogManager.get().info(Localizer.get().translator_mtool_optimizer_post_log)

    # 检查结果并写入文件
    def check_and_wirte_result(self, items: list[Item]) -> None:
        # 启用自动术语表的时，更新配置文件
        snapshot = self.quality_snapshot
        glossary_enable = (
            snapshot.glossary_enable
            if snapshot is not None
            else DataManager.get().get_glossary_enable()
        )
        if (
            glossary_enable
            and self.config.auto_glossary_enable
            and self.persist_quality_rules
        ):
            # 更新规则管理器 (已在 TranslatorTask.merge_glossary 中即时处理，此处仅作为冗余检查或保留事件触发)

            # 实际上 TranslatorTask 已经处理了保存，这里只需要触发事件即可
            self.emit(
                Base.Event.QUALITY_RULE_UPDATE,
                {"rule_types": [DataManager.RuleType.GLOSSARY.value]},
            )

        # 写入文件并获取实际输出路径（带时间戳）
        output_path = FileManager(self.config).write_to_path(items)
        LogManager.get().print("")

        LogManager.get().info(
            Localizer.get().engine_task_save_done.replace("{PATH}", output_path)
        )
        LogManager.get().print("")

        # 打开输出文件夹
        if self.config.output_folder_open_on_finish:
            webbrowser.open(os.path.abspath(output_path))
