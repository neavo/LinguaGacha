from io import BytesIO

from api.v2.Application.ProjectBootstrapAppService import ProjectBootstrapAppService


class StubRuntimeService:
    def build_project_block(self):
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_files_block(self):
        return {
            "fields": ["rel_path", "file_type", "sort_index"],
            "rows": [["a.txt", "TXT", 0]],
        }

    def build_items_block(self):
        return {"fields": ["item_id"], "rows": [[1]]}

    def build_task_block(self):
        return {"task_type": "translation", "status": "IDLE"}


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


def test_iter_bootstrap_events_emits_project_items_quality_and_completed():
    app_service = ProjectBootstrapAppService(StubRuntimeService())

    events = list(app_service.iter_bootstrap_events({}))

    assert events[0]["type"] == "stage_started"
    assert events[1]["stage"] == "project"
    assert any(event.get("stage") == "files" for event in events)
    assert any(event.get("stage") == "items" for event in events)
    assert any(event.get("stage") == "quality" for event in events)
    assert any(event.get("stage") == "task" for event in events)
    assert events[-1]["type"] == "completed"


def test_stream_to_handler_backslash_escapes_lone_surrogate_in_stage_payload() -> None:
    class RuntimeServiceWithSurrogate(StubRuntimeService):
        def build_project_block(self):
            return {"project": {"path": "demo-\ud800.lg", "loaded": True}}

    app_service = ProjectBootstrapAppService(RuntimeServiceWithSurrogate())
    handler = FakeStreamHandler()

    app_service.stream_to_handler(handler)

    assert handler.status_code == 200
    assert ("Content-Type", "text/event-stream; charset=utf-8") in handler.headers
    assert "\\ud800" in handler.wfile.getvalue().decode("utf-8")
