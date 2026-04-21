from api.v2.Contract.EventEnvelope import EventEnvelope


def test_event_envelope_to_sse_payload_preserves_topic_and_unicode_json() -> None:
    payload = EventEnvelope(
        topic="task.progress_changed",
        data={"message": "勇者", "processed_line": 2},
    ).to_sse_payload()

    assert payload.decode("utf-8") == (
        'event: task.progress_changed\ndata: {"message":"勇者","processed_line":2}\n\n'
    )


def test_event_envelope_to_sse_payload_backslash_escapes_lone_surrogate() -> None:
    payload = EventEnvelope(
        topic="task.progress_changed",
        data={"message": "\ud800"},
    ).to_sse_payload()

    assert payload.decode("utf-8") == (
        'event: task.progress_changed\ndata: {"message":"\\ud800"}\n\n'
    )
