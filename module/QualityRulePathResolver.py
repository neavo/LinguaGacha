import os
from enum import StrEnum

from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath


class QualityRulePathResolver:
    """统一处理质量规则预设的路径、读写与标识解析。"""

    class PresetSource(StrEnum):
        BUILTIN = "builtin"
        USER = "user"

    PRESET_EXTENSION: str = ".json"
    LEGACY_VIRTUAL_ID_PART_COUNT: int = 3

    @classmethod
    def normalize_preset_name(cls, name: str) -> str:
        """统一清理用户输入的预设名，避免保存/重命名各自 trim。"""

        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("preset name is empty")
        return normalized_name

    @classmethod
    def ensure_preset_file_name(cls, file_name: str, raw_value: str) -> str:
        """统一校验 JSON 预设文件名，避免多个入口各自判断扩展名。"""

        if not file_name.lower().endswith(cls.PRESET_EXTENSION):
            raise ValueError(f"invalid virtual preset id: {raw_value}")
        return file_name

    @classmethod
    def build_preset_file_name(cls, name: str) -> str:
        """统一从预设名生成文件名，避免扩展名拼接散落。"""

        return f"{cls.normalize_preset_name(name)}{cls.PRESET_EXTENSION}"

    @classmethod
    def get_builtin_preset_dir(cls, preset_dir_name: str) -> str:
        """返回质量规则内置预设目录。"""

        return BasePath.get_quality_rule_builtin_preset_dir(preset_dir_name)

    @classmethod
    def get_builtin_preset_relative_dir(cls, preset_dir_name: str) -> str:
        """返回质量规则内置预设相对目录，用于界面展示。"""

        return BasePath.get_quality_rule_builtin_preset_relative_dir(preset_dir_name)

    @classmethod
    def get_user_preset_dir(cls, preset_dir_name: str) -> str:
        """返回质量规则用户预设目录。"""

        return BasePath.get_quality_rule_user_preset_dir(preset_dir_name)

    @classmethod
    def get_legacy_user_preset_dir(cls, preset_dir_name: str) -> str:
        """返回旧版质量规则用户预设目录，用于启动迁移。"""

        return BasePath.get_quality_rule_legacy_user_preset_dir(preset_dir_name)

    @classmethod
    def get_legacy_builtin_preset_dir(
        cls,
        preset_dir_name: str,
        language: BaseLanguage.Enum,
    ) -> str:
        """返回旧版质量规则内置预设目录，用于启动迁移。"""

        return BasePath.get_quality_rule_legacy_builtin_preset_dir(
            preset_dir_name,
            language,
        )

    @classmethod
    def get_layered_builtin_preset_dir(
        cls,
        preset_dir_name: str,
        language: BaseLanguage.Enum,
    ) -> str:
        """返回上一版带语言层的 builtin 目录，用于启动迁移与配置兼容。"""

        return BasePath.get_resource_path(
            preset_dir_name,
            BasePath.PRESET_DIR_NAME,
            BasePath.get_language_dir_name(language),
        )

    @classmethod
    def build_virtual_id(
        cls,
        source: PresetSource,
        file_name: str,
    ) -> str:
        cls.ensure_preset_file_name(file_name, file_name)
        return f"{source.value}:{file_name}"

    @classmethod
    def split_virtual_id(
        cls,
        virtual_id: str,
    ) -> tuple[PresetSource, str]:
        if not isinstance(virtual_id, str) or ":" not in virtual_id:
            raise ValueError(f"invalid virtual preset id: {virtual_id}")

        parts = virtual_id.split(":")
        if len(parts) == 2:
            raw_source, file_name = parts
            source = cls.PresetSource(raw_source)
            cls.ensure_preset_file_name(file_name, virtual_id)
            return source, file_name

        if len(parts) == cls.LEGACY_VIRTUAL_ID_PART_COUNT:
            raw_source, raw_language, file_name = parts
            source = cls.PresetSource(raw_source)
            if source != cls.PresetSource.BUILTIN:
                raise ValueError(f"invalid virtual preset id: {virtual_id}")
            BaseLanguage.Enum(raw_language.upper())
            cls.ensure_preset_file_name(file_name, virtual_id)
            return source, file_name

        raise ValueError(f"invalid virtual preset id: {virtual_id}")

    @classmethod
    def build_preset_item(
        cls,
        source: PresetSource,
        file_name: str,
        path_dir: str,
    ) -> dict[str, str]:
        """统一构造预设列表项，避免各页面展示字段漂移。"""

        return {
            "name": file_name[: -len(cls.PRESET_EXTENSION)],
            "file_name": file_name,
            "virtual_id": cls.build_virtual_id(source, file_name),
            "path": os.path.join(path_dir, file_name).replace("\\", "/"),
            "type": source.value,
        }

    @classmethod
    def list_presets(
        cls,
        preset_dir_name: str,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        builtin_items = cls.list_preset_items(
            source=cls.PresetSource.BUILTIN,
            directory=cls.get_builtin_preset_dir(preset_dir_name),
            resolved_path_dir=cls.get_builtin_preset_relative_dir(preset_dir_name),
        )
        user_items = cls.list_preset_items(
            source=cls.PresetSource.USER,
            directory=cls.get_user_preset_dir(preset_dir_name),
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

            items.append(
                cls.build_preset_item(
                    source,
                    file_name,
                    resolved_path_dir,
                )
            )
        return items

    @classmethod
    def get_preset_dir(cls, preset_dir_name: str, source: PresetSource) -> str:
        """统一按来源获取目录，避免 builtin/user 分支散在各方法里。"""

        if source == cls.PresetSource.BUILTIN:
            return cls.get_builtin_preset_dir(preset_dir_name)
        return cls.get_user_preset_dir(preset_dir_name)

    @classmethod
    def resolve_virtual_id_path(
        cls,
        preset_dir_name: str,
        virtual_id: str,
    ) -> str:
        source, file_name = cls.split_virtual_id(virtual_id)
        return os.path.join(cls.get_preset_dir(preset_dir_name, source), file_name)

    @classmethod
    def read_preset(
        cls,
        preset_dir_name: str,
        virtual_id: str,
    ) -> list[dict[str, object]]:
        path = cls.resolve_virtual_id_path(preset_dir_name, virtual_id)
        from module.Utils.JSONTool import JSONTool

        data = JSONTool.load_file(path)
        if not isinstance(data, list):
            raise ValueError(f"invalid quality preset payload: {path}")
        return data

    @classmethod
    def save_user_preset(
        cls,
        preset_dir_name: str,
        name: str,
        data: list[dict[str, object]],
    ) -> dict[str, str]:
        directory = cls.get_user_preset_dir(preset_dir_name)
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, cls.build_preset_file_name(name))

        from module.Utils.JSONTool import JSONTool

        JSONTool.save_file(path, data, indent=4)
        return cls.build_preset_item(
            cls.PresetSource.USER,
            os.path.basename(path),
            directory,
        )

    @classmethod
    def rename_user_preset(
        cls,
        preset_dir_name: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        source, file_name = cls.split_virtual_id(virtual_id)
        if source != cls.PresetSource.USER:
            raise ValueError("builtin preset cannot be renamed")

        directory = cls.get_user_preset_dir(preset_dir_name)
        old_path = os.path.join(directory, file_name)
        new_file_name = cls.build_preset_file_name(new_name)
        new_path = os.path.join(directory, new_file_name)
        os.rename(old_path, new_path)
        return cls.build_preset_item(cls.PresetSource.USER, new_file_name, directory)

    @classmethod
    def delete_user_preset(
        cls,
        preset_dir_name: str,
        virtual_id: str,
    ) -> str:
        source, file_name = cls.split_virtual_id(virtual_id)
        if source != cls.PresetSource.USER:
            raise ValueError("builtin preset cannot be deleted")

        path = os.path.join(cls.get_user_preset_dir(preset_dir_name), file_name)
        os.remove(path)
        return path.replace("\\", "/")
