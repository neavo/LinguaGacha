from api.Bridge.EventTopic import EventTopic
from api.Client.ApiStateStore import ApiStateStore
import api.Client.SseClient as sse_client_module
from api.Client.SseClient import SseClient


class FakeSseStreamResponse:
    """用固定分帧行模拟 SSE 响应，覆盖 run() 的逐行解析路径。"""

    def __init__(self, lines: list[str]) -> None:
        self.lines = lines

    def __enter__(self) -> "FakeSseStreamResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        del exc_type
        del exc
        del tb
        return False

    def iter_lines(self) -> list[str]:
        return self.lines


class FakeSseHttpClient:
    """把 `httpx.Client.stream()` 固定到本地行序列，避免真实网络依赖。"""

    def __init__(self, lines: list[str], **kwargs: object) -> None:
        self.lines = lines
        self.kwargs = kwargs

    def __enter__(self) -> "FakeSseHttpClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        del exc_type
        del exc
        del tb
        return False

    def stream(self, method: str, path: str) -> FakeSseStreamResponse:
        assert method == "GET"
        assert path == SseClient.STREAM_PATH
        return FakeSseStreamResponse(self.lines)


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
    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert snapshot.phase == "RUNNING"
    assert snapshot.message == "running"
    assert snapshot.current == 2
    assert snapshot.total == 10
    assert snapshot.finished is False


def test_sse_client_合并额外繁简转换完成事件() -> None:
    # 准备
    store = ApiStateStore()
    client = SseClient("http://127.0.0.1:1", store)
    client.dispatch_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        [
            '{"task_id":"extra_ts_conversion","phase":"RUNNING","message":"running","current":2,"total":10}'
        ],
    )

    # 执行
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


def test_sse_client_run_按空行收束并拼接多段_data(monkeypatch) -> None:
    # 准备
    store = ApiStateStore()
    stream_lines = [
        ": keepalive",
        f"event: {EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value}",
        'data: {"task_id":"extra_ts_conversion",',
        'data: "phase":"RUNNING",',
        'data: "message":"line1\\nline2",',
        'data: "current":2,',
        'data: "total":10,',
        'data: "finished":false}',
        "",
    ]

    def fake_http_client(**kwargs: object) -> FakeSseHttpClient:
        return FakeSseHttpClient(stream_lines, **kwargs)

    monkeypatch.setattr(sse_client_module.httpx, "Client", fake_http_client)
    client = SseClient("http://127.0.0.1:1", store)

    # 执行
    client.run()

    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert snapshot is not None
    assert snapshot.phase == "RUNNING"
    assert snapshot.message == "line1\nline2"
    assert snapshot.current == 2
    assert snapshot.total == 10
    assert snapshot.finished is False
