import os
from enum import StrEnum

from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath
from module.Localizer.Localizer import Localizer


class PromptPathResolver:
    """统一处理提示词模板、预设与路径解析。"""

    class TaskType(StrEnum):
        TRANSLATION = "translation"
        ANALYSIS = "analysis"

    class PresetSource(StrEnum):
        BUILTIN = "builtin"
        USER = "user"

    PRESET_EXTENSION: str = ".txt"

    @classmethod
    def get_task_dir_name(cls, task_type: TaskType) -> str:
        return f"{task_type.value}_prompt"

    @classmethod
    def normalize_preset_name(cls, name: str) -> str:
        """统一清理用户输入的预设名，避免保存/重命名各自 trim。"""

        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("preset name is empty")
        return normalized_name

    @classmethod
    def ensure_preset_file_name(cls, file_name: str, raw_value: str) -> str:
        """统一校验预设文件名格式，避免虚拟 ID 与文件操作各自漏判。"""

        if not file_name or not file_name.lower().endswith(cls.PRESET_EXTENSION):
            raise ValueError(f"invalid virtual preset id: {raw_value}")
        return file_name

    @classmethod
    def build_preset_file_name(cls, name: str) -> str:
        """统一从预设名生成文件名，避免拼接扩展名的规则分散。"""

        return f"{cls.normalize_preset_name(name)}{cls.PRESET_EXTENSION}"

    @classmethod
    def get_preset_dir(cls, task_type: TaskType, source: PresetSource) -> str:
        """统一按来源解析预设目录，避免 builtin/user 分支四处分散。"""

        if source == cls.PresetSource.BUILTIN:
            return cls.get_builtin_preset_dir(task_type)
        return cls.get_user_preset_dir(task_type)

    @classmethod
    def get_template_path(
        cls,
        task_type: TaskType,
        file_name: str,
        language: BaseLanguage.Enum | None = None,
    ) -> str:
        """统一拼出模板路径，避免读取入口各自重复处理语言与目录。"""

        resolved_language = language or Localizer.get_app_language()
        return os.path.join(
            BasePath.get_prompt_template_dir(
                cls.get_task_dir_name(task_type),
                resolved_language,
            ),
            file_name,
        )

    @classmethod
    def get_builtin_preset_dir(cls, task_type: TaskType) -> str:
        """内置预设始终跟随 resource，统一从 BasePath 读取。"""

        return BasePath.get_prompt_builtin_preset_dir(cls.get_task_dir_name(task_type))

    @classmethod
    def get_builtin_preset_relative_dir(cls, task_type: TaskType) -> str:
        """列表展示仍保留 resource 相对路径，避免界面值混成绝对路径。"""

        return BasePath.get_prompt_builtin_preset_relative_dir(
            cls.get_task_dir_name(task_type)
        )

    @classmethod
    def get_user_preset_dir(cls, task_type: TaskType) -> str:
        """用户预设必须走 DATA_ROOT，对外收口为单一入口。"""

        return BasePath.get_prompt_user_preset_dir(cls.get_task_dir_name(task_type))

    @classmethod
    def get_legacy_user_preset_dirs(cls) -> list[str]:
        """返回旧版翻译提示词用户预设目录列表，用于启动迁移。"""

        return [
            BasePath.get_prompt_legacy_user_preset_dir(BaseLanguage.Enum.ZH),
            BasePath.get_prompt_legacy_user_preset_dir(BaseLanguage.Enum.EN),
        ]

    @classmethod
    def build_preset_item(
        cls,
        source: PresetSource,
        file_name: str,
        path_dir: str,
    ) -> dict[str, str]:
        """列表和重命名都复用同一结构，避免字段拼装发生漂移。"""

        return {
            "name": file_name[: -len(cls.PRESET_EXTENSION)],
            "file_name": file_name,
            "virtual_id": cls.build_virtual_id(source, file_name),
            "path": os.path.join(path_dir, file_name).replace("\\", "/"),
            "type": source.value,
        }

    @classmethod
    def read_template(
        cls,
        task_type: TaskType,
        file_name: str,
        language: BaseLanguage.Enum | None = None,
    ) -> str:
        path = cls.get_template_path(task_type, file_name, language)
        with open(path, "r", encoding="utf-8-sig") as reader:
            return reader.read().strip()

    @classmethod
    def build_virtual_id(cls, source: PresetSource, file_name: str) -> str:
        cls.ensure_preset_file_name(file_name, file_name)
        return f"{source.value}:{file_name}"

    @classmethod
    def split_virtual_id(cls, virtual_id: str) -> tuple[PresetSource, str]:
        if not isinstance(virtual_id, str) or ":" not in virtual_id:
            raise ValueError(f"invalid virtual preset id: {virtual_id}")

        raw_source, file_name = virtual_id.split(":", 1)
        source = cls.PresetSource(raw_source)
        cls.ensure_preset_file_name(file_name, virtual_id)
        return source, file_name

    @classmethod
    def resolve_virtual_id_path(cls, task_type: TaskType, virtual_id: str) -> str:
        source, file_name = cls.split_virtual_id(virtual_id)
        return os.path.join(cls.get_preset_dir(task_type, source), file_name)

    @classmethod
    def list_presets(
        cls, task_type: TaskType
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        builtin_items = cls.list_preset_items(
            cls.PresetSource.BUILTIN,
            cls.get_builtin_preset_dir(task_type),
            cls.get_builtin_preset_relative_dir(task_type),
        )
        user_items = cls.list_preset_items(
            cls.PresetSource.USER,
            cls.get_user_preset_dir(task_type),
        )
        return builtin_items, user_items

    @classmethod
    def list_preset_items(
        cls,
        source: PresetSource,
        directory: str,
        resolved_path_dir: str | None = None,
    ) -> list[dict[str, str]]:
        if resolved_path_dir is None:
            resolved_path_dir = directory

        if source == cls.PresetSource.USER:
            os.makedirs(directory, exist_ok=True)
        elif not os.path.isdir(directory):
            return []

        items: list[dict[str, str]] = []
        for file_name in sorted(os.listdir(directory), key=str.casefold):
            if not file_name.lower().endswith(cls.PRESET_EXTENSION):
                continue

            items.append(cls.build_preset_item(source, file_name, resolved_path_dir))
        return items

    @classmethod
    def read_preset(cls, task_type: TaskType, virtual_id: str) -> str:
        path = cls.resolve_virtual_id_path(task_type, virtual_id)
        with open(path, "r", encoding="utf-8-sig") as reader:
            return reader.read().strip()

    @classmethod
    def save_user_preset(cls, task_type: TaskType, name: str, text: str) -> str:
        directory = cls.get_user_preset_dir(task_type)
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, cls.build_preset_file_name(name))
        with open(path, "w", encoding="utf-8") as writer:
            writer.write(text.strip())
        return path.replace("\\", "/")

    @classmethod
    def rename_user_preset(
        cls,
        task_type: TaskType,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        source, file_name = cls.split_virtual_id(virtual_id)
        if source != cls.PresetSource.USER:
            raise ValueError("builtin preset cannot be renamed")

        directory = cls.get_user_preset_dir(task_type)
        old_path = os.path.join(directory, file_name)
        new_file_name = cls.build_preset_file_name(new_name)
        new_path = os.path.join(directory, new_file_name)
        os.rename(old_path, new_path)

        return cls.build_preset_item(cls.PresetSource.USER, new_file_name, directory)

    @classmethod
    def delete_user_preset(cls, task_type: TaskType, virtual_id: str) -> str:
        source, file_name = cls.split_virtual_id(virtual_id)
        if source != cls.PresetSource.USER:
            raise ValueError("builtin preset cannot be deleted")

        path = os.path.join(cls.get_user_preset_dir(task_type), file_name)
        os.remove(path)
        return path.replace("\\", "/")

    @classmethod
    def get_default_preset_text(
        cls,
        task_type: TaskType,
        virtual_id: str,
    ) -> str:
        return cls.read_preset(task_type, virtual_id)
