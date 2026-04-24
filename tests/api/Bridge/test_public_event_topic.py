from api.Bridge.PublicEventTopic import PublicEventTopic


def test_event_topic_values_match_public_contract() -> None:
    actual_topics = {topic.name: topic.value for topic in PublicEventTopic}

    expected_topics = {
        "PROJECT_CHANGED": "project.changed",
        "TASK_STATUS_CHANGED": "task.status_changed",
        "TASK_PROGRESS_CHANGED": "task.progress_changed",
        "SETTINGS_CHANGED": "settings.changed",
    }

    assert actual_topics == expected_topics
