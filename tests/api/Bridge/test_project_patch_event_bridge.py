from api.Bridge.ProjectPatchEventBridge import ProjectPatchEventBridge
from base.Base import Base


def build_task_snapshot(task_type: str) -> dict[str, object]:
    return {
        "task_type": task_type,
        "status": "DONE",
        "busy": False,
    }


def test_project_patch_event_bridge_maps_translation_task_done_to_store_patch() -> None:
    bridge = ProjectPatchEventBridge(
        task_snapshot_builder=build_task_snapshot,
    )

    topic, payload = bridge.map_event(
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "item_ids": [1, 2],
            "revision": 8,
        },
    )

    assert topic == "project.patch"
    assert payload["source"] == "task"
    assert payload["updatedSections"] == ["items", "task"]
    assert payload["patch"][0] == {
        "op": "merge_items",
        "item_ids": [1, 2],
    }
    assert payload["patch"][1] == {
        "op": "replace_task",
        "task": {
            "task_type": "translation",
            "status": "DONE",
            "busy": False,
        },
    }


def test_project_patch_event_bridge_maps_analysis_done_to_store_patch() -> None:
    bridge = ProjectPatchEventBridge(
        task_snapshot_builder=build_task_snapshot,
    )

    topic, payload = bridge.map_event(
        Base.Event.ANALYSIS_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "revision": 8,
        },
    )

    assert topic == "project.patch"
    assert payload["updatedSections"] == ["analysis", "task"]
    assert payload["patch"][0] == {
        "op": "replace_analysis",
    }


def test_project_patch_event_bridge_ignores_unmapped_events() -> None:
    topic, payload = ProjectPatchEventBridge().map_event(
        Base.Event.PROJECT_CHECK,
        {
            "reason": "config_updated",
        },
    )

    assert topic is None
    assert payload == {}
