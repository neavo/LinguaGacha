from __future__ import annotations

import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Config import Config
from module.Data.Core.Item import Item
from module.Engine.Retranslate.RetranslateTask import (
    RetranslateCommitPayload,
)
from module.Engine.Retranslate.RetranslateTask import (
    RetranslateTask,
)
from module.Engine.Retranslate.RetranslateTask import (
    RetranslateTaskHooks,
)


class FakeLimiter:
    def __init__(self) -> None:
        self.acquire_calls: int = 0
        self.wait_calls: int = 0
        self.release_calls: int = 0

    def acquire(self, stop_checker) -> bool:
        del stop_checker
        self.acquire_calls += 1
        return True

    def wait(self, stop_checker) -> bool:
        del stop_checker
        self.wait_calls += 1
        return True

    def release(self) -> None:
        self.release_calls += 1


class FakeEngine:
    def __init__(self) -> None:
        self.status = Base.TaskStatus.RETRANSLATING
        self.retranslating_item_ids = [1, 2]

    def get_status(self):
        return self.status

    def get_request_in_flight_count(self) -> int:
        return 0

    def remove_active_retranslate_item_ids(self, item_ids: list[int]) -> None:
        self.retranslating_item_ids = [
            item_id
            for item_id in self.retranslating_item_ids
            if item_id not in item_ids
        ]

    def get_active_retranslate_item_ids(self) -> list[int]:
        return list(self.retranslating_item_ids)


def test_hooks_run_context_uses_single_item_translation_task(monkeypatch) -> None:
    created_tasks: list[dict[str, object]] = []

    class FakeTranslationTask:
        def __init__(self, **kwargs: object) -> None:
            created_tasks.append(dict(kwargs))
            self.items = kwargs["items"]

        def start(self) -> dict[str, int]:
            item = self.items[0]
            item.set_dst("新译文")
            item.set_status(Base.ItemStatus.PROCESSED)
            return {"row_count": 1}

    monkeypatch.setattr(
        "module.Engine.Retranslate.RetranslateTask.TranslationTask",
        FakeTranslationTask,
    )
    limiter = FakeLimiter()
    item = Item(id=1, src="勇者", dst="旧译文", status=Base.ItemStatus.NONE)
    task = SimpleNamespace(
        config=Config(),
        model={"threshold": {"concurrency_limit": 2}},
        quality_snapshot=None,
        task_limiter=limiter,
        should_stop=MagicMock(return_value=False),
    )

    payload = RetranslateTaskHooks(task).run_context(item)

    assert payload is not None
    assert payload.item.get_dst() == "新译文"
    assert payload.item.get_status() == Base.ItemStatus.PROCESSED
    assert created_tasks[0]["items"] == [item]
    assert created_tasks[0]["precedings"] == []
    assert created_tasks[0]["skip_response_check"] is True
    assert limiter.acquire_calls == 1
    assert limiter.wait_calls == 1
    assert limiter.release_calls == 1


def test_hooks_run_context_marks_failed_single_item_as_error(monkeypatch) -> None:
    class FakeTranslationTask:
        def __init__(self, **kwargs: object) -> None:
            self.items = kwargs["items"]

        def start(self) -> dict[str, int]:
            return {"row_count": 0}

    monkeypatch.setattr(
        "module.Engine.Retranslate.RetranslateTask.TranslationTask",
        FakeTranslationTask,
    )
    item = Item(id=2, src="旁白", dst="旧译文", status=Base.ItemStatus.NONE)
    task = SimpleNamespace(
        config=Config(),
        model={"threshold": {"concurrency_limit": 2}},
        quality_snapshot=None,
        task_limiter=FakeLimiter(),
        should_stop=MagicMock(return_value=False),
    )

    payload = RetranslateTaskHooks(task).run_context(item)

    assert payload is not None
    assert payload.item.get_status() == Base.ItemStatus.ERROR


def test_commit_payloads_persists_batch_and_emits_runtime_patch(monkeypatch) -> None:
    fake_engine = FakeEngine()
    monkeypatch.setattr(
        "module.Engine.Retranslate.RetranslateTask.Engine.get",
        classmethod(lambda cls: fake_engine),
    )
    previous_success_item = Item(
        id=1,
        src="勇者",
        dst="旧译文",
        file_path="script/a.txt",
        status=Base.ItemStatus.ERROR,
    )
    previous_failed_item = Item(
        id=2,
        src="旁白",
        dst="旧译文",
        file_path="script/a.txt",
        status=Base.ItemStatus.NONE,
    )
    skipped_item = Item(
        id=3,
        src="系统",
        dst="",
        file_path="script/a.txt",
        status=Base.ItemStatus.RULE_SKIPPED,
    )
    data_manager = SimpleNamespace(
        state_lock=threading.RLock(),
        get_all_item_dicts=MagicMock(
            return_value=[
                previous_success_item.to_dict(),
                previous_failed_item.to_dict(),
                skipped_item.to_dict(),
            ]
        ),
        get_translation_extras=MagicMock(
            return_value={
                "line": 0,
                "total_line": 2,
                "total_tokens": 99,
                "time": 12.0,
            }
        ),
        update_batch=MagicMock(),
        bump_project_runtime_section_revisions=MagicMock(return_value={"items": 2}),
        emit_project_runtime_patch=MagicMock(),
    )
    revision_service = SimpleNamespace(
        bump_revision=MagicMock(return_value=3),
    )
    runtime_service = SimpleNamespace(
        build_proofreading_block=MagicMock(return_value={"revision": 3}),
        build_item_records=MagicMock(
            return_value=[{"item_id": 1, "dst": "新译文", "status": "PROCESSED"}]
        ),
        get_section_revision=MagicMock(
            side_effect=lambda section: {"items": 2, "proofreading": 3, "task": 0}.get(
                section,
                0,
            )
        ),
        build_section_revisions=MagicMock(
            return_value={"items": 2, "proofreading": 3, "task": 0}
        ),
    )
    task = RetranslateTask.__new__(RetranslateTask)
    task.dm = data_manager
    task.revision_service = revision_service
    task.runtime_service = runtime_service
    success_item = Item(
        id=1,
        src="勇者",
        dst="新译文",
        file_path="script/a.txt",
        status=Base.ItemStatus.PROCESSED,
    )
    failed_item = Item(
        id=2,
        src="旁白",
        dst="旧译文",
        file_path="script/a.txt",
        status=Base.ItemStatus.ERROR,
    )

    task.commit_payloads(
        (
            RetranslateCommitPayload(
                item=success_item,
                result={"row_count": 1},
            ),
            RetranslateCommitPayload(
                item=failed_item,
                result={"row_count": 0},
            ),
        )
    )

    data_manager.update_batch.assert_called_once_with(
        items=[success_item.to_dict(), failed_item.to_dict()],
        meta={
            "translation_extras": {
                "line": 2,
                "total_line": 2,
                "processed_line": 1,
                "error_line": 1,
                "total_tokens": 99,
                "time": 12.0,
            }
        },
    )
    revision_service.bump_revision.assert_called_once_with("proofreading")
    assert fake_engine.retranslating_item_ids == []
    patch = data_manager.emit_project_runtime_patch.call_args.kwargs["patch"]
    assert [operation["op"] for operation in patch] == [
        "merge_items",
        "replace_proofreading",
        "replace_task",
    ]
    assert patch[2]["task"]["retranslating_item_ids"] == []
