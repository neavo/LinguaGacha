import os
import shutil
from enum import StrEnum

from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer


class PromptResourceResolver:
    """统一处理提示词模板、预设与旧目录迁移。"""

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
    def get_template_dir(
        cls,
        task_type: TaskType,
        language: BaseLanguage.Enum | None = None,
    ) -> str:
        resolved_language = language or Localizer.get_app_language()
        return os.path.join(
            "resource",
            cls.get_task_dir_name(task_type),
            "template",
            resolved_language.lower(),
        )

    @classmethod
    def get_builtin_preset_dir(cls, task_type: TaskType) -> str:
        return os.path.join("resource", cls.get_task_dir_name(task_type), "preset")

    @classmethod
    def get_user_preset_dir(cls, task_type: TaskType) -> str:
        return os.path.join("userdata", cls.get_task_dir_name(task_type))

    @classmethod
    def get_template_path(
        cls,
        task_type: TaskType,
        file_name: str,
        language: BaseLanguage.Enum | None = None,
    ) -> str:
        return os.path.join(cls.get_template_dir(task_type, language), file_name)

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
        return f"{source.value}:{file_name}"

    @classmethod
    def split_virtual_id(cls, virtual_id: str) -> tuple[PresetSource, str]:
        if not isinstance(virtual_id, str) or ":" not in virtual_id:
            raise ValueError(f"invalid virtual preset id: {virtual_id}")

        raw_source, file_name = virtual_id.split(":", 1)
        source = cls.PresetSource(raw_source)
        if not file_name or not file_name.lower().endswith(cls.PRESET_EXTENSION):
            raise ValueError(f"invalid virtual preset id: {virtual_id}")
        return source, file_name

    @classmethod
    def resolve_virtual_id_path(cls, task_type: TaskType, virtual_id: str) -> str:
        source, file_name = cls.split_virtual_id(virtual_id)
        if source == cls.PresetSource.BUILTIN:
            return os.path.join(cls.get_builtin_preset_dir(task_type), file_name)
        return os.path.join(cls.get_user_preset_dir(task_type), file_name)

    @classmethod
    def list_presets(
        cls, task_type: TaskType
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        builtin_items = cls.list_preset_items(
            task_type, cls.PresetSource.BUILTIN, cls.get_builtin_preset_dir(task_type)
        )
        user_items = cls.list_preset_items(
            task_type, cls.PresetSource.USER, cls.get_user_preset_dir(task_type)
        )
        return builtin_items, user_items

    @classmethod
    def list_preset_items(
        cls,
        task_type: TaskType,
        source: PresetSource,
        directory: str,
    ) -> list[dict[str, str]]:
        del task_type

        if source == cls.PresetSource.USER:
            os.makedirs(directory, exist_ok=True)
        elif not os.path.isdir(directory):
            return []

        items: list[dict[str, str]] = []
        for file_name in sorted(os.listdir(directory), key=str.casefold):
            if not file_name.lower().endswith(cls.PRESET_EXTENSION):
                continue

            items.append(
                {
                    "name": file_name[: -len(cls.PRESET_EXTENSION)],
                    "file_name": file_name,
                    "virtual_id": cls.build_virtual_id(source, file_name),
                    "path": os.path.join(directory, file_name).replace("\\", "/"),
                    "type": source.value,
                }
            )
        return items

    @classmethod
    def read_preset(cls, task_type: TaskType, virtual_id: str) -> str:
        path = cls.resolve_virtual_id_path(task_type, virtual_id)
        with open(path, "r", encoding="utf-8-sig") as reader:
            return reader.read().strip()

    @classmethod
    def save_user_preset(cls, task_type: TaskType, name: str, text: str) -> str:
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("preset name is empty")

        directory = cls.get_user_preset_dir(task_type)
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"{normalized_name}{cls.PRESET_EXTENSION}")
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

        normalized_name = new_name.strip()
        if not normalized_name:
            raise ValueError("preset name is empty")

        directory = cls.get_user_preset_dir(task_type)
        old_path = os.path.join(directory, file_name)
        new_file_name = f"{normalized_name}{cls.PRESET_EXTENSION}"
        new_path = os.path.join(directory, new_file_name)
        os.rename(old_path, new_path)

        return {
            "name": normalized_name,
            "file_name": new_file_name,
            "virtual_id": cls.build_virtual_id(cls.PresetSource.USER, new_file_name),
            "path": new_path.replace("\\", "/"),
            "type": cls.PresetSource.USER.value,
        }

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

    @classmethod
    def migrate_legacy_translation_user_presets(cls) -> None:
        """把旧版中英提示词用户预设搬到新的翻译提示词目录。"""

        destination_dir = cls.get_user_preset_dir(cls.TaskType.TRANSLATION)
        os.makedirs(destination_dir, exist_ok=True)

        legacy_dirs = [
            (
                os.path.join("resource", "preset", "custom_prompt", "user", "zh"),
                "zh",
            ),
            (
                os.path.join("resource", "preset", "custom_prompt", "user", "en"),
                "en",
            ),
        ]

        for source_dir, suffix in legacy_dirs:
            if not os.path.isdir(source_dir):
                continue

            for file_name in sorted(os.listdir(source_dir), key=str.casefold):
                if not file_name.lower().endswith(cls.PRESET_EXTENSION):
                    continue

                source_path = os.path.join(source_dir, file_name)
                destination_path = cls.build_migration_target_path(
                    destination_dir,
                    file_name,
                    suffix,
                )

                try:
                    shutil.move(source_path, destination_path)
                except Exception as e:
                    LogManager.get().warning(
                        f"Failed to migrate legacy custom prompt preset: {source_path}",
                        e,
                    )

    @classmethod
    def build_migration_target_path(
        cls,
        destination_dir: str,
        file_name: str,
        suffix: str,
    ) -> str:
        base_name, ext = os.path.splitext(file_name)
        candidate = os.path.join(destination_dir, file_name)
        if not os.path.exists(candidate):
            return candidate

        suffixed_name = f"{base_name}_{suffix}{ext}"
        candidate = os.path.join(destination_dir, suffixed_name)
        if not os.path.exists(candidate):
            return candidate

        index = 2
        while True:
            numbered_name = f"{base_name}_{suffix}_{index}{ext}"
            candidate = os.path.join(destination_dir, numbered_name)
            if not os.path.exists(candidate):
                return candidate
            index += 1
