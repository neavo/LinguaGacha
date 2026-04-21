from api.Bridge.V2.EventBridge import V2EventBridge
from base.Base import Base


def test_v2_event_bridge_maps_translation_done_to_task_patch():
    topic, payload = V2EventBridge().map_event(
        "translation_done",
        {
            "item_ids": [1, 2],
            "revision": 5,
        },
    )

    assert topic == "project.patch"
    assert payload["source"] == "task"
    assert payload["updatedSections"] == ["items", "task"]


def test_v2_event_bridge_maps_translation_task_done_event_to_task_patch():
    topic, payload = V2EventBridge().map_event(
        Base.Event.TRANSLATION_TASK,
        {
            "sub_event": Base.SubEvent.DONE,
            "item_ids": [3],
            "revision": 8,
        },
    )

    assert topic == "project.patch"
    assert payload["projectRevision"] == 8
    assert payload["patch"][0]["item_ids"] == [3]
