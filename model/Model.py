import uuid
from dataclasses import dataclass
from dataclasses import field
from enum import StrEnum
from typing import Any

class ModelType(StrEnum):
    """模型类型枚举"""
    PRESET = "PRESET"
    CUSTOM_GOOGLE = "CUSTOM_GOOGLE"
    CUSTOM_OPENAI = "CUSTOM_OPENAI"
    CUSTOM_ANTHROPIC = "CUSTOM_ANTHROPIC"


class ThinkingLevel(StrEnum):
    """思考挡位枚举"""
    OFF = "OFF"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


@dataclass
class NetworkConfig:
    """自定义网络配置"""
    custom_headers: dict[str, str] = field(default_factory=dict)
    custom_body: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "custom_headers": self.custom_headers,
            "custom_body": self.custom_body,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "NetworkConfig":
        return cls(
            custom_headers=data.get("custom_headers", {}),
            custom_body=data.get("custom_body", {}),
        )


@dataclass
class Thresholds:
    """阈值配置"""
    input_token_limit: int = 512
    output_token_limit: int = 4096
    rpm_limit: int = 0           # 0 = 无限制
    concurrency_limit: int = 0   # 0 = 自动

    def to_dict(self) -> dict:
        return {
            "input_token_limit": self.input_token_limit,
            "output_token_limit": self.output_token_limit,
            "rpm_limit": self.rpm_limit,
            "concurrency_limit": self.concurrency_limit,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Thresholds":
        return cls(
            input_token_limit=data.get("input_token_limit", 512),
            output_token_limit=data.get("output_token_limit", 4096),
            rpm_limit=data.get("rpm_limit", 0),
            concurrency_limit=data.get("concurrency_limit", 0),
        )


@dataclass
class ThinkingConfig:
    """思考配置"""
    level: ThinkingLevel = ThinkingLevel.OFF

    def to_dict(self) -> dict:
        return {"level": self.level.value}

    @classmethod
    def from_dict(cls, data: dict) -> "ThinkingConfig":
        level_str = data.get("level", "OFF")
        try:
            level = ThinkingLevel(level_str)
        except ValueError:
            level = ThinkingLevel.OFF
        return cls(level=level)


@dataclass
class GenerationConfig:
    """生成参数配置"""
    temperature: float = 0.95
    temperature_custom_enable: bool = False
    top_p: float = 0.95
    top_p_custom_enable: bool = False
    presence_penalty: float = 0.0
    presence_penalty_custom_enable: bool = False
    frequency_penalty: float = 0.0
    frequency_penalty_custom_enable: bool = False

    def to_dict(self) -> dict:
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

    @classmethod
    def from_dict(cls, data: dict) -> "GenerationConfig":
        return cls(
            temperature=data.get("temperature", 0.95),
            temperature_custom_enable=data.get("temperature_custom_enable", False),
            top_p=data.get("top_p", 0.95),
            top_p_custom_enable=data.get("top_p_custom_enable", False),
            presence_penalty=data.get("presence_penalty", 0.0),
            presence_penalty_custom_enable=data.get("presence_penalty_custom_enable", False),
            frequency_penalty=data.get("frequency_penalty", 0.0),
            frequency_penalty_custom_enable=data.get("frequency_penalty_custom_enable", False),
        )


@dataclass
class Model:
    """模型配置数据类"""
    id: str
    type: ModelType
    name: str
    api_format: str
    api_url: str
    api_key: str
    model_id: str
    network_config: NetworkConfig = field(default_factory=NetworkConfig)
    thresholds: Thresholds = field(default_factory=Thresholds)
    thinking: ThinkingConfig = field(default_factory=ThinkingConfig)
    generation: GenerationConfig = field(default_factory=GenerationConfig)

    def to_dict(self) -> dict:
        """转换为字典格式，用于 JSON 存储"""
        return {
            "id": self.id,
            "type": self.type.value,
            "name": self.name,
            "api_format": self.api_format,
            "api_url": self.api_url,
            "api_key": self.api_key,
            "model_id": self.model_id,
            "network_config": self.network_config.to_dict(),
            "thresholds": self.thresholds.to_dict(),
            "thinking": self.thinking.to_dict(),
            "generation": self.generation.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Model":
        """从字典创建 Model 实例"""
        type_str = data.get("type", "PRESET")
        try:
            model_type = ModelType(type_str)
        except ValueError:
            model_type = ModelType.PRESET

        return cls(
            id=data.get("id", str(uuid.uuid4())),
            type=model_type,
            name=data.get("name", ""),
            api_format=data.get("api_format", "OpenAI"),
            api_url=data.get("api_url", ""),
            api_key=data.get("api_key", "no_key_required"),
            model_id=data.get("model_id", ""),
            network_config=NetworkConfig.from_dict(data.get("network_config", {})),
            thresholds=Thresholds.from_dict(data.get("thresholds", {})),
            thinking=ThinkingConfig.from_dict(data.get("thinking", {})),
            generation=GenerationConfig.from_dict(data.get("generation", {})),
        )

    @classmethod
    def generate_id(cls) -> str:
        """生成新的 UUID"""
        return str(uuid.uuid4())

    def is_preset(self) -> bool:
        """判断是否为预设模型"""
        return self.type == ModelType.PRESET

    def is_custom(self) -> bool:
        """判断是否为自定义模型"""
        return self.type in (ModelType.CUSTOM_GOOGLE, ModelType.CUSTOM_OPENAI, ModelType.CUSTOM_ANTHROPIC)
