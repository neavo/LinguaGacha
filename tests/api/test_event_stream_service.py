from base.Base import Base
from api.Application.EventStreamService import EventStreamService


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
