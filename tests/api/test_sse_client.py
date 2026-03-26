from api.Bridge.EventTopic import EventTopic
from api.Client.ApiStateStore import ApiStateStore
from api.Client.SseClient import SseClient


def test_sse_client_解析校对快照失效事件() -> None:
    """校对失效事件必须由 SSE 客户端解析后落到状态仓库。"""

    store = ApiStateStore()
    client = SseClient("http://127.0.0.1:1", store)

    client.dispatch_event(
        EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value,
        ['{"reason":"quality_rule_update"}'],
    )

    assert store.is_proofreading_snapshot_invalidated() is True


def test_sse_client_合并额外繁简转换进度事件() -> None:
    # 准备
    store = ApiStateStore()
    client = SseClient("http://127.0.0.1:1", store)

    # 执行
    client.dispatch_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        [
            '{"task_id":"extra_ts_conversion","phase":"RUNNING","message":"running","current":2,"total":10}'
        ],
    )
    client.dispatch_event(
        EventTopic.EXTRA_TS_CONVERSION_FINISHED.value,
        [
            '{"task_id":"extra_ts_conversion","phase":"FINISHED","message":"done","current":10,"total":10}'
        ],
    )

    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert snapshot.phase == "FINISHED"
    assert snapshot.message == "done"
    assert snapshot.current == 10
    assert snapshot.total == 10
    assert snapshot.finished is True
