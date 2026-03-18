import os
import shutil
from pathlib import Path
from typing import Any

from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath
from base.LogManager import LogManager
from module.PromptPathResolver import PromptPathResolver
from module.QualityRulePathResolver import QualityRulePathResolver
from module.Utils.JSONTool import JSONTool


class UserDataMigrationService:
    """统一承接 userdata 迁移与配置归一化，便于后续整块移除。"""

    # 这里只处理质量规则默认预设的配置归一化。
    # 提示词默认预设在更早一版已经把字段从 custom_prompt_zh/en_default_preset
    # 改成了 translation/analysis_custom_prompt_default_preset，但当时没有提供旧字段
    # 到新字段的数据迁移逻辑。也就是说，旧提示词默认预设配置在那次升级时就已
    # 经被显式放弃，因此这里不再补做“旧值 -> 新虚拟 ID”的格式转换。
    # 质量规则 builtin 在本轮已进一步拉平为 resource/<type>/preset/*.json，
    # 因此这里还需要兼容更早的 language 子目录与旧版 builtin:<lang>:file.json。
    QUALITY_RULE_PRESET_CONFIG_KEYS: dict[str, str] = {
        "glossary_default_preset": BasePath.GLOSSARY_DIR_NAME,
        "text_preserve_default_preset": BasePath.TEXT_PRESERVE_DIR_NAME,
        "pre_translation_replacement_default_preset": (
            BasePath.PRE_TRANSLATION_REPLACEMENT_DIR_NAME
        ),
        "post_translation_replacement_default_preset": (
            BasePath.POST_TRANSLATION_REPLACEMENT_DIR_NAME
        ),
    }
    QUALITY_RULE_PRESET_DIR_NAMES: tuple[str, ...] = tuple(
        QUALITY_RULE_PRESET_CONFIG_KEYS.values()
    )
    UPDATE_RUNTIME_FILE_NAMES: tuple[str, ...] = (
        "app.zip.temp",
        "update.log",
        ".lock",
        "result.json",
        "update.runtime.ps1",
    )
    UPDATE_RUNTIME_DIR_NAMES: tuple[str, ...] = ("stage", "backup")

    @classmethod
    def run_startup_migrations(cls) -> None:
        """统一执行启动期目录迁移，保持入口单一。"""

        cls.migrate_default_config_if_needed()
        cls.migrate_prompt_user_presets()
        cls.migrate_quality_rule_user_presets()
        cls.migrate_quality_rule_builtin_layout()
        cls.migrate_update_runtime_artifacts_if_needed()
        cls.normalize_default_preset_config_values()

    @classmethod
    def migrate_default_config_if_needed(cls) -> None:
        """把旧默认配置复制到 userdata，后续统一只读新位置。"""

        from module.Config import Config

        Config.migrate_default_config_if_needed(Config.get_default_path())

    @classmethod
    def migrate_prompt_user_presets(cls) -> None:
        """把旧版翻译提示词用户预设迁到新的 userdata 目录。"""

        destination_dir = PromptPathResolver.get_user_preset_dir(
            PromptPathResolver.TaskType.TRANSLATION
        )
        os.makedirs(destination_dir, exist_ok=True)

        for source_dir in PromptPathResolver.get_legacy_user_preset_dirs():
            cls.move_directory_items(
                source_dir=source_dir,
                destination_dir=destination_dir,
                extension=PromptPathResolver.PRESET_EXTENSION,
            )

    @classmethod
    def migrate_quality_rule_user_presets(cls) -> None:
        """把旧版质量规则用户预设迁到新的 userdata 目录。"""

        for preset_dir_name in cls.QUALITY_RULE_PRESET_DIR_NAMES:
            source_dir = QualityRulePathResolver.get_legacy_user_preset_dir(
                preset_dir_name
            )
            destination_dir = QualityRulePathResolver.get_user_preset_dir(
                preset_dir_name
            )
            os.makedirs(destination_dir, exist_ok=True)
            cls.move_directory_items(
                source_dir=source_dir,
                destination_dir=destination_dir,
                extension=QualityRulePathResolver.PRESET_EXTENSION,
            )

    @classmethod
    def migrate_quality_rule_builtin_layout(cls) -> None:
        """把旧版质量规则内置预设目录迁到新的 resource 结构。"""

        for preset_dir_name in cls.QUALITY_RULE_PRESET_DIR_NAMES:
            destination_dir = QualityRulePathResolver.get_builtin_preset_dir(
                preset_dir_name,
            )
            os.makedirs(destination_dir, exist_ok=True)
            for source_dir in cls.iter_quality_rule_builtin_source_dirs(
                preset_dir_name
            ):
                cls.move_directory_items(
                    source_dir=source_dir,
                    destination_dir=destination_dir,
                    extension=QualityRulePathResolver.PRESET_EXTENSION,
                )

    @classmethod
    def migrate_update_runtime_artifacts_if_needed(cls) -> None:
        """把旧版 resource/update 下的运行时产物迁到 userdata/update。"""

        legacy_dir = BasePath.get_update_legacy_runtime_dir()
        runtime_dir = BasePath.get_update_runtime_dir()
        os.makedirs(runtime_dir, exist_ok=True)

        for file_name in cls.UPDATE_RUNTIME_FILE_NAMES:
            cls.move_path_if_needed(
                source_path=os.path.join(legacy_dir, file_name),
                destination_path=os.path.join(runtime_dir, file_name),
            )

        for dir_name in cls.UPDATE_RUNTIME_DIR_NAMES:
            cls.move_path_if_needed(
                source_path=os.path.join(legacy_dir, dir_name),
                destination_path=os.path.join(runtime_dir, dir_name),
            )

    @classmethod
    def iter_quality_rule_builtin_source_dirs(
        cls,
        preset_dir_name: str,
    ) -> tuple[str, ...]:
        """统一列出所有历史内置预设目录，避免迁移和归一化各写一遍。"""

        directories: list[str] = []
        for language in (BaseLanguage.Enum.ZH, BaseLanguage.Enum.EN):
            directories.append(
                QualityRulePathResolver.get_layered_builtin_preset_dir(
                    preset_dir_name,
                    language,
                )
            )
            directories.append(
                QualityRulePathResolver.get_legacy_builtin_preset_dir(
                    preset_dir_name,
                    language,
                )
            )
        return tuple(directories)

    @classmethod
    def resolve_quality_rule_virtual_id_from_path(
        cls,
        preset_dir_name: str,
        file_name: str,
        value: str,
    ) -> str:
        """把旧路径解析成虚拟 ID，避免用户目录和内置目录判断分散。"""

        candidate_groups: tuple[
            tuple[QualityRulePathResolver.PresetSource, tuple[str, ...]], ...
        ] = (
            (
                QualityRulePathResolver.PresetSource.USER,
                (
                    QualityRulePathResolver.get_user_preset_dir(preset_dir_name),
                    QualityRulePathResolver.get_legacy_user_preset_dir(preset_dir_name),
                ),
            ),
            (
                QualityRulePathResolver.PresetSource.BUILTIN,
                (
                    QualityRulePathResolver.get_builtin_preset_dir(preset_dir_name),
                    *cls.iter_quality_rule_builtin_source_dirs(preset_dir_name),
                ),
            ),
        )

        raw_dir = os.path.dirname(value)
        for source, directories in candidate_groups:
            for directory in directories:
                if cls.is_same_directory(raw_dir, directory):
                    return QualityRulePathResolver.build_virtual_id(source, file_name)

        raise ValueError("unrecognized preset path")

    @classmethod
    def move_directory_items(
        cls,
        source_dir: str,
        destination_dir: str,
        extension: str,
    ) -> None:
        """把目录中的同类文件迁走；若目标同名已存在，则直接删除旧文件。"""

        if not os.path.isdir(source_dir):
            return

        for file_name in sorted(os.listdir(source_dir), key=str.casefold):
            if not file_name.lower().endswith(extension):
                continue

            cls.move_path_if_needed(
                source_path=os.path.join(source_dir, file_name),
                destination_path=os.path.join(destination_dir, file_name),
            )

        cls.remove_empty_directory(source_dir)

    @classmethod
    def move_path_if_needed(cls, source_path: str, destination_path: str) -> None:
        """迁移单个文件或目录；若目标已存在，则保留目标并删除旧路径。"""

        if not os.path.exists(source_path):
            return

        source = Path(source_path)
        destination = Path(destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)

        try:
            if destination.exists():
                cls.remove_path(source)
            else:
                shutil.move(str(source), str(destination))
        except Exception as e:
            LogManager.get().warning(
                f"Failed to migrate path: {source_path} -> {destination_path}",
                e,
            )

    @classmethod
    def remove_empty_directory(cls, directory: str) -> None:
        """递归清理迁移后留下的空目录。"""

        current = Path(directory)
        while current.exists() and current.is_dir():
            try:
                current.rmdir()
            except OSError:
                return
            current = current.parent

    @classmethod
    def remove_path(cls, path: Path) -> None:
        """删除旧路径，规则固定为目录递归删、文件直接删。"""

        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()

    @classmethod
    def normalize_config_payload(
        cls,
        config_data: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        """把旧版默认预设路径归一化成新的虚拟 ID。"""

        normalized = dict(config_data)
        changed = False

        for config_key, preset_dir_name in cls.QUALITY_RULE_PRESET_CONFIG_KEYS.items():
            current_value = normalized.get(config_key, "")
            if not isinstance(current_value, str) or not current_value:
                continue

            resolved_value = cls.normalize_quality_rule_default_preset_value(
                preset_dir_name,
                current_value,
            )
            if resolved_value != current_value:
                normalized[config_key] = resolved_value
                changed = True

        return normalized, changed

    @classmethod
    def normalize_default_preset_config_values(cls) -> None:
        """启动期一次性归一化默认配置里的旧预设路径。"""

        from module.Config import Config

        config_path = Config.get_default_path()
        if not os.path.isfile(config_path):
            return

        try:
            config_data = JSONTool.load_file(config_path)
            if not isinstance(config_data, dict):
                return

            normalized_config, changed = cls.normalize_config_payload(config_data)
            if not changed:
                return

            JSONTool.save_file(config_path, normalized_config, indent=4)
        except Exception as e:
            LogManager.get().warning(
                f"Failed to normalize default preset config values: {config_path}",
                e,
            )

    @classmethod
    def normalize_quality_rule_default_preset_value(
        cls,
        preset_dir_name: str,
        value: str,
    ) -> str:
        """把旧路径或新路径统一转换成稳定的虚拟 ID。"""

        if value == "":
            return value

        try:
            source, file_name = QualityRulePathResolver.split_virtual_id(value)
            return QualityRulePathResolver.build_virtual_id(source, file_name)
        except Exception:
            pass

        file_name = os.path.basename(value)
        if not file_name.lower().endswith(QualityRulePathResolver.PRESET_EXTENSION):
            LogManager.get().warning(
                f"Failed to normalize default preset value: {preset_dir_name} -> {value}",
                ValueError("invalid preset file name"),
            )
            return ""

        try:
            return cls.resolve_quality_rule_virtual_id_from_path(
                preset_dir_name,
                file_name,
                value,
            )
        except ValueError as e:
            LogManager.get().warning(
                f"Failed to normalize default preset value: {preset_dir_name} -> {value}",
                e,
            )
            return ""

    @classmethod
    def is_same_directory(cls, raw_dir: str, expected_dir: str) -> bool:
        """兼容绝对路径与相对路径，统一判断目录是否指向同一位置。"""

        raw_dir_normalized = os.path.normcase(os.path.normpath(raw_dir))
        candidate_dirs = {os.path.normcase(os.path.normpath(expected_dir))}

        for base_dir in (BasePath.get_app_dir(), BasePath.get_data_dir()):
            try:
                relative_dir = os.path.relpath(expected_dir, base_dir)
            except ValueError:
                continue
            candidate_dirs.add(os.path.normcase(os.path.normpath(relative_dir)))

        return raw_dir_normalized in candidate_dirs
