import os
import threading
import time
import webbrowser
from enum import StrEnum
from itertools import zip_longest
from typing import Any
from typing import Optional

from rich.progress import TaskID

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskRunnerLifecycle import TaskRunnerExecutionPlan
from module.Engine.TaskRunnerLifecycle import TaskRunnerHooks
from module.Engine.TaskRunnerLifecycle import TaskRunnerLifecycle
from module.Engine.TaskScheduler import TaskScheduler
from module.Engine.Translation.TranslationTaskPipeline import TranslationTaskPipeline
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar
from module.PromptBuilder import PromptBuilder
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor


# 翻译器
class Translation(Base):
    class ExportSource(StrEnum):
        MANUAL = "MANUAL"
        AUTO_ON_FINISH = "AUTO_ON_FINISH"

    def __init__(self) -> None:
        super().__init__()

        # 翻译过程中的 items 内存快照（仅用于本次任务，避免频繁读写数据库）
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
        self.subscribe(Base.Event.PROJECT_CHECK, self.project_check_run)
        self.subscribe(Base.Event.TRANSLATION_TASK, self.translation_run_event)
        self.subscribe(Base.Event.TRANSLATION_REQUEST_STOP, self.translation_stop_event)
        self.subscribe(Base.Event.TRANSLATION_EXPORT, self.translation_export)
        self.subscribe(Base.Event.TRANSLATION_RESET_ALL, self.translation_reset)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED,
            self.translation_reset,
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

    def build_project_check_payload(self, dm: DataManager) -> dict[str, Any]:
        """统一收敛工程检查返回值，避免线程任务里重复拼装字典。"""
        if not dm.is_loaded():
            return {
                "status": Base.ProjectStatus.NONE,
                "extras": {},
                "analysis_extras": {},
                "analysis_candidate_count": 0,
            }

        analysis_candidate_count = int(dm.get_analysis_candidate_count())
        analysis_extras = dm.get_analysis_progress_snapshot()

        payload = {
            "status": dm.get_project_status(),
            "extras": dm.get_translation_extras(),
            "analysis_extras": analysis_extras,
            "analysis_candidate_count": analysis_candidate_count,
        }
        return payload

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

    # 翻译重置事件
    def translation_reset(self, event: Base.Event, data: dict) -> None:
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        reset_event: Base.Event
        is_reset_all = event == Base.Event.TRANSLATION_RESET_ALL
        if is_reset_all:
            reset_event = Base.Event.TRANSLATION_RESET_ALL
        else:
            reset_event = Base.Event.TRANSLATION_RESET_FAILED

        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            self.emit(
                reset_event,
                {
                    "sub_event": Base.SubEvent.ERROR,
                },
            )
            return

        dm = DataManager.get()
        if not dm.is_loaded():
            return

        self.emit(
            reset_event,
            {
                "sub_event": Base.SubEvent.RUN,
            },
        )

        # 先给用户即时反馈：重置可能非常耗时（尤其是强制重解析资产时）
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().translation_page_toast_resetting,
                "indeterminate": True,
            },
        )

        def task() -> None:
            try:
                if is_reset_all:
                    # 1. 重新解析 assets 以获取初始状态的条目
                    # 这里必须使用 RESET 模式强制重解析 assets（避免沿用工程数据库里的既有条目/进度）
                    items = dm.get_items_for_translation(
                        self.config, Base.TranslationMode.RESET
                    )

                    # 2. 清空并重新写入条目到数据库
                    dm.replace_all_items(items)

                    # 3. 清除元数据中的进度信息
                    dm.set_translation_extras({})

                    # 4. 设置项目状态为 NONE
                    dm.set_project_status(Base.ProjectStatus.NONE)

                    # 5. 更新本地进度快照
                    self.extras = dm.get_translation_extras()

                    # 6. 预过滤重算并落库（已移除翻译期过滤，reset 后必须补上）
                    dm.run_project_prefilter(self.config, reason="translation_reset")
                else:
                    extras = dm.reset_failed_translation_items_sync()
                    if extras is not None:
                        self.extras = extras

                # 触发状态检查以同步 UI
                self.emit(
                    Base.Event.PROJECT_CHECK,
                    {"sub_event": Base.SubEvent.REQUEST},
                )
                self.emit(
                    reset_event,
                    {
                        "sub_event": Base.SubEvent.DONE,
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
                self.emit(
                    reset_event,
                    {
                        "sub_event": Base.SubEvent.ERROR,
                    },
                )
            finally:
                self.emit(
                    Base.Event.PROGRESS_TOAST,
                    {"sub_event": Base.SubEvent.DONE},
                )

        threading.Thread(target=task).start()

    # 翻译结果手动导出事件

    def should_emit_export_result_toast(self, source: ExportSource) -> bool:
        """根据导出来源决定是否展示导出结果提示。"""
        if source == self.ExportSource.MANUAL:
            return True
        else:
            return False

    def resolve_export_items(self) -> list[Item]:
        """统一导出数据来源，确保手动/自动导出读取口径一致。"""
        if self.items_cache is not None:
            # 手动导出可能发生在翻译过程中，使用内存快照保证实时性。
            return self.copy_items()

        dm = DataManager.get()
        if not dm.is_loaded():
            return []
        return dm.get_all_items()

    def run_translation_export(
        self,
        *,
        source: ExportSource,
        apply_mtool_postprocess: bool = True,
    ) -> None:
        """统一执行译文导出流程，避免手动/自动链路的交互与日志分叉。"""
        emit_result_toast = self.should_emit_export_result_toast(source)
        progress_toast_active = False
        try:
            LogManager.get().info(Localizer.get().export_translation_start)
            self.emit(
                Base.Event.PROGRESS_TOAST,
                {
                    "sub_event": Base.SubEvent.RUN,
                    "message": Localizer.get().export_translation_start,
                    "indeterminate": True,
                },
            )
            progress_toast_active = True

            items = self.resolve_export_items()
            if not items:
                return

            # 自动导出在翻译收尾阶段已对 items_cache 执行过后处理，此处避免重复追加拆分行。
            if apply_mtool_postprocess:
                self.mtool_optimizer_postprocess(items)
            self.check_and_wirte_result(items)

            if emit_result_toast:
                self.emit(
                    Base.Event.PROGRESS_TOAST,
                    {"sub_event": Base.SubEvent.DONE},
                )
                progress_toast_active = False
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().export_translation_success,
                    },
                )
        except Exception as e:
            LogManager.get().error(Localizer.get().export_translation_failed, e)
            if emit_result_toast and progress_toast_active:
                self.emit(
                    Base.Event.PROGRESS_TOAST,
                    {"sub_event": Base.SubEvent.DONE},
                )
                progress_toast_active = False
            if emit_result_toast:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().export_translation_failed,
                    },
                )
        finally:
            if progress_toast_active:
                self.emit(
                    Base.Event.PROGRESS_TOAST,
                    {"sub_event": Base.SubEvent.DONE},
                )

    def translation_export(self, event: Base.Event, data: dict) -> None:
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
            if not TaskRunnerLifecycle.ensure_project_loaded(self, dm=dm):
                return False

            dm.open_db()
            self.model = TaskRunnerLifecycle.resolve_active_model(
                self,
                config=self.config,
            )
            if self.model is None:
                return False

            self.persist_quality_rules = bool(data.get("persist_quality_rules", True))
            snapshot_override = data.get("quality_snapshot")
            self.quality_snapshot = (
                snapshot_override
                if isinstance(snapshot_override, QualityRuleSnapshot)
                else QualityRuleSnapshot.capture()
            )

            TextProcessor.reset()
            TaskRequester.reset()
            PromptBuilder.reset()
            self.items_cache = dm.get_items_for_translation(self.config, mode)
            return True

        def build_plan() -> TaskRunnerExecutionPlan:
            mode: Base.TranslationMode = run_state["mode"]
            if self.items_cache is None:
                self.items_cache = []

            if mode == Base.TranslationMode.CONTINUE:
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

            self.emit(Base.Event.TRANSLATION_PROGRESS, self.extras)
            self.scheduler = TaskScheduler(
                self.config,
                self.model,
                self.items_cache,
                quality_snapshot=self.quality_snapshot,
            )

            remaining_count = self.get_item_count_by_status(Base.ProjectStatus.NONE)
            self.extras["total_line"] = self.extras.get("line", 0) + remaining_count
            return TaskRunnerExecutionPlan(
                total_line=int(self.extras.get("total_line", 0) or 0),
                line=int(self.extras.get("line", 0) or 0),
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

            with ProgressBar(transient=True) as progress:
                pid = progress.new(
                    total=int(self.extras.get("total_line", 0) or 0),
                    completed=int(self.extras.get("line", 0) or 0),
                )
                self.start_translation_pipeline(
                    progress=progress,
                    pid=pid,
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
                persist_progress=self.persist_translation_progress,
                get_model=lambda: self.model if isinstance(self.model, dict) else None,
                bind_task_limiter=bind_task_limiter,
                clear_task_limiter=lambda: setattr(self, "task_limiter", None),
                on_before_execute=self.log_translation_start,
                execute=execute,
                on_after_execute=self.log_translation_finish,
                terminal_toast=self.emit_translation_terminal_toast,
                finalize=self.finalize_translation_run,
                after_done=lambda final_status: None,
            ),
        )

    def persist_translation_progress(self, save_state: bool) -> dict[str, Any]:
        """共享骨架需要统一入口回写翻译快照，避免起止阶段各写一套。"""

        if save_state and self.items_cache is not None:
            self.save_translation_state(Base.ProjectStatus.PROCESSING)
        return dict(self.extras)

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

    def emit_translation_terminal_toast(self, final_status: str) -> None:
        """翻译终态提示仍走共享口径，但保留领域侧可替换入口。"""

        TaskRunnerLifecycle.emit_terminal_toast(self, final_status=final_status)

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
        self.close_db_connection()

        if (
            self.items_cache
            and not self.stop_requested
            and Engine.get().get_status() != Base.TaskStatus.STOPPING
        ):
            self.run_translation_export(
                source=self.ExportSource.AUTO_ON_FINISH,
                apply_mtool_postprocess=False,
            )

        self.items_cache = None

    # ========== 辅助方法 ==========

    def get_item_count_by_status(self, status: Base.ProjectStatus) -> int:
        """按状态统计任务内存快照中的条目数量。"""
        if self.items_cache is None:
            return 0
        return len([item for item in self.items_cache if item.get_status() == status])

    def copy_items(self) -> list[Item]:
        """深拷贝任务内存快照中的条目列表。"""
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

        # 快照用于运行时质量检查/提示词一致性；写回入口的去重/补空由统一合并器负责。
        snapshot.merge_glossary_entries(incoming)

        # CLI 模式可禁用规则写回：保留本次快照的增量效果，但不触碰工程缓存/落库。
        if not persist:
            return None

        dm = DataManager.get()
        # 与 UI 写入串行化：避免 auto glossary 覆盖用户在翻译过程中的手动编辑。
        with dm.state_lock:
            merged, _report = dm.merge_glossary_incoming(
                incoming,
                merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
                save=False,
            )
            return merged

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
        model = self.model if hasattr(self, "model") else None
        return TaskRunnerLifecycle.build_task_limits(model)

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

        具体的生产者/消费者/提交逻辑封装在 TranslationTaskPipeline 中，避免本方法过长。
        """
        pipeline = TranslationTaskPipeline(
            translation=self,
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
        LogManager.get().info(Localizer.get().translation_mtool_optimizer_post_log)

    # 检查结果并写入文件
    def check_and_wirte_result(self, items: list[Item]) -> None:
        # 自动术语表更新事件仅受自动术语表开关控制。
        if self.config.auto_glossary_enable and self.persist_quality_rules:
            # 更新规则管理器 (已在 TranslationTask.merge_glossary 中即时处理，此处仅作为冗余检查或保留事件触发)

            # 实际上 TranslationTask 已经处理了保存，这里只需要触发事件即可
            self.emit(
                Base.Event.QUALITY_RULE_UPDATE,
                {"rule_types": [DataManager.RuleType.GLOSSARY.value]},
            )

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
