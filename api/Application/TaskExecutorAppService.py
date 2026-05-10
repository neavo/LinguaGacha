from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from typing import Any

from module.Config import Config
from module.Data.Core.Item import Item
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisTask import AnalysisTask
from module.Engine.Translation.TranslationTask import TranslationTask
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


class TaskExecutorAppService:
    """Electron main TS Task Engine 专用的 Python work-unit executor。"""

    TOKEN_HEADER: str = "X-LinguaGacha-Core-Token"

    def __init__(self, *, instance_token: str) -> None:
        """保存内部 token；executor 不持有任务生命周期或队列状态。"""

        self.instance_token = instance_token.strip()

    def execute_translation_chunk(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """执行单个翻译 chunk，并只返回该 chunk 的 item 结果。"""

        self.assert_token(handler)
        config, model, quality_snapshot = self.resolve_runtime_inputs(request)
        items = self.resolve_items(request.get("items", []))
        precedings = self.resolve_items(request.get("precedings", []))
        task = TranslationTask(
            config=config,
            model=model,
            items=items,
            precedings=precedings,
            is_sub_task=not bool(request.get("is_initial", True)),
            quality_snapshot=quality_snapshot,
            stop_checker=lambda: False,
        )
        task.split_count = self.read_int(request.get("split_count"), 0)
        task.retry_count = self.read_int(request.get("retry_count"), 0)
        task.token_threshold = self.read_int(request.get("token_threshold"), 0)
        result = task.start()
        return self.build_translation_response(items, result)

    def execute_retranslate_item(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """执行单个重翻 item；提交和行级 busy 收尾仍由 TS 完成。"""

        self.assert_token(handler)
        config, model, quality_snapshot = self.resolve_runtime_inputs(request)
        item_payload = request.get("item", {})
        items = (
            [Item.from_dict(dict(item_payload))]
            if isinstance(item_payload, dict)
            else []
        )
        task = TranslationTask(
            config=config,
            model=model,
            items=items,
            precedings=[],
            quality_snapshot=quality_snapshot,
            stop_checker=lambda: False,
        )
        result = task.start()
        return self.build_translation_response(items, result)

    def execute_translate_single(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """执行低频单条翻译，不占用后台任务锁，也不写项目数据库。"""

        self.assert_token(handler)
        text = str(request.get("text", "")).strip()
        if text == "":
            raise ValueError("待翻译文本不能为空。")
        config, model, quality_snapshot = self.resolve_runtime_inputs(request)
        del quality_snapshot
        item = Item(src=text)
        task = TranslationTask(
            config=config,
            model=model,
            items=[item],
            precedings=[],
            skip_response_check=True,
            stop_checker=lambda: False,
        )
        result = task.start()
        success = bool(result.get("row_count", 0) > 0)
        return {
            "success": success,
            "status": "OK" if success else "TRANSLATION_FAILED",
            "dst": item.get_dst(),
        }

    def execute_analysis_chunk(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """执行单个分析 chunk，checkpoint 和候选提交由 TS 决定。"""

        self.assert_token(handler)
        config, model, quality_snapshot = self.resolve_runtime_inputs(request)
        context = self.resolve_analysis_context(request.get("context", {}))
        adapter = AnalysisWorkUnitAdapter(
            config=config,
            model=model,
            quality_snapshot=quality_snapshot,
        )
        result = AnalysisTask(adapter, context).start()
        return {
            "success": result.success,
            "stopped": result.stopped,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "glossary_entries": [dict(entry) for entry in result.glossary_entries],
        }

    def assert_token(self, handler: BaseHTTPRequestHandler) -> None:
        """校验内部 token，防止 renderer 或外部脚本误触 executor。"""

        received_token = handler.headers.get(self.TOKEN_HEADER, "").strip()
        if self.instance_token == "" or received_token != self.instance_token:
            raise ValueError("Core 内部 task-executor 令牌无效。")

    def resolve_runtime_inputs(
        self,
        request: dict[str, object],
    ) -> tuple[Config, dict[str, Any], QualityRuleSnapshot | None]:
        """从 TS 快照恢复 Config、model 和质量规则，避免 Python 自行读任务状态。"""

        config = self.resolve_config(request.get("config_snapshot"))
        model_payload = request.get("model")
        model = dict(model_payload) if isinstance(model_payload, dict) else {}
        if not model:
            active_model = config.get_active_model()
            model = dict(active_model) if isinstance(active_model, dict) else {}
        if not model:
            raise ValueError("没有可用的激活模型。")
        return config, model, self.resolve_quality_snapshot(request)

    def resolve_config(self, payload: object) -> Config:
        """优先使用 TS 传入的配置快照，缺失字段继续沿用本地默认 Config。"""

        config = Config().load()
        if not isinstance(payload, dict):
            return config
        for key, value in payload.items():
            if hasattr(config, str(key)):
                setattr(config, str(key), value)
        return config

    def resolve_quality_snapshot(
        self,
        request: dict[str, object],
    ) -> QualityRuleSnapshot | None:
        """把 TS 传入的质量快照恢复为 Python 请求链路可消费对象。"""

        payload = request.get("quality_snapshot")
        if isinstance(payload, QualityRuleSnapshot):
            return payload
        if isinstance(payload, dict):
            return QualityRuleSnapshot.from_dict(payload)
        return QualityRuleSnapshot.from_dict({})

    def resolve_items(self, value: object) -> list[Item]:
        """把 TS item dict 数组转换为 Python Item 对象列表。"""

        if not isinstance(value, list):
            return []
        return [Item.from_dict(dict(item)) for item in value if isinstance(item, dict)]

    def resolve_analysis_context(self, value: object) -> AnalysisTaskContext:
        """把 TS 分析上下文恢复成不可变 dataclass，保持字段名一致。"""

        payload = dict(value) if isinstance(value, dict) else {}
        raw_items = payload.get("items", [])
        items: list[AnalysisItemContext] = []
        if isinstance(raw_items, list):
            for raw_item in raw_items:
                if not isinstance(raw_item, dict):
                    continue
                items.append(
                    AnalysisItemContext(
                        item_id=self.read_int(raw_item.get("item_id"), 0),
                        file_path=str(raw_item.get("file_path", "")),
                        src_text=str(raw_item.get("src_text", "")),
                        first_name_src=(
                            str(raw_item.get("first_name_src"))
                            if raw_item.get("first_name_src") is not None
                            else None
                        ),
                        previous_status=None,
                    )
                )
        return AnalysisTaskContext(
            file_path=str(payload.get("file_path", "")),
            items=tuple(items),
            retry_count=self.read_int(payload.get("retry_count"), 0),
        )

    def build_translation_response(
        self,
        items: list[Item],
        result: dict[str, object],
    ) -> dict[str, object]:
        """把 TranslationTask 结果裁成 work-unit executor 的窄响应。"""

        return {
            "items": [item.to_dict() for item in items],
            "row_count": self.read_int(result.get("row_count"), 0),
            "input_tokens": self.read_int(result.get("input_tokens"), 0),
            "output_tokens": self.read_int(result.get("output_tokens"), 0),
            "stopped": False,
        }

    def read_int(self, value: object, fallback: int) -> int:
        """整数读取统一兜底，避免坏 JSON 进入任务执行分支。"""

        try:
            return int(value if value is not None else fallback)
        except TypeError:
            return fallback
        except ValueError:
            return fallback


class AnalysisWorkUnitAdapter:
    """AnalysisTask 所需的最小控制器适配器，不持有任务生命周期。"""

    def __init__(
        self,
        *,
        config: Config,
        model: dict[str, Any],
        quality_snapshot: QualityRuleSnapshot | None,
    ) -> None:
        """保存单个分析 work unit 所需的请求上下文。"""

        self.config = config
        self.model = model
        self.quality_snapshot = quality_snapshot

    def should_stop(self) -> bool:
        """Python executor 只做尽力停止检查；最终停止权在 TS run_id。"""

        return False
