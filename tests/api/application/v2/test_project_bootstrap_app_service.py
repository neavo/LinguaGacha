from api.Application.V2.ProjectBootstrapAppService import V2ProjectBootstrapAppService


class StubRuntimeService:
    def build_project_block(self):
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_items_block(self):
        return {"schema": "project-items.v1", "fields": ["item_id"], "rows": [[1]]}


def test_iter_bootstrap_events_emits_project_items_quality_and_completed():
    app_service = V2ProjectBootstrapAppService(StubRuntimeService())

    events = list(app_service.iter_bootstrap_events({}))

    assert events[0]["type"] == "stage_started"
    assert events[1]["stage"] == "project"
    assert any(event.get("stage") == "items" for event in events)
    assert any(event.get("stage") == "quality" for event in events)
    assert events[-1]["type"] == "completed"
