from io import BytesIO
from typing import Any

from api.Application.ProjectBootstrapAppService import ProjectBootstrapAppService


class StubRuntimeService:
    def build_project_block(self) -> dict[str, object]:
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_files_block(self) -> dict[str, object]:
        return {
            "fields": ["rel_path", "file_type", "sort_index"],
            "rows": [["a.txt", "TXT", 0]],
        }

    def build_items_block(self) -> dict[str, object]:
        return {"fields": ["item_id"], "rows": [[1]]}

    def build_quality_block(self) -> dict[str, object]:
        return {"glossary": {"entries": [], "revision": 2}}

    def build_prompts_block(self) -> dict[str, object]:
        return {"translation": {"text": "prompt", "revision": 3}}

    def build_analysis_block(self) -> dict[str, object]:
        return {"candidate_count": 4}

    def build_proofreading_block(self) -> dict[str, object]:
        return {"revision": 5, "changed_item_ids": [1]}

    def build_task_block(self) -> dict[str, object]:
        return {"task_type": "translation", "status": "IDLE"}

    def build_section_revisions(self) -> dict[str, int]:
        return {
            "project": 1,
            "files": 2,
            "items": 3,
            "quality": 4,
            "prompts": 5,
            "analysis": 6,
            "proofreading": 7,
            "task": 8,
        }


class FakeStreamHandler:
    def __init__(self) -> None:
        self.status_code: int | None = None
        self.headers: list[tuple[str, str]] = []
        self.wfile = BytesIO()

    def send_response(self, status_code: int) -> None:
        self.status_code = status_code

    def send_header(self, key: str, value: str) -> None:
        self.headers.append((key, value))

    def end_headers(self) -> None:
        return None


def test_iter_bootstrap_events_emits_all_stages_in_contract_order() -> None:
    app_service = ProjectBootstrapAppService(StubRuntimeService())

    events = list(app_service.iter_bootstrap_events({}))

    expected_stages = [
        "project",
        "files",
        "items",
        "quality",
        "prompts",
        "analysis",
        "proofreading",
        "task",
    ]
    expected_timeline: list[tuple[object, object]] = [
        (event_type, stage)
        for stage in expected_stages
        for event_type in ("stage_started", "stage_payload", "stage_completed")
    ]
    actual_timeline = [
        (event["type"], event.get("stage"))
        for event in events
        if event["type"] != "completed"
    ]

    assert actual_timeline == expected_timeline
    assert events[-1] == {
        "type": "completed",
        "projectRevision": 8,
        "sectionRevisions": {
            "project": 1,
            "files": 2,
            "items": 3,
            "quality": 4,
            "prompts": 5,
            "analysis": 6,
            "proofreading": 7,
            "task": 8,
        },
    }


def test_iter_bootstrap_events_reuses_combined_files_items_payloads() -> None:
    class CombinedRuntimeService(StubRuntimeService):
        def __init__(self) -> None:
            self.combined_calls = 0
            self.files_calls = 0
            self.items_calls = 0

        def build_files_items_blocks(self) -> dict[str, dict[str, object]]:
            self.combined_calls += 1
            return {
                "files": {
                    "fields": ["rel_path", "file_type", "sort_index"],
                    "rows": [["combined.txt", "TXT", 0]],
                },
                "items": {
                    "fields": ["item_id"],
                    "rows": [[7]],
                },
            }

        def build_files_block(self) -> dict[str, object]:
            self.files_calls += 1
            return super().build_files_block()

        def build_items_block(self) -> dict[str, object]:
            self.items_calls += 1
            return super().build_items_block()

    runtime_service = CombinedRuntimeService()
    app_service = ProjectBootstrapAppService(runtime_service)

    events = list(app_service.iter_bootstrap_events({}))
    payloads = {
        str(event["stage"]): event["payload"]
        for event in events
        if event["type"] == "stage_payload"
    }

    assert runtime_service.combined_calls == 1
    assert runtime_service.files_calls == 0
    assert runtime_service.items_calls == 0
    assert payloads["files"]["rows"] == [["combined.txt", "TXT", 0]]
    assert payloads["items"]["rows"] == [[7]]


def test_stream_to_handler_backslash_escapes_lone_surrogate_in_stage_payload() -> None:
    class RuntimeServiceWithSurrogate(StubRuntimeService):
        def build_project_block(self) -> dict[str, Any]:
            return {"project": {"path": "demo-\ud800.lg", "loaded": True}}

    app_service = ProjectBootstrapAppService(RuntimeServiceWithSurrogate())
    handler = FakeStreamHandler()

    app_service.stream_to_handler(handler)

    assert handler.status_code == 200
    assert ("Content-Type", "text/event-stream; charset=utf-8") in handler.headers
    assert "\\ud800" in handler.wfile.getvalue().decode("utf-8")
