from __future__ import annotations

from typing import Any

from api.v2.Contract.BootstrapPayloads import BootstrapCompletedPayload
from api.v2.Contract.BootstrapPayloads import BootstrapStageCompleted
from api.v2.Contract.BootstrapPayloads import BootstrapStagePayload
from api.v2.Contract.BootstrapPayloads import BootstrapStageStarted
from api.v2.Contract.EventEnvelope import build_sse_frame


class ProjectBootstrapAppService:
    """把当前已加载项目编码成一次性的 bootstrap 分段事件流。"""

    STAGE_DEFINITIONS: tuple[tuple[str, str, str], ...] = (
        ("project", "正在加载项目骨架", "build_project_block"),
        ("files", "正在加载项目文件", "build_files_block"),
        ("items", "正在加载项目条目", "build_items_block"),
        ("quality", "正在加载质量规则", "build_quality_block"),
        ("prompts", "正在加载提示词配置", "build_prompts_block"),
        ("analysis", "正在加载分析结果", "build_analysis_block"),
        ("proofreading", "正在加载校对运行态", "build_proofreading_block"),
        ("task", "正在加载任务状态", "build_task_block"),
    )

    def __init__(self, runtime_service: Any) -> None:
        self.runtime_service = runtime_service

    def iter_bootstrap_events(self, request: dict[str, object]):
        """按固定顺序输出 bootstrap 分段事件，供前端建立项目状态仓。"""

        del request
        section_revisions = self.resolve_section_revisions()

        for stage, message, builder_name in self.STAGE_DEFINITIONS:
            yield BootstrapStageStarted(stage=stage, message=message).to_dict()
            yield BootstrapStagePayload(
                stage=stage,
                payload=self.resolve_stage_payload(builder_name),
            ).to_dict()
            yield BootstrapStageCompleted(stage=stage).to_dict()

        yield BootstrapCompletedPayload(
            project_revision=max(section_revisions.values(), default=0),
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

    def resolve_section_revisions(self) -> dict[str, int]:
        builder = getattr(self.runtime_service, "build_section_revisions", None)
        if callable(builder):
            payload = builder()
            if isinstance(payload, dict):
                return {
                    str(stage): int(revision)
                    for stage, revision in payload.items()
                    if isinstance(stage, str)
                }

        return {stage: 0 for stage, _message, _builder_name in self.STAGE_DEFINITIONS}

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
            frame = build_sse_frame(event_type, payload)
            handler.wfile.write(frame)
            handler.wfile.flush()
