import json
import os
import threading
from typing import ClassVar

from model.Model import Model
from model.Model import ModelType

class ModelManager:
    """
    模型管理器
    负责模型的加载、保存、初始化、CRUD 等操作
    """

    _instance: ClassVar["ModelManager"] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()

    # 资源文件路径
    PRESET_MODELS_PATH: str = "resource/preset_models.json"
    PRESET_GOOGLE_TEMPLATE_PATH: str = "resource/preset_google_template.json"
    PRESET_OPENAI_TEMPLATE_PATH: str = "resource/preset_openai_template.json"
    PRESET_ANTHROPIC_TEMPLATE_PATH: str = "resource/preset_anthropic_template.json"

    def __init__(self) -> None:
        self.models: list[Model] = []
        self.activate_model_id: str = ""

    @classmethod
    def get(cls) -> "ModelManager":
        """获取单例实例"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """重置单例（用于测试）"""
        with cls._lock:
            cls._instance = None

    def load_preset_models(self) -> list[dict]:
        """从 preset_models.json 加载预设模型数据"""
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR", ".")
        preset_path = os.path.join(app_dir, self.PRESET_MODELS_PATH)
        try:
            with open(preset_path, "r", encoding="utf-8-sig") as reader:
                return json.load(reader)
        except Exception:
            return []

    def load_template(self, model_type: ModelType) -> dict:
        """根据模型类型加载对应模板"""
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR", ".")

        if model_type == ModelType.CUSTOM_GOOGLE:
            template_path = os.path.join(app_dir, self.PRESET_GOOGLE_TEMPLATE_PATH)
        elif model_type == ModelType.CUSTOM_OPENAI:
            template_path = os.path.join(app_dir, self.PRESET_OPENAI_TEMPLATE_PATH)
        elif model_type == ModelType.CUSTOM_ANTHROPIC:
            template_path = os.path.join(app_dir, self.PRESET_ANTHROPIC_TEMPLATE_PATH)
        else:
            return {}

        try:
            with open(template_path, "r", encoding="utf-8-sig") as reader:
                return json.load(reader)
        except Exception:
            return {}

    def initialize_models(self, existing_models: list[dict]) -> list[dict]:
        """
        初始化模型列表
        - 如果 existing_models 为空，从 preset_models.json 复制所有预设模型
        - 否则返回现有模型列表
        """
        if not existing_models:
            return self.load_preset_models()
        return existing_models

    def get_models(self) -> list[Model]:
        """获取所有模型"""
        return self.models

    def set_models(self, models_data: list[dict]) -> None:
        """从字典列表设置模型"""
        self.models = [Model.from_dict(data) for data in models_data]

    def get_models_as_dict(self) -> list[dict]:
        """获取所有模型的字典格式"""
        return [model.to_dict() for model in self.models]

    def get_model_by_id(self, model_id: str) -> Model | None:
        """根据 ID 获取模型"""
        for model in self.models:
            if model.id == model_id:
                return model
        return None

    def get_active_model(self) -> Model | None:
        """获取当前激活的模型"""
        if self.activate_model_id:
            model = self.get_model_by_id(self.activate_model_id)
            if model:
                return model
        # 如果没有激活模型或激活模型不存在，返回第一个
        if self.models:
            return self.models[0]
        return None

    def set_active_model_id(self, model_id: str) -> None:
        """设置激活模型的 ID"""
        self.activate_model_id = model_id

    def add_model(self, model_type: ModelType) -> Model:
        """
        添加新的自定义模型
        从对应模板创建，生成新 UUID
        """
        template = self.load_template(model_type)
        template["id"] = Model.generate_id()
        # 确保类型正确
        template["type"] = model_type.value

        new_model = Model.from_dict(template)
        self.models.append(new_model)
        return new_model

    def delete_model(self, model_id: str) -> bool:
        """
        删除模型（仅允许删除自定义模型）
        返回是否删除成功
        """
        for i, model in enumerate(self.models):
            if model.id == model_id:
                # 预设模型不允许删除
                if model.is_preset():
                    return False
                del self.models[i]
                # 如果删除的是激活模型，重置为第一个
                if self.activate_model_id == model_id:
                    self.activate_model_id = self.models[0].id if self.models else ""
                return True
        return False

    def update_model(self, model: Model) -> bool:
        """更新模型配置"""
        for i, existing_model in enumerate(self.models):
            if existing_model.id == model.id:
                self.models[i] = model
                return True
        return False

    def update_model_by_dict(self, model_id: str, data: dict) -> bool:
        """通过字典更新模型配置"""
        for i, model in enumerate(self.models):
            if model.id == model_id:
                # 保留 ID 和 type
                data["id"] = model.id
                data["type"] = model.type.value
                self.models[i] = Model.from_dict(data)
                return True
        return False

    def reset_preset_model(self, model_id: str) -> bool:
        """
        重置预设模型为初始状态
        从 preset_models.json 重新读取对应条目
        """
        # 查找当前模型
        target_model = self.get_model_by_id(model_id)
        if target_model is None or not target_model.is_preset():
            return False

        # 从预设文件中查找对应模型
        preset_models = self.load_preset_models()
        for preset_data in preset_models:
            if preset_data.get("id") == model_id:
                # 找到了，更新
                for i, model in enumerate(self.models):
                    if model.id == model_id:
                        self.models[i] = Model.from_dict(preset_data)
                        return True
        return False

    def reorder_models(self, ordered_ids: list[str]) -> None:
        """
        重新排序模型列表
        ordered_ids: 新顺序的模型 ID 列表
        """
        id_to_model = {model.id: model for model in self.models}
        new_order = []
        for model_id in ordered_ids:
            if model_id in id_to_model:
                new_order.append(id_to_model[model_id])
        # 添加未在列表中的模型（防御性，正常不应发生）
        for model in self.models:
            if model not in new_order:
                new_order.append(model)
        self.models = new_order
