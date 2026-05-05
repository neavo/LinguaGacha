from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService,
)
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskPipeline import TaskPipeline
from module.Engine.TaskPipeline import TaskPipelineCommitResult
from module.Engine.TaskRunnerLifecycle import TaskRunnerExecutionPlan
from module.Engine.TaskRunnerLifecycle import TaskRunnerHooks
from module.Engine.TaskRunnerLifecycle import TaskRunnerLifecycle
from module.Engine.Translation.TranslationTask import TranslationTask
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


@dataclass(frozen=True)
class RetranslateCommitPayload:
    """重翻 worker 交给提交线程的最小载荷。"""

    item: Item
    result: dict[str, Any]


class RetranslateTaskHooks:
    """把重翻接到通用流水线。"""

    def __init__(self, task: "RetranslateTask") -> None:
        self.task = task

    def should_stop(self) -> bool:
        return self.task.should_stop()

    def get_producer_thread_name(self) -> str:
        return f"{Engine.TASK_PREFIX}RETRANSLATE_PRODUCER"

    def get_worker_thread_name_prefix(self) -> str:
        return f"{Engine.TASK_PREFIX}RETRANSLATE_WORKER"

    def iter_initial_contexts(self):
        return iter(self.task.items_cache)

    def run_context(self, item: Item) -> RetranslateCommitPayload | None:
        if self.should_stop():
            return None

        task_limiter = self.task.task_limiter
        if task_limiter is None:
            return None

        acquired = task_limiter.acquire(self.should_stop)
        if not acquired:
            return None

        try:
            waited = task_limiter.wait(self.should_stop)
            if not waited or self.should_stop():
                return None

            translation_task = TranslationTask(
                config=self.task.config,
                model=self.task.model,
                items=[item],
                precedings=[],
                skip_response_check=True,
                quality_snapshot=self.task.quality_snapshot,
            )
            result = translation_task.start()
            if int(result.get("row_count", 0) or 0) <= 0:
                item.set_status(Base.ItemStatus.ERROR)
            return RetranslateCommitPayload(item=item, result=result)
        finally:
            task_limiter.release()

    def handle_commit_payloads(
        self,
        payloads: tuple[RetranslateCommitPayload, ...],
    ) -> TaskPipelineCommitResult[Item]:
        self.task.commit_payloads(payloads)
        return TaskPipelineCommitResult()

    def on_producer_error(self, e: Exception) -> None:
        self.task.stop_after_error(e)

    def on_worker_error(self, context: Item, e: Exception) -> None:
        del context
        self.task.stop_after_error(e)

    def on_commit_error(
        self,
        payloads: tuple[RetranslateCommitPayload, ...],
        e: Exception,
    ) -> None:
        del payloads
        self.task.stop_after_error(e)

    def on_worker_loop_error(self, e: Exception) -> None:
        self.task.stop_after_error(e)


class RetranslateTask(Base):
    """批量重翻任务，每个 item 仍是独立单条翻译请求。"""

    RETRANSLATE_REASON: str = "retranslate_items"
    TASK_TYPE: str = "retranslate"
    VIEW_REVISION_SCOPE: str = "proofreading"

    def __init__(self) -> None:
        super().__init__()
        self.dm: DataManager = DataManager.get()
        self.config: Config = Config().load()
        self.model: dict[str, Any] | None = None
        self.items_cache: list[Item] = []
        self.task_limiter: TaskLimiter | None = None
        self.quality_snapshot: QualityRuleSnapshot | None = None
        self.revision_service = ProofreadingRevisionService(self.dm)
        self.runtime_service = ProjectRuntimeService(self.dm)
        self.subscribe(
            Base.Event.RETRANSLATE_TASK,
            self.retranslate_run_event,
        )

    def get_concurrency_in_use(self) -> int:
        limiter = self.task_limiter
        if limiter is None:
            return 0
        return limiter.get_concurrency_in_use()

    def should_stop(self) -> bool:
        return Engine.get().get_status() == Base.TaskStatus.STOPPING

    def retranslate_run_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> None:
        del event
        sub_event = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        item_ids = self.normalize_item_ids(data.get("item_ids", []))
        Engine.get().set_active_retranslate_item_ids(item_ids)
        TaskRunnerLifecycle.start_background_run(
            self,
            busy_status=Base.TaskStatus.RETRANSLATING,
            task_event=Base.Event.RETRANSLATE_TASK,
            mode=Base.TranslationMode.NEW,
            worker=lambda: self.start(data),
        )

    def start(self, data: dict[str, Any]) -> None:
        def prepare() -> bool:
            self.dm = DataManager.get()
            self.runtime_service = ProjectRuntimeService(self.dm)
            self.revision_service = ProofreadingRevisionService(self.dm)
            self.config = Config().load()

            if not TaskRunnerLifecycle.ensure_project_loaded(
                self,
                dm=self.dm,
                task_event=Base.Event.RETRANSLATE_TASK,
            ):
                return False

            self.dm.open_db()
            self.model = TaskRunnerLifecycle.resolve_active_model(
                self,
                config=self.config,
                task_event=Base.Event.RETRANSLATE_TASK,
            )
            if self.model is None:
                return False

            TaskRunnerLifecycle.reset_request_runtime(reset_text_processor=True)
            self.quality_snapshot = QualityRuleSnapshot.capture()
            item_ids = self.normalize_item_ids(data.get("item_ids", []))
            self.items_cache = self.build_retranslate_items(item_ids)
            return True

        def build_plan() -> TaskRunnerExecutionPlan:
            return TaskRunnerExecutionPlan(
                total_line=len(self.items_cache),
                line=0,
                has_pending_work=len(self.items_cache) > 0,
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
            TaskPipeline(
                hooks=RetranslateTaskHooks(self),
                max_workers=max_workers,
                normal_queue_size=max(1, len(self.items_cache)),
                high_queue_size=max(1, len(self.items_cache)),
                commit_queue_size=max(1, len(self.items_cache)),
            ).run()
            if Engine.get().get_status() == Base.TaskStatus.STOPPING:
                return "STOPPED"
            return "SUCCESS"

        TaskRunnerLifecycle.run_task_flow(
            self,
            task_event=Base.Event.RETRANSLATE_TASK,
            hooks=TaskRunnerHooks(
                prepare=prepare,
                build_plan=build_plan,
                persist_progress=lambda save_state: {},
                get_model=lambda: self.model,
                bind_task_limiter=bind_task_limiter,
                clear_task_limiter=lambda: setattr(self, "task_limiter", None),
                on_before_execute=lambda: None,
                execute=execute,
                on_after_execute=lambda final_status: None,
                finalize=lambda final_status: None,
                cleanup=self.cleanup,
                after_done=lambda final_status: self.emit_final_task_patch(),
            ),
        )

    def build_retranslate_items(self, item_ids: list[int]) -> list[Item]:
        item_dicts = self.dm.get_item_dicts_by_ids(item_ids)
        items: list[Item] = []
        for item_dict in item_dicts:
            item = Item.from_dict(item_dict)
            item.set_status(Base.ItemStatus.NONE)
            item.set_retry_count(0)
            items.append(item)
        return items

    def commit_payloads(
        self,
        payloads: tuple[RetranslateCommitPayload, ...],
    ) -> None:
        finalized_items = [payload.item.to_dict() for payload in payloads]
        if not finalized_items:
            return

        with self.dm.state_lock:
            translation_extras = self.build_synced_translation_extras(finalized_items)
            self.dm.update_batch(
                items=finalized_items,
                meta={
                    "translation_extras": translation_extras,
                },
            )
            self.dm.bump_project_runtime_section_revisions(("items",))
            self.revision_service.bump_revision(self.VIEW_REVISION_SCOPE)

        changed_item_ids = [
            int(item["id"])
            for item in finalized_items
            if isinstance(item.get("id"), int)
        ]
        Engine.get().remove_active_retranslate_item_ids(changed_item_ids)
        self.emit_commit_patch(changed_item_ids)

    def build_synced_translation_extras(
        self,
        finalized_items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        extras = dict(self.dm.get_translation_extras())
        item_dict_by_id: dict[int, dict[str, Any]] = {
            int(item_dict["id"]): dict(item_dict)
            for item_dict in self.dm.get_all_item_dicts()
            if isinstance(item_dict.get("id"), int)
        }
        for item_dict in finalized_items:
            raw_item_id = item_dict.get("id")
            if isinstance(raw_item_id, int):
                item_dict_by_id[raw_item_id] = dict(item_dict)

        processed_line = 0
        error_line = 0
        pending_line = 0
        for item_dict in item_dict_by_id.values():
            item = Item.from_dict(item_dict)
            if item.get_src().strip() == "":
                continue

            status = item.get_status()
            if status == Base.ItemStatus.PROCESSED:
                processed_line += 1
            elif status == Base.ItemStatus.ERROR:
                error_line += 1
            elif status == Base.ItemStatus.NONE:
                pending_line += 1

        extras["processed_line"] = processed_line
        extras["error_line"] = error_line
        extras["total_line"] = processed_line + error_line + pending_line
        extras["line"] = processed_line + error_line
        return extras

    def build_task_block(self) -> dict[str, object]:
        status = Engine.get().get_status()
        status_value = str(getattr(status, "value", status))
        return {
            "task_type": self.TASK_TYPE,
            "status": status_value,
            "busy": Base.is_engine_busy(status),
            "request_in_flight_count": Engine.get().get_request_in_flight_count(),
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_output_tokens": 0,
            "total_input_tokens": 0,
            "time": 0.0,
            "start_time": 0.0,
            "retranslating_item_ids": Engine.get().get_active_retranslate_item_ids(),
        }

    def emit_commit_patch(self, changed_item_ids: list[int]) -> None:
        runtime_view_block = self.runtime_service.build_proofreading_block()
        updated_sections = ("items", "proofreading", "task")
        self.dm.emit_project_runtime_patch(
            reason=self.RETRANSLATE_REASON,
            updated_sections=updated_sections,
            patch=[
                {
                    "op": "merge_items",
                    "items": self.runtime_service.build_item_records(changed_item_ids),
                },
                {
                    "op": "replace_proofreading",
                    "proofreading": runtime_view_block,
                },
                {
                    "op": "replace_task",
                    "task": self.build_task_block(),
                },
            ],
            section_revisions={
                section: self.runtime_service.get_section_revision(section)
                for section in updated_sections
            },
            project_revision=max(
                self.runtime_service.build_section_revisions().values(),
                default=0,
            ),
        )

    def emit_final_task_patch(self) -> None:
        Engine.get().clear_active_retranslate_item_ids()
        self.dm.emit_project_runtime_patch(
            reason=self.RETRANSLATE_REASON,
            updated_sections=("task",),
            patch=[
                {
                    "op": "replace_task",
                    "task": self.build_task_block(),
                }
            ],
        )

    def cleanup(self) -> None:
        self.dm.close_db()
        self.items_cache = []
        self.model = None
        self.quality_snapshot = None

    def stop_after_error(self, e: Exception) -> None:
        LogManager.get().error(Localizer.get().task_failed, e)
        Engine.get().set_status(Base.TaskStatus.STOPPING)

    def normalize_item_ids(self, raw_item_ids: object) -> list[int]:
        if not isinstance(raw_item_ids, list):
            return []

        item_ids: list[int] = []
        seen_ids: set[int] = set()
        for raw_item_id in raw_item_ids:
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            item_ids.append(item_id)
        return item_ids
