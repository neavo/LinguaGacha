from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler

from base.Base import Base
from module.Engine.Engine import Engine
from module.Config import Config
from module.Data.Core.Item import Item
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


class RuntimeBridgeAppService:
    """Electron main TS Gateway 专用的内部运行时同步入口。"""

    TOKEN_HEADER: str = "X-LinguaGacha-Core-Token"

    def __init__(self, *, instance_token: str) -> None:
        """初始化 RuntimeBridgeAppService 依赖和状态，保持对象写入口明确。"""

        self.instance_token = instance_token.strip()
        self.engine = Engine.get()

    def start_translation(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部翻译启动命令，并转发到 Engine 事件总线。"""

        self.assert_token(handler)
        mode = Base.TranslationMode(str(request.get("mode", Base.TranslationMode.NEW)))
        quality_snapshot = self.resolve_quality_snapshot(request)
        Base().emit(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": mode,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {"accepted": True}

    def stop_translation(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部翻译停止命令。"""

        del request
        self.assert_token(handler)
        Base().emit(
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True}

    def start_analysis(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部分析启动命令，并转发到 Engine 事件总线。"""

        self.assert_token(handler)
        mode = Base.AnalysisMode(str(request.get("mode", Base.AnalysisMode.NEW)))
        quality_snapshot = self.resolve_quality_snapshot(request)
        Base().emit(
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": mode,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {"accepted": True}

    def stop_analysis(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部分析停止命令。"""

        del request
        self.assert_token(handler)
        Base().emit(
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True}

    def start_retranslate(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部重翻启动命令，Python 只负责 Engine 运行态。"""

        self.assert_token(handler)
        item_ids = self.resolve_item_ids(request.get("item_ids", []))
        if not item_ids:
            raise ValueError("请选择要重新翻译的条目。")
        if self.is_engine_busy():
            raise ValueError(Localizer.get().task_running)
        quality_snapshot = self.resolve_quality_snapshot(request)
        set_active_retranslate_item_ids = getattr(
            self.engine,
            "set_active_retranslate_item_ids",
            None,
        )
        if callable(set_active_retranslate_item_ids):
            set_active_retranslate_item_ids(item_ids)
        Base().emit(
            Base.Event.RETRANSLATE_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "item_ids": item_ids,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {"accepted": True}

    def translate_single(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部单条翻译请求，继续复用 Python Engine。"""

        self.assert_token(handler)
        text = str(request.get("text", "")).strip()
        if text == "":
            raise ValueError("待翻译文本不能为空。")

        config = Config().load()
        get_active_model = getattr(config, "get_active_model", None)
        if callable(get_active_model) and get_active_model() is None:
            return {
                "success": False,
                "status": "NO_ACTIVE_MODEL",
                "dst": "",
            }

        item = Item(src=text)
        completed = threading.Event()
        result: dict[str, object] = {
            "success": False,
            "status": "TRANSLATION_FAILED",
            "dst": "",
        }

        def callback(translated_item: Item, success: bool) -> None:
            """Engine 回调只写入单条翻译结果，再释放同步等待。"""

            result["success"] = success
            result["status"] = "OK" if success else "TRANSLATION_FAILED"
            result["dst"] = translated_item.get_dst()
            completed.set()

        self.engine.translate_single_item(item, config, callback)
        completed.wait()
        return result

    def assert_token(self, handler: BaseHTTPRequestHandler) -> None:
        """校验内部 runtime token，防止公开路由误触内部桥。"""

        received_token = handler.headers.get(self.TOKEN_HEADER, "").strip()
        if self.instance_token == "" or received_token != self.instance_token:
            raise ValueError("Core 内部 runtime 令牌无效。")

    def resolve_quality_snapshot(
        self,
        request: dict[str, object],
    ) -> QualityRuleSnapshot | None:
        """把 TS 传入的质量快照还原为任务侧不可变规则输入。"""

        payload = request.get("quality_snapshot")
        if isinstance(payload, QualityRuleSnapshot):
            return payload
        if isinstance(payload, dict):
            return QualityRuleSnapshot.from_dict(payload)
        return None

    def resolve_item_ids(self, raw_item_ids: object) -> list[int]:
        """归一内部重翻 item_ids，保留请求顺序并去重。"""

        if not isinstance(raw_item_ids, list):
            return []
        item_ids: list[int] = []
        seen_ids: set[int] = set()
        for raw_item_id in raw_item_ids:
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            item_ids.append(item_id)
        return item_ids

    def is_engine_busy(self) -> bool:
        """读取 Engine 忙碌态，保持 TS 同步 mutation 与任务生命周期互斥。"""

        return bool(getattr(self.engine, "is_busy", lambda: False)())
