from api.Bridge.EventTopic import EventTopic


def test_event_topic_values_match_public_contract() -> None:
    # 准备
    actual_topics = {topic.name: topic.value for topic in EventTopic}

    # 执行
    expected_topics = {
        "PROJECT_CHANGED": "project.changed",
        "TASK_STATUS_CHANGED": "task.status_changed",
        "TASK_PROGRESS_CHANGED": "task.progress_changed",
        "SETTINGS_CHANGED": "settings.changed",
        "EXTRA_TS_CONVERSION_PROGRESS": "extra.ts_conversion_progress",
        "EXTRA_TS_CONVERSION_FINISHED": "extra.ts_conversion_finished",
    }

    # 断言
    assert actual_topics == expected_topics


def test_event_topic_values_are_unique() -> None:
    # 准备
    topic_values = [topic.value for topic in EventTopic]

    # 执行
    unique_topic_values = set(topic_values)

    # 断言
    assert len(topic_values) == len(unique_topic_values)
