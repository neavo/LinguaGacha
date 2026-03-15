import os
import threading
from enum import StrEnum
from typing import ClassVar

from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from model.Model import Model
from model.Model import ModelType
from module.Utils.JSONTool import JSONTool


class ModelManager:
    """
    模型管理器
    负责模型的加载、保存、初始化、CRUD 等操作
    """

    _instance: ClassVar["ModelManager"] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()

    # 预设文件名
    PRESET_BUILTIN_FILENAME: str = "preset_model_builtin.json"
    PRESET_CUSTOM_GOOGLE_FILENAME: str = "preset_model_custom_google.json"
    PRESET_CUSTOM_OPENAI_FILENAME: str = "preset_model_custom_openai.json"
    PRESET_CUSTOM_ANTHROPIC_FILENAME: str = "preset_model_custom_anthropic.json"

    class ReorderOperation(StrEnum):
        """模型组内排序操作类型。"""

        MOVE_UP = "MOVE_UP"
        MOVE_DOWN = "MOVE_DOWN"
        MOVE_TOP = "MOVE_TOP"
        MOVE_BOTTOM = "MOVE_BOTTOM"

    def __init__(self) -> None:
        self.models: list[Model] = []
        self.activate_model_id: str = ""
        # 当前使用的 UI 语言，用于确定预设目录
        self.app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH

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

    def set_app_language(self, language: BaseLanguage.Enum) -> None:
        """设置 UI 语言，用于确定预设目录"""
        self.app_language = language

    def get_preset_dir(self) -> str:
        """根据 UI 语言获取预设目录路径"""
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR", ".")
        # 中文用户使用 zh 目录，其他语言使用 en 目录
        lang_dir = "zh" if self.app_language == BaseLanguage.Enum.ZH else "en"
        return os.path.join(app_dir, "resource", "preset", "model", lang_dir)

    def load_preset_models(self) -> list[dict]:
        """从 preset_models.json 加载预设模型数据"""
        preset_path = os.path.join(self.get_preset_dir(), self.PRESET_BUILTIN_FILENAME)
        try:
            data = JSONTool.load_file(preset_path)
            return data if isinstance(data, list) else []
        except Exception as e:
            LogManager.get().warning(f"Failed to load preset models - {preset_path}", e)
            return []

    def load_template(self, model_type: ModelType) -> dict:
        """根据模型类型加载对应模板"""
        preset_dir = self.get_preset_dir()

        if model_type == ModelType.CUSTOM_GOOGLE:
            template_path = os.path.join(preset_dir, self.PRESET_CUSTOM_GOOGLE_FILENAME)
        elif model_type == ModelType.CUSTOM_OPENAI:
            template_path = os.path.join(preset_dir, self.PRESET_CUSTOM_OPENAI_FILENAME)
        elif model_type == ModelType.CUSTOM_ANTHROPIC:
            template_path = os.path.join(
                preset_dir, self.PRESET_CUSTOM_ANTHROPIC_FILENAME
            )
        else:
            return {}

        try:
            data = JSONTool.load_file(template_path)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            LogManager.get().warning(
                f"Failed to load model template: {template_path}", e
            )
            return {}

    def initialize_models(self, existing_models: list[dict]) -> tuple[list[dict], int]:
        """
        初始化模型列表
        1. 检查现有模型：如果某个 PRESET 模型的 ID 在预设文件中不存在，将其迁移为自定义模型
        2. 补充缺失的预设模型
        返回：(更新后的模型列表, 迁移的模型数量)
        """
        preset_models = self.load_preset_models()
        preset_ids = {preset.get("id") for preset in preset_models}
        migrated_count = 0

        # 1. 迁移旧预设模型
        if existing_models:
            for model in existing_models:
                # 仅处理标记为 PRESET 但 ID 已不在最新预设列表中的模型
                if (
                    model.get("type") == ModelType.PRESET.value
                    and model.get("id") not in preset_ids
                ):
                    api_format = model.get("api_format", "")

                    if api_format == "Google":
                        model["type"] = ModelType.CUSTOM_GOOGLE.value
                    elif api_format == "Anthropic":
                        model["type"] = ModelType.CUSTOM_ANTHROPIC.value
                    else:
                        # 默认为 OpenAI (包括 OpenAI, SakuraLLM, DeepSeek 等等)
                        model["type"] = ModelType.CUSTOM_OPENAI.value

                    migrated_count += 1

        # 2. 初始预设加载 / 补充
        if not existing_models:
            existing_models = []

        # 检查并添加缺失的预设模型
        existing_ids = {model.get("id") for model in existing_models}
        for preset in preset_models:
            if preset.get("id") not in existing_ids:
                existing_models.append(preset)

        # 3. 检查自定义分类，如果为空则生成默认条目
        custom_types = [
            ModelType.CUSTOM_GOOGLE,
            ModelType.CUSTOM_OPENAI,
            ModelType.CUSTOM_ANTHROPIC,
        ]

        for model_type in custom_types:
            # 检查列表中是否已存在该类型的模型
            has_type = False
            for model in existing_models:
                if model.get("type") == model_type.value:
                    has_type = True
                    break

            if not has_type:
                # 生成默认模型
                template = self.load_template(model_type)
                template["id"] = Model.generate_id()
                template["type"] = model_type.value
                existing_models.append(template)

        return existing_models, migrated_count

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
        target_model = None
        target_index = -1

        # 1. 查找要删除的模型
        for i, model in enumerate(self.models):
            if model.id == model_id:
                target_model = model
                target_index = i
                break

        if target_model is None:
            return False

        # 预设模型不允许删除
        if target_model.is_preset():
            return False

        # 2. 从列表中移除
        del self.models[target_index]

        # 3. 如果删除的是激活模型，重新选择激活模型
        if self.activate_model_id == model_id:
            new_active_model = None

            # 策略：优先回退到同类型的其他模型
            for model in self.models:
                if model.type == target_model.type:
                    new_active_model = model
                    # 如果找到了，停止搜索
                    break

            # 如果没有同类型，回退到预设分类的第一个
            if new_active_model is None:
                for model in self.models:
                    if model.is_preset():
                        new_active_model = model
                        break

            # 如果连预设都没有（防御性），回退到列表第一个
            if new_active_model is None and self.models:
                new_active_model = self.models[0]

            # 更新 ID，如果没有模型则为空字符串
            self.activate_model_id = new_active_model.id if new_active_model else ""

        return True

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

    @classmethod
    def build_group_reordered_ids(
        cls,
        model_ids: list[str],
        model_id: str,
        operation: "ModelManager.ReorderOperation",
    ) -> list[str]:
        """
        计算组内重排后的模型 ID 列表。
        为什么做成纯函数：UI 与测试共享同一规则，避免边界行为分叉。
        """
        if not model_ids:
            return []

        if model_id not in model_ids:
            return list(model_ids)

        result = list(model_ids)
        target_index = result.index(model_id)

        if operation == cls.ReorderOperation.MOVE_UP:
            if target_index <= 0:
                return result
            result[target_index - 1], result[target_index] = (
                result[target_index],
                result[target_index - 1],
            )
            return result
        elif operation == cls.ReorderOperation.MOVE_DOWN:
            if target_index >= len(result) - 1:
                return result
            result[target_index], result[target_index + 1] = (
                result[target_index + 1],
                result[target_index],
            )
            return result
        elif operation == cls.ReorderOperation.MOVE_TOP:
            if target_index <= 0:
                return result
            moved_id = result.pop(target_index)
            result.insert(0, moved_id)
            return result
        elif operation == cls.ReorderOperation.MOVE_BOTTOM:
            if target_index >= len(result) - 1:
                return result
            moved_id = result.pop(target_index)
            result.append(moved_id)
            return result
        return result

    @classmethod
    def build_global_ordered_ids_for_group(
        cls,
        models_data: list[dict],
        model_type: str,
        reordered_group_ids: list[str],
    ) -> list[str]:
        """
        根据组内新顺序构建全局 ordered_ids。
        为什么单独封装：保证只调整目标分组，其他分组顺序保持原样。
        """
        if not models_data:
            return []

        result: list[str] = []
        group_index = 0

        for model_data in models_data:
            current_type = model_data.get("type", ModelType.PRESET.value)
            if current_type == model_type:
                if group_index < len(reordered_group_ids):
                    result.append(reordered_group_ids[group_index])
                    group_index += 1
                else:
                    model_id = model_data.get("id", "")
                    if model_id:
                        result.append(model_id)
            else:
                model_id = model_data.get("id", "")
                if model_id:
                    result.append(model_id)

        # 防御性补齐：避免异常输入导致目标分组尾部 ID 丢失。
        while group_index < len(reordered_group_ids):
            model_id = reordered_group_ids[group_index]
            if model_id not in result:
                result.append(model_id)
            group_index += 1

        return result
