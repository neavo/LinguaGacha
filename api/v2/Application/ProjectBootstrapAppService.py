from __future__ import annotations

import json
from typing import Any

from api.v2.Contract.BootstrapPayloads import BootstrapCompletedPayload
from api.v2.Contract.BootstrapPayloads import BootstrapStageCompleted
from api.v2.Contract.BootstrapPayloads import BootstrapStagePayload
from api.v2.Contract.BootstrapPayloads import BootstrapStageStarted


class ProjectBootstrapAppService:
    """把当前已加载项目编码成一次性的 bootstrap 分段事件流。"""

    STAGE_DEFINITIONS: tuple[tuple[str, str, str], ...] = (
        ("project", "正在加载项目骨架", "build_project_block"),
        ("files", "正在加载项目文件", "build_files_block"),
        ("items", "正在加载项目条目", "build_items_block"),
        ("quality", "正在加载质量规则", "build_quality_block"),
        ("prompts", "正在加载提示词配置", "build_prompts_block"),
        ("analysis", "正在加载分析结果", "build_analysis_block"),
        ("task", "正在加载任务状态", "build_task_block"),
    )

    def __init__(self, runtime_service: Any) -> None:
        self.runtime_service = runtime_service

    def iter_bootstrap_events(self, request: dict[str, object]):
        """按固定顺序输出 bootstrap 分段事件，供前端建立项目状态仓。"""

        del request
        section_revisions: dict[str, int] = {}

        for stage_index, (stage, message, builder_name) in enumerate(
            self.STAGE_DEFINITIONS,
            start=1,
        ):
            yield BootstrapStageStarted(stage=stage, message=message).to_dict()
            yield BootstrapStagePayload(
                stage=stage,
                payload=self.resolve_stage_payload(builder_name),
            ).to_dict()
            yield BootstrapStageCompleted(stage=stage).to_dict()
            section_revisions[stage] = stage_index

        yield BootstrapCompletedPayload(
            project_revision=len(section_revisions),
            section_revisions=section_revisions,
        ).to_dict()

    def resolve_stage_payload(self, builder_name: str) -> dict[str, Any]:
        """统一兜底缺省 stage builder，保证 bootstrap 顺序稳定。"""

        builder = getattr(self.runtime_service, builder_name, None)
        if callable(builder):
            payload = builder()
            if isinstance(payload, dict):
                return payload
        return {}

    def stream_to_handler(self, handler: Any) -> None:
        """把一次性 bootstrap 事件流写成 SSE，供渲染层逐段消费。"""

        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("Connection", "keep-alive")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
        handler.end_headers()

        for event in self.iter_bootstrap_events({}):
            event_type = str(event.get("type", "message"))
            payload = {key: value for key, value in event.items() if key != "type"}
            frame = (
                f"event: {event_type}\n"
                f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            ).encode("utf-8")
            handler.wfile.write(frame)
            handler.wfile.flush()
