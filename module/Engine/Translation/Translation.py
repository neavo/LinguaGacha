import os
import threading
import time
import webbrowser
from enum import StrEnum
from itertools import zip_longest
from typing import Any

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskPipeline import TaskPipeline
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot
from module.Engine.TaskRunnerLifecycle import TaskRunnerExecutionPlan
from module.Engine.TaskRunnerLifecycle import TaskRunnerHooks
from module.Engine.TaskRunnerLifecycle import TaskRunnerLifecycle
from module.Engine.Translation.TranslationProgressTracker import (
    TranslationProgressTracker,
)
from module.Engine.Translation.TranslationScheduler import TranslationScheduler
from module.Engine.Translation.TranslationTaskHooks import TranslationTaskHooks
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


# 翻译器
class Translation(Base):
    class ExportSource(StrEnum):
        MANUAL = "MANUAL"
        AUTO_ON_FINISH = "AUTO_ON_FINISH"

    def __init__(self) -> None:
        super().__init__()

        # 翻译过程中的 items 内存快照（仅用于本次任务，避免频繁读写数据库）
        self.items_cache: list[Item] | None = None

        # 翻译进度额外数据
        self.extras: dict[str, Any] = {}

        # 当前翻译任务的限流器（用于 UI 展示真实并发）
        self.task_limiter: TaskLimiter | None = None

        # 停止请求标记（用于避免手动停止后自动生成译文）
        self.stop_requested: bool = False

        # 配置
        self.config = Config().load()
        self.dm: DataManager = DataManager.get()

        # 翻译期间使用的质量规则快照（开始/继续时捕获）
        self.quality_snapshot: QualityRuleSnapshot | None = None

        self.scheduler: TranslationScheduler | None = None
        self.progress_tracker = TranslationProgressTracker(self)

        # 注册事件
        self.subscribe(Base.Event.PROJECT_CHECK, self.project_check_run)
        self.subscribe(Base.Event.TRANSLATION_TASK, self.translation_run_event)
        self.subscribe(Base.Event.TRANSLATION_REQUEST_STOP, self.translation_stop_event)
        self.subscribe(Base.Event.TRANSLATION_EXPORT, self.translation_export)

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

    def should_stop(self) -> bool:
        """翻译停止判断统一收口，避免 hooks 和控制器口径漂移。"""
        return (
            Engine.get().get_status() == Base.TaskStatus.STOPPING or self.stop_requested
        )

    def get_progress_snapshot(self) -> TaskProgressSnapshot:
        """把翻译运行态字典统一映射到共享快照，便于公共层复用。"""
        return self.progress_tracker.get_progress_snapshot()

    def set_progress_snapshot(self, snapshot: TaskProgressSnapshot) -> dict[str, Any]:
        """翻译域内部统一经由快照对象回写字典，避免字段漏同步。"""
        return self.progress_tracker.set_progress_snapshot(snapshot)

    def update_extras_snapshot(
        self,
        *,
        processed_count: int,
        error_count: int,
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, Any]:
        """更新翻译进度统计并返回不可变快照。"""
        return self.progress_tracker.update_extras_snapshot(
            processed_count=processed_count,
            error_count=error_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    def sync_extras_line_stats(self) -> None:
        """以 items_cache 为权威来源，重算行数统计。

        在高并发 + 动态拆分/重试的情况下，增量计数可能出现极小漂移；
        最终以实际 Item 状态回填，保证 UI/元数据一致。
        """
        self.progress_tracker.sync_extras_line_stats()

    def build_project_check_payload(self, dm: DataManager) -> dict[str, Any]:
        """统一收敛工程检查返回值，避免线程任务里重复拼装字典。"""
        if not dm.is_loaded():
            return {
                "status": Base.ProjectStatus.NONE,
                "extras": {},
                "analysis_extras": {},
                "analysis_candidate_count": 0,
            }

        return {
            "status": dm.get_project_status(),
            "extras": dm.get_translation_extras(),
            "analysis_extras": dm.get_analysis_extras(),
            "analysis_candidate_count": int(dm.get_analysis_candidate_count()),
        }

    # 翻译状态检查事件
    def project_check_run(self, event: Base.Event, data: dict) -> None:
        del event
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        def task() -> None:
            dm = DataManager.get()
            payload = self.build_project_check_payload(dm)

            self.emit(
                Base.Event.PROJECT_CHECK,
                {
                    "sub_event": Base.SubEvent.DONE,
                    **payload,
                },
            )

        threading.Thread(target=task).start()

    # 翻译启动生命周期事件
    def translation_run_event(self, event: Base.Event, data: dict) -> None:
        del event
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        self.translation_run(data)

    # 翻译停止生命周期事件
    def translation_stop_event(self, event: Base.Event, data: dict) -> None:
        del event
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        self.translation_require_stop(data)

    # 翻译开始事件
    def translation_run(self, data: dict) -> None:
        self.stop_requested = False
        mode = data.get("mode", Base.TranslationMode.NEW)
        if not isinstance(mode, Base.TranslationMode):
            mode = Base.TranslationMode.NEW

        TaskRunnerLifecycle.start_background_run(
            self,
            busy_status=Base.TaskStatus.TRANSLATING,
            task_event=Base.Event.TRANSLATION_TASK,
            mode=mode,
            worker=lambda: self.start(data),
            thread_factory=threading.Thread,
        )

    # 翻译停止事件
    def translation_require_stop(self, data: dict) -> None:
        del data
        TaskRunnerLifecycle.request_stop(
            self,
            stop_event=Base.Event.TRANSLATION_REQUEST_STOP,
            mark_stop_requested=lambda: setattr(self, "stop_requested", True),
        )
        # 同步流式下 stop 依赖底层 SDK/HTTP 超时收尾，响应可能有延迟；后续可优化为可中断 IO。

    # 翻译结果手动导出事件
    def should_use_runtime_export_items(self, source: ExportSource) -> bool:
        """判断当前导出是否应该优先信任翻译运行态快照。"""
        if self.items_cache is None:
            return False
        elif source == self.ExportSource.AUTO_ON_FINISH:
            return True
        elif source == self.ExportSource.MANUAL:
            # 手动导出只在翻译仍进行中时信任运行态快照；
            # 引擎空闲后应回到工程事实，避免替换文件后的旧快照覆盖新数据。
            engine_status = Engine.get().get_status()
            return engine_status in (
                Base.TaskStatus.TRANSLATING,
                Base.TaskStatus.STOPPING,
            )
        else:
            return False

    def resolve_export_items(
        self,
        source: ExportSource = ExportSource.MANUAL,
    ) -> list[Item]:
        """统一导出数据来源，默认按手动导出口径兼容历史无参调用。"""
        if self.should_use_runtime_export_items(source):
            return self.copy_items()
        else:
            dm = DataManager.get()
            if not dm.is_loaded():
                return []
            else:
                return dm.get_all_items()

    def run_translation_export(
        self,
        *,
        source: ExportSource,
        apply_mtool_postprocess: bool = True,
    ) -> None:
        """统一执行译文导出流程，避免手动/自动链路的交互与日志分叉。"""
        source_value = str(source.value)
        try:
            LogManager.get().info(Localizer.get().export_translation_start)
            self.emit(
                Base.Event.TRANSLATION_EXPORT,
                {
                    "sub_event": Base.SubEvent.RUN,
                    "source": source_value,
                    "message": Localizer.get().export_translation_start,
                },
            )

            items = self.resolve_export_items(source)
            if not items:
                self.emit(
                    Base.Event.TRANSLATION_EXPORT,
                    {
                        "sub_event": Base.SubEvent.DONE,
                        "source": source_value,
                        "empty": True,
                    },
                )
                return

            # 自动导出在翻译收尾阶段已对 items_cache 执行过后处理，此处避免重复追加拆分行。
            if apply_mtool_postprocess:
                self.mtool_optimizer_postprocess(items)
            output_path = self.check_and_wirte_result(items)
            self.emit(
                Base.Event.TRANSLATION_EXPORT,
                {
                    "sub_event": Base.SubEvent.DONE,
                    "source": source_value,
                    "output_path": output_path,
                    "message": Localizer.get().export_translation_success,
                },
            )
        except Exception as e:
            LogManager.get().error(Localizer.get().export_translation_failed, e)
            self.emit(
                Base.Event.TRANSLATION_EXPORT,
                {
                    "sub_event": Base.SubEvent.ERROR,
                    "source": source_value,
                    "message": Localizer.get().export_translation_failed,
                },
            )

    def translation_export(self, event: Base.Event, data: dict) -> None:
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        if Engine.get().get_status() == Base.TaskStatus.STOPPING:
            return

        del event
        del data

        def start_export() -> None:
            self.run_translation_export(source=self.ExportSource.MANUAL)

        threading.Thread(target=start_export).start()

    # 实际的翻译流程
    def start(self, data: dict) -> None:
        dm = DataManager.get()
        self.dm = dm
        run_state: dict[str, Any] = {
            "mode": Base.TranslationMode.NEW,
        }

        def prepare() -> bool:
            config: Config | None = data.get("config")
            mode_raw = data.get("mode")
            mode = (
                mode_raw
                if isinstance(mode_raw, Base.TranslationMode)
                else Base.TranslationMode.NEW
            )
            run_state["mode"] = mode

            self.config = config if isinstance(config, Config) else Config().load()
            if not TaskRunnerLifecycle.ensure_project_loaded(
                self,
                dm=dm,
                task_event=Base.Event.TRANSLATION_TASK,
            ):
                return False

            dm.open_db()
            self.model = TaskRunnerLifecycle.resolve_active_model(
                self,
                config=self.config,
                task_event=Base.Event.TRANSLATION_TASK,
            )
            if self.model is None:
                return False

            snapshot_override = data.get("quality_snapshot")
            self.quality_snapshot = (
                snapshot_override
                if isinstance(snapshot_override, QualityRuleSnapshot)
                else QualityRuleSnapshot.capture()
            )

            TaskRunnerLifecycle.reset_request_runtime(reset_text_processor=True)
            self.items_cache = dm.get_items_for_translation(self.config, mode)
            return True

        def build_plan() -> TaskRunnerExecutionPlan:
            mode: Base.TranslationMode = run_state["mode"]
            if self.items_cache is None:
                self.items_cache = []

            snapshot = self.progress_tracker.build_plan_snapshot(
                continue_mode=mode == Base.TranslationMode.CONTINUE
            )
            self.set_progress_snapshot(snapshot)
            self.emit(Base.Event.TRANSLATION_PROGRESS, self.extras)
            self.scheduler = TranslationScheduler(
                self.config,
                self.model,
                self.items_cache,
                quality_snapshot=self.quality_snapshot,
            )

            remaining_count = self.get_item_count_by_status(Base.ProjectStatus.NONE)
            snapshot = self.get_progress_snapshot().with_counts(
                total_line=self.get_progress_snapshot().line + remaining_count
            )
            self.set_progress_snapshot(snapshot)
            return TaskRunnerExecutionPlan(
                total_line=int(snapshot.total_line),
                line=int(snapshot.line),
                has_pending_work=remaining_count > 0,
                idle_final_status="SUCCESS",
            )

        def bind_task_limiter(
            max_workers: int,
            rps_limit: int,
            rpm_threshold: int,
        ) -> None:
            self.task_limiter = TaskLimiter(
                rps=rps_limit,
                rpm=rpm_threshold,
                max_concurrency=max_workers,
            )

        def execute(plan: TaskRunnerExecutionPlan, max_workers: int) -> str:
            del plan
            task_limiter = self.task_limiter
            if task_limiter is None:
                return "FAILED"

            self.start_translation_pipeline(
                task_limiter=task_limiter,
                max_workers=max_workers,
            )

            self.sync_extras_line_stats()
            self.emit(Base.Event.TRANSLATION_PROGRESS, dict(self.extras))
            if self.get_item_count_by_status(Base.ProjectStatus.NONE) == 0:
                return "SUCCESS"
            if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                return "STOPPED"
            return "FAILED"

        TaskRunnerLifecycle.run_task_flow(
            self,
            task_event=Base.Event.TRANSLATION_TASK,
            hooks=TaskRunnerHooks(
                prepare=prepare,
                build_plan=build_plan,
                persist_progress=self.progress_tracker.persist_progress_snapshot,
                get_model=lambda: self.model if isinstance(self.model, dict) else None,
                bind_task_limiter=bind_task_limiter,
                clear_task_limiter=lambda: setattr(self, "task_limiter", None),
                on_before_execute=self.log_translation_start,
                execute=execute,
                on_after_execute=self.log_translation_finish,
                finalize=self.finalize_translation_run,
                cleanup=self.cleanup_translation_run,
                after_done=lambda final_status: None,
            ),
        )

    def log_translation_start(self) -> None:
        """启动日志单独收口，方便共享骨架在开始阶段统一调用。"""

        if self.model is None:
            return

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

    def log_translation_finish(self, final_status: str) -> None:
        """终态日志和公共 Toast 分离，避免共享层和领域层互相覆盖。"""

        LogManager.get().print("")
        if final_status == "SUCCESS":
            LogManager.get().info(Localizer.get().engine_task_done)
        elif final_status == "STOPPED":
            LogManager.get().info(Localizer.get().engine_task_stop)
        else:
            LogManager.get().warning(Localizer.get().engine_task_fail)
        LogManager.get().print("")

    def update_pipeline_progress(self, extras_snapshot: dict[str, Any]) -> None:
        """提交阶段统一从这里发出翻译进度事件。"""
        self.progress_tracker.update_pipeline_progress(extras_snapshot)

    def finalize_translation_run(self, final_status: str) -> None:
        """共享骨架只负责调度，翻译域自己的落库和导出留在这里。"""

        del final_status
        time.sleep(1.0)

        if self.items_cache:
            self.mtool_optimizer_postprocess(self.items_cache)

        final_project_status = (
            Base.ProjectStatus.PROCESSED
            if self.get_item_count_by_status(Base.ProjectStatus.NONE) == 0
            else Base.ProjectStatus.PROCESSING
        )
        self.save_translation_state(final_project_status)

        if (
            self.items_cache
            and not self.stop_requested
            and Engine.get().get_status() != Base.TaskStatus.STOPPING
        ):
            self.run_translation_export(
                source=self.ExportSource.AUTO_ON_FINISH,
                apply_mtool_postprocess=False,
            )

    def cleanup_translation_run(self) -> None:
        """无论任务是否真正落地，都要把翻译期资源安全回收。"""

        self.close_db_connection()
        self.items_cache = None

    def get_item_count_by_status(self, status: Base.ProjectStatus) -> int:
        """按状态统计任务内存快照中的条目数量。"""
        if self.items_cache is None:
            return 0
        return sum(1 for item in self.items_cache if item.get_status() == status)

    def copy_items(self) -> list[Item]:
        """深拷贝任务内存快照中的条目列表。"""
        if self.items_cache is None:
            return []
        return [Item.from_dict(item.to_dict()) for item in self.items_cache]

    def close_db_connection(self) -> None:
        """关闭数据库长连接（翻译结束时调用，触发 WAL checkpoint）"""
        DataManager.get().close_db()

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

    def get_task_buffer_size(self, max_workers: int) -> int:
        # 缓冲区用于控制“已创建但未执行”的任务数量，避免一次性创建海量任务对象。
        return max(64, min(4096, max_workers * 4))

    def apply_batch_update_sync(
        self,
        finalized_items: list[dict[str, Any]],
        extras_snapshot: dict[str, Any],
    ) -> None:
        """
        同步执行批量更新（在翻译后台线程中串行落库）。

        为什么串行：翻译提交需要把落库、缓存更新和局部刷新收口成同一条数据层入口。
        """
        DataManager.get().apply_translation_batch_update(
            finalized_items,
            extras_snapshot,
        )

    def start_translation_pipeline(
        self,
        *,
        task_limiter: TaskLimiter,
        max_workers: int,
    ) -> None:
        """
        同步翻译调度入口。

        具体的生产者/消费者/提交逻辑封装在通用 TaskPipeline + TranslationTaskHooks 中。
        """
        del task_limiter
        hooks = TranslationTaskHooks(
            translation=self,
            max_workers=max_workers,
        )
        normal_queue_size, high_queue_size, commit_queue_size = (
            hooks.build_pipeline_sizes()
        )
        TaskPipeline(
            hooks=hooks,
            max_workers=max_workers,
            normal_queue_size=normal_queue_size,
            high_queue_size=high_queue_size,
            commit_queue_size=commit_queue_size,
        ).run()

    # MTool 优化器后处理
    def mtool_optimizer_postprocess(self, items: list[Item]) -> None:
        if items is None or len(items) == 0 or not self.config.mtool_optimizer_enable:
            return None

        # 筛选
        LogManager.get().print("")
        items_kvjson: list[Item] = []
        for item in items:
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
        LogManager.get().info(Localizer.get().translation_mtool_optimizer_post_log)

    # 检查结果并写入文件
    def check_and_wirte_result(self, items: list[Item]) -> str:
        # 写入文件并获取实际输出路径（带时间戳）
        output_path = FileManager(self.config).write_to_path(items)
        LogManager.get().print("")

        LogManager.get().info(
            Localizer.get().export_translation_done.replace("{PATH}", output_path)
        )
        LogManager.get().print("")

        # 打开输出文件夹
        if self.config.output_folder_open_on_finish:
            webbrowser.open(os.path.abspath(output_path))
        return output_path
