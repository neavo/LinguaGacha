from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


@dataclass(frozen=True)
class ModelRequestSnapshot:
    """把请求层配置冻结，避免页面继续共享可变请求字典。"""

    extra_headers: dict[str, str] = field(default_factory=dict)
    extra_headers_custom_enable: bool = False
    extra_body: dict[str, Any] = field(default_factory=dict)
    extra_body_custom_enable: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """统一兜底缺省字段，保证客户端读取口径稳定。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        headers_raw = normalized.get("extra_headers", {})
        body_raw = normalized.get("extra_body", {})
        if isinstance(headers_raw, dict):
            extra_headers = {str(key): str(value) for key, value in headers_raw.items()}
        else:
            extra_headers = {}

        if isinstance(body_raw, dict):
            extra_body = dict(body_raw)
        else:
            extra_body = {}

        return cls(
            extra_headers=extra_headers,
            extra_headers_custom_enable=bool(
                normalized.get("extra_headers_custom_enable", False)
            ),
            extra_body=extra_body,
            extra_body_custom_enable=bool(
                normalized.get("extra_body_custom_enable", False)
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        """恢复为 JSON 字典，供 payload 与页面渲染复用。"""

        return {
            "extra_headers": dict(self.extra_headers),
            "extra_headers_custom_enable": self.extra_headers_custom_enable,
            "extra_body": dict(self.extra_body),
            "extra_body_custom_enable": self.extra_body_custom_enable,
        }


@dataclass(frozen=True)
class ModelThresholdSnapshot:
    """把阈值配置冻结，避免页面重复猜默认限制值。"""

    input_token_limit: int = 512
    output_token_limit: int = 4096
    rpm_limit: int = 0
    concurrency_limit: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """统一在客户端补齐阈值默认值，避免 UI 自己兜底。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            input_token_limit=int(normalized.get("input_token_limit", 512) or 512),
            output_token_limit=int(normalized.get("output_token_limit", 4096) or 4096),
            rpm_limit=int(normalized.get("rpm_limit", 0) or 0),
            concurrency_limit=int(normalized.get("concurrency_limit", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定的阈值字典，供边界层直接发送。"""

        return {
            "input_token_limit": self.input_token_limit,
            "output_token_limit": self.output_token_limit,
            "rpm_limit": self.rpm_limit,
            "concurrency_limit": self.concurrency_limit,
        }


@dataclass(frozen=True)
class ModelThinkingSnapshot:
    """把思考挡位冻结为对象，避免页面散读嵌套字典。"""

    level: str = "OFF"

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """统一收口思考挡位字段，避免页面层自己补默认值。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(level=str(normalized.get("level", "OFF")))

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定字典，供服务端载荷与客户端刷新共用。"""

        return {"level": self.level}


@dataclass(frozen=True)
class ModelGenerationSnapshot:
    """把生成参数冻结，保证页面滑条只消费显式对象字段。"""

    temperature: float = 0.95
    temperature_custom_enable: bool = False
    top_p: float = 0.95
    top_p_custom_enable: bool = False
    presence_penalty: float = 0.0
    presence_penalty_custom_enable: bool = False
    frequency_penalty: float = 0.0
    frequency_penalty_custom_enable: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """统一在客户端侧补齐生成参数默认值，减少页面分支。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            temperature=float(normalized.get("temperature", 0.95) or 0.95),
            temperature_custom_enable=bool(
                normalized.get("temperature_custom_enable", False)
            ),
            top_p=float(normalized.get("top_p", 0.95) or 0.95),
            top_p_custom_enable=bool(normalized.get("top_p_custom_enable", False)),
            presence_penalty=float(normalized.get("presence_penalty", 0.0) or 0.0),
            presence_penalty_custom_enable=bool(
                normalized.get("presence_penalty_custom_enable", False)
            ),
            frequency_penalty=float(normalized.get("frequency_penalty", 0.0) or 0.0),
            frequency_penalty_custom_enable=bool(
                normalized.get("frequency_penalty_custom_enable", False)
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定字典，供边界层与页面回填共用。"""

        return {
            "temperature": self.temperature,
            "temperature_custom_enable": self.temperature_custom_enable,
            "top_p": self.top_p,
            "top_p_custom_enable": self.top_p_custom_enable,
            "presence_penalty": self.presence_penalty,
            "presence_penalty_custom_enable": self.presence_penalty_custom_enable,
            "frequency_penalty": self.frequency_penalty,
            "frequency_penalty_custom_enable": self.frequency_penalty_custom_enable,
        }


@dataclass(frozen=True)
class ModelEntrySnapshot:
    """把单个模型条目冻结，避免页面继续传递可变模型配置。"""

    id: str = ""
    type: str = "PRESET"
    name: str = ""
    api_format: str = "OpenAI"
    api_url: str = ""
    api_key: str = ""
    model_id: str = ""
    request: ModelRequestSnapshot = field(default_factory=ModelRequestSnapshot)
    threshold: ModelThresholdSnapshot = field(default_factory=ModelThresholdSnapshot)
    thinking: ModelThinkingSnapshot = field(default_factory=ModelThinkingSnapshot)
    generation: ModelGenerationSnapshot = field(default_factory=ModelGenerationSnapshot)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把模型字典规范化为冻结对象，统一页面消费入口。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            id=str(normalized.get("id", "")),
            type=str(normalized.get("type", "PRESET")),
            name=str(normalized.get("name", "")),
            api_format=str(normalized.get("api_format", "OpenAI")),
            api_url=str(normalized.get("api_url", "")),
            api_key=str(normalized.get("api_key", "")),
            model_id=str(normalized.get("model_id", "")),
            request=ModelRequestSnapshot.from_dict(normalized.get("request", {})),
            threshold=ModelThresholdSnapshot.from_dict(normalized.get("threshold", {})),
            thinking=ModelThinkingSnapshot.from_dict(normalized.get("thinking", {})),
            generation=ModelGenerationSnapshot.from_dict(
                normalized.get("generation", {})
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定 JSON 字典，供 payload 与页面刷新复用。"""

        return {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "api_format": self.api_format,
            "api_url": self.api_url,
            "api_key": self.api_key,
            "model_id": self.model_id,
            "request": self.request.to_dict(),
            "threshold": self.threshold.to_dict(),
            "thinking": self.thinking.to_dict(),
            "generation": self.generation.to_dict(),
        }


@dataclass(frozen=True)
class ModelPageSnapshot:
    """把模型页需要的完整快照冻结，避免 UI 再去直接读配置文件。"""

    active_model_id: str = ""
    models: tuple[ModelEntrySnapshot, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """统一把模型页响应收口为冻结快照，保证渲染入口单一。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        raw_models = normalized.get("models", ())
        models: list[ModelEntrySnapshot] = []
        if isinstance(raw_models, (list, tuple)):
            for raw_model in raw_models:
                models.append(ModelEntrySnapshot.from_dict(raw_model))

        return cls(
            active_model_id=str(normalized.get("active_model_id", "")),
            models=tuple(models),
        )

    def to_dict(self) -> dict[str, Any]:
        """恢复为稳定 JSON 字典，供 HTTP 响应与测试断言复用。"""

        return {
            "active_model_id": self.active_model_id,
            "models": [model.to_dict() for model in self.models],
        }
