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
