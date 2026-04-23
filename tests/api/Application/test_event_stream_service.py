from queue import Empty

from base.Base import Base
from api.Application.EventStreamService import EventStreamService
from api.Bridge.ProjectPatchEventBridge import ProjectPatchEventBridge


class StubRuntimeService:
    def build_item_records(self, item_ids: list[int]) -> list[dict[str, object]]:
        return [
            {
                "item_id": item_id,
                "file_path": "chapter01.txt",
                "src": "原文",
                "dst": f"译文{item_id}",
                "status": "DONE",
            }
            for item_id in item_ids
        ]

    def build_quality_block(self) -> dict[str, object]:
        return {
            "glossary": {
                "entries": [{"src": "绿之塔", "dst": "绿塔"}],
                "enabled": True,
                "mode": "off",
                "revision": 4,
            },
            "pre_replacement": {
                "entries": [],
                "enabled": False,
                "mode": "off",
                "revision": 0,
            },
            "post_replacement": {
                "entries": [],
                "enabled": False,
                "mode": "off",
                "revision": 0,
            },
            "text_preserve": {
                "entries": [],
                "enabled": False,
                "mode": "off",
                "revision": 0,
            },
        }

    def build_analysis_block(self) -> dict[str, object]:
        return {
            "candidate_count": 3,
            "status_summary": {"done": 3},
        }

    def get_section_revision(self, stage: str) -> int:
        if stage == "quality":
            return 4
        if stage == "analysis":
            return 8
        if stage == "task":
            return 6
        return 0


def build_task_snapshot(task_type: str) -> dict[str, object]:
    return {
        "task_type": task_type,
        "status": "DONE",
        "busy": False,
    }


def test_publish_event_creates_standardized_envelope() -> None:
    service = EventStreamService()
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"processed_line": 2, "total_line": 5},
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "task.progress_changed"
    assert envelope.data["task_type"] == "translation"
    assert envelope.data["processed_line"] == 2


def test_publish_event_keeps_progress_patch_shape() -> None:
    service = EventStreamService()
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"request_in_flight_count": 3},
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "task.progress_changed"
    assert envelope.data == {
        "task_type": "translation",
        "request_in_flight_count": 3,
    }


def test_publish_unmapped_event_is_ignored() -> None:
    service = EventStreamService()
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.PROJECT_CHECK,
        {"reason": "config_updated"},
    )

    assert subscriber.empty() is True


class FakeSseHandler:
    """用最小 HTTP 处理器桩模拟客户端主动断开后的写入失败。"""

    class FakeWFile:
        def __init__(self) -> None:
            self.write_calls: int = 0

        def write(self, payload: bytes) -> None:
            del payload
            self.write_calls += 1
            raise ConnectionAbortedError(10053, "connection aborted")

        def flush(self) -> None:
            # 这里不做任何事，因为写入阶段已经模拟了连接中止。
            return None

    def __init__(self) -> None:
        self.wfile = self.FakeWFile()

    def send_response(self, status_code: int) -> None:
        del status_code

    def send_header(self, key: str, value: str) -> None:
        del key, value

    def end_headers(self) -> None:
        return None


class FakeEmptySubscriber:
    """用空队列桩把 SSE 循环推进到 keepalive 写入分支。"""

    def get(self, timeout: float) -> object:
        del timeout
        raise Empty


def test_stream_to_handler_swallow_connection_aborted_error() -> None:
    service = EventStreamService()
    subscriber = FakeEmptySubscriber()

    def fake_add_subscriber() -> FakeEmptySubscriber:
        service.subscribers.append(subscriber)  # 让 finally 能把订阅者移除干净。
        return subscriber

    service.add_subscriber = fake_add_subscriber  # type: ignore[method-assign]

    handler = FakeSseHandler()

    service.stream_to_handler(handler)

    assert handler.wfile.write_calls == 1
    assert service.subscribers == []


def test_publish_event_supports_project_patch_bridge() -> None:
    service = EventStreamService(
        event_bridge=ProjectPatchEventBridge(
            runtime_service=StubRuntimeService(),
            task_snapshot_builder=build_task_snapshot,
        )
    )
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "item_ids": [1, 2],
            "revision": 5,
        },
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "project.patch"
    assert envelope.data["source"] == "task"
    assert envelope.data["updatedSections"] == ["items", "task"]
    assert envelope.data["patch"][0]["items"][0]["item_id"] == 1


def test_publish_project_runtime_patch_supports_direct_patch_payload() -> None:
    service = EventStreamService(
        event_bridge=ProjectPatchEventBridge(
            runtime_service=StubRuntimeService(),
            task_snapshot_builder=build_task_snapshot,
        )
    )
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.PROJECT_RUNTIME_PATCH,
        {
            "source": "mutation",
            "updatedSections": ["items", "analysis"],
            "patch": [{"op": "replace_analysis", "analysis": {"candidate_count": 0}}],
            "projectRevision": 9,
            "sectionRevisions": {"items": 9, "analysis": 9},
        },
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "project.patch"
    assert envelope.data["source"] == "mutation"
    assert envelope.data["updatedSections"] == ["items", "analysis"]
    assert envelope.data["projectRevision"] == 9
    assert envelope.data["sectionRevisions"] == {
        "items": 9,
        "analysis": 9,
    }


def test_publish_unmapped_event_with_patch_bridge_is_ignored() -> None:
    service = EventStreamService(
        event_bridge=ProjectPatchEventBridge(
            runtime_service=StubRuntimeService(),
            task_snapshot_builder=build_task_snapshot,
        )
    )
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.PROJECT_CHECK,
        {
            "reason": "quality_rule_update",
        },
    )

    assert subscriber.empty() is True
