from api.Bridge.ProjectPatchEventBridge import ProjectPatchEventBridge
from base.Base import Base


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


def test_project_patch_event_bridge_maps_translation_task_done_to_store_patch():
    bridge = ProjectPatchEventBridge(
        runtime_service=StubRuntimeService(),
        task_snapshot_builder=build_task_snapshot,
    )

    topic, payload = bridge.map_event(
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "item_ids": [1, 2],
            "revision": 5,
        },
    )

    assert topic == "project.patch"
    assert payload["source"] == "task"
    assert payload["updatedSections"] == ["items", "task"]
    assert payload["patch"][0] == {
        "op": "merge_items",
        "items": [
            {
                "item_id": 1,
                "file_path": "chapter01.txt",
                "src": "原文",
                "dst": "译文1",
                "status": "DONE",
            },
            {
                "item_id": 2,
                "file_path": "chapter01.txt",
                "src": "原文",
                "dst": "译文2",
                "status": "DONE",
            },
        ],
    }
    assert payload["patch"][1] == {
        "op": "replace_task",
        "task": {
            "task_type": "translation",
            "status": "DONE",
            "busy": False,
        },
    }


def test_project_patch_event_bridge_maps_analysis_task_done_event_to_store_patch():
    bridge = ProjectPatchEventBridge(
        runtime_service=StubRuntimeService(),
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
    assert payload["projectRevision"] == 8
    assert payload["updatedSections"] == ["analysis", "task"]
    assert payload["patch"][0] == {
        "op": "replace_analysis",
        "analysis": {
            "candidate_count": 3,
            "status_summary": {"done": 3},
        },
    }


def test_project_patch_event_bridge_maps_translation_task_done_event_to_task_patch():
    bridge = ProjectPatchEventBridge(
        runtime_service=StubRuntimeService(),
        task_snapshot_builder=build_task_snapshot,
    )

    topic, payload = bridge.map_event(
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "item_ids": [3],
            "revision": 8,
        },
    )

    assert topic == "project.patch"
    assert payload["projectRevision"] == 8
    assert payload["patch"][0]["items"][0]["item_id"] == 3


def test_project_patch_event_bridge_ignores_unmapped_events():
    topic, payload = ProjectPatchEventBridge().map_event(
        Base.Event.PROJECT_CHECK,
        {
            "reason": "config_updated",
        },
    )

    assert topic is None
    assert payload == {}
