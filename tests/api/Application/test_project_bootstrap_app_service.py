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
