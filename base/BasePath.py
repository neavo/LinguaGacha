import os
import sys
import tempfile
from pathlib import Path
from typing import ClassVar

from base.BaseLanguage import BaseLanguage


class BasePath:
    """统一管理运行时路径，避免各模块重复实现路径判定逻辑。"""

    MODULE_ROOT: ClassVar[Path] = Path(__file__).resolve().parents[1]
    HOME_DATA_ROOT_NAME: ClassVar[str] = "LinguaGacha"
    RESOURCE_DIR_NAME: ClassVar[str] = "resource"
    USER_DATA_DIR_NAME: ClassVar[str] = "userdata"
    LOG_DIR_NAME: ClassVar[str] = "log"
    TEMPLATE_DIR_NAME: ClassVar[str] = "template"
    PRESET_DIR_NAME: ClassVar[str] = "preset"
    CUSTOM_PROMPT_DIR_NAME: ClassVar[str] = "custom_prompt"
    USER_DIR_NAME: ClassVar[str] = "user"
    MODEL_DIR_NAME: ClassVar[str] = "model"
    TEXT_PRESERVE_DIR_NAME: ClassVar[str] = "text_preserve"
    GLOSSARY_DIR_NAME: ClassVar[str] = "glossary"
    PRE_TRANSLATION_REPLACEMENT_DIR_NAME: ClassVar[str] = "pre_translation_replacement"
    POST_TRANSLATION_REPLACEMENT_DIR_NAME: ClassVar[str] = (
        "post_translation_replacement"
    )
    APP_ROOT: ClassVar[str | None] = None
    DATA_ROOT: ClassVar[str | None] = None

    @classmethod
    def initialize(
        cls,
        app_root: str,
        is_frozen: bool,
    ) -> str | None:
        """启动期统一决定 APP_ROOT/DATA_ROOT，并作为进程内单一来源缓存。"""

        cls.APP_ROOT = app_root

        # 规则提醒：
        # 1. resource/ 下的是随应用分发的内置资源，始终跟随 APP_ROOT。
        # 2. config、log、userdata 等用户可写内容始终跟随 DATA_ROOT。
        # 3. 后续新增任何运行时路径规则，都必须先扩展 BasePath，再接入业务模块。
        data_root, reason = cls.resolve_data_root(app_root, is_frozen)
        cls.DATA_ROOT = data_root
        return reason

    @classmethod
    def reset_for_test(cls) -> None:
        """测试辅助：清空缓存的运行时路径，避免用例互相污染。"""

        cls.APP_ROOT = None
        cls.DATA_ROOT = None

    @classmethod
    def resolve_app_root(cls) -> str:
        """统一解析应用根目录，避免不同启动方式下路径漂移。"""

        if getattr(sys, "frozen", False):
            return os.path.dirname(os.path.abspath(sys.executable))
        return str(cls.MODULE_ROOT)

    @classmethod
    def is_appimage_runtime(cls) -> bool:
        """Linux AppImage 环境统一视为只读安装包。"""

        return os.environ.get("APPIMAGE") is not None

    @classmethod
    def is_macos_app_bundle(cls, app_root: str) -> bool:
        """macOS 正式 .app 包应始终把用户数据放到主目录。"""

        return sys.platform == "darwin" and ".app/Contents/MacOS" in app_root

    @classmethod
    def can_write_directory(cls, directory: str) -> bool:
        """通过真实创建临时文件判断目录是否可写，避免只看平台字符串误判。"""

        try:
            os.makedirs(directory, exist_ok=True)
            fd, probe_path = tempfile.mkstemp(
                prefix=".linguagacha_write_probe_",
                dir=directory,
            )
            os.close(fd)
            os.remove(probe_path)
            return True
        except Exception:
            return False

    @classmethod
    def get_home_data_root(cls) -> str:
        """统一构造主目录回退用的 DATA_ROOT 路径。"""

        return os.path.join(os.path.expanduser("~"), cls.HOME_DATA_ROOT_NAME)

    @classmethod
    def resolve_data_root(
        cls,
        app_root: str,
        is_frozen: bool,
    ) -> tuple[str, str | None]:
        """统一决定用户可写数据落点，避免只读安装目录导致启动期写入崩溃。"""

        home_data_root = cls.get_home_data_root()
        if is_frozen and cls.is_appimage_runtime():
            return home_data_root, "appimage"
        if is_frozen and cls.is_macos_app_bundle(app_root):
            return home_data_root, "macos_app_bundle"
        if cls.can_write_directory(app_root):
            return app_root, None
        return home_data_root, "app_root_not_writable"

    @classmethod
    def get_app_root(cls) -> str:
        """获取应用根路径；未初始化时回退到稳定推导结果。"""

        if cls.APP_ROOT is None:
            cls.APP_ROOT = cls.resolve_app_root()
        return cls.APP_ROOT

    @classmethod
    def get_data_root(cls) -> str:
        """获取数据根路径；未初始化时回退到 APP_ROOT，供启动早期路径派生使用。"""

        if cls.DATA_ROOT is None:
            cls.DATA_ROOT = cls.get_app_root()
        return cls.DATA_ROOT

    @classmethod
    def get_resource_dir(cls) -> str:
        """返回应用资源目录，所有内置资源都应从这里继续派生。"""

        return os.path.join(cls.get_app_root(), cls.RESOURCE_DIR_NAME)

    @classmethod
    def get_resource_relative_dir(cls, *parts: str) -> str:
        """返回资源相对目录，用于仍需保留相对展示值的场景。"""

        return os.path.join(cls.RESOURCE_DIR_NAME, *parts)

    @classmethod
    def get_resource_path(cls, *parts: str) -> str:
        """统一拼接资源路径，避免各模块重复追加 resource 根目录。"""

        return os.path.join(cls.get_resource_dir(), *parts)

    @classmethod
    def get_user_data_path(cls, *parts: str) -> str:
        """统一拼接 userdata 下的用户数据路径。"""

        return os.path.join(cls.get_user_data_root_dir(), *parts)

    @classmethod
    def get_language_dir_name(cls, language: BaseLanguage.Enum) -> str:
        """统一把语言枚举转换成目录名，避免各模块各自 lower。"""

        return str(language).lower()

    @classmethod
    def get_log_dir(cls) -> str:
        """根据统一路径规则返回日志目录。"""

        return os.path.join(cls.get_data_root(), cls.LOG_DIR_NAME)

    @classmethod
    def get_user_data_root_dir(cls) -> str:
        """返回 DATA_ROOT 下的 userdata 目录。"""

        return os.path.join(cls.get_data_root(), cls.USER_DATA_DIR_NAME)

    @classmethod
    def get_prompt_user_preset_dir(cls, task_dir_name: str) -> str:
        """返回提示词用户预设目录。"""

        return cls.get_user_data_path(task_dir_name)

    @classmethod
    def get_prompt_template_dir(
        cls,
        task_dir_name: str,
        language: BaseLanguage.Enum,
    ) -> str:
        """返回提示词模板目录。"""

        return cls.get_resource_path(
            task_dir_name,
            cls.TEMPLATE_DIR_NAME,
            cls.get_language_dir_name(language),
        )

    @classmethod
    def get_prompt_builtin_preset_dir(cls, task_dir_name: str) -> str:
        """返回内置提示词预设目录。"""

        return cls.get_resource_path(task_dir_name, cls.PRESET_DIR_NAME)

    @classmethod
    def get_prompt_builtin_preset_relative_dir(cls, task_dir_name: str) -> str:
        """返回内置提示词预设的相对目录，用于界面展示。"""

        return cls.get_resource_relative_dir(task_dir_name, cls.PRESET_DIR_NAME)

    @classmethod
    def get_prompt_legacy_user_preset_dir(cls, language: BaseLanguage.Enum) -> str:
        """返回旧版翻译提示词用户预设目录，用于启动迁移。"""

        return cls.get_resource_path(
            cls.PRESET_DIR_NAME,
            cls.CUSTOM_PROMPT_DIR_NAME,
            cls.USER_DIR_NAME,
            cls.get_language_dir_name(language),
        )

    @classmethod
    def get_quality_rule_builtin_preset_dir(
        cls,
        preset_dir_name: str,
    ) -> str:
        """返回质量规则内置预设目录。"""

        return cls.get_resource_path(preset_dir_name, cls.PRESET_DIR_NAME)

    @classmethod
    def get_quality_rule_builtin_preset_relative_dir(
        cls,
        preset_dir_name: str,
    ) -> str:
        """返回质量规则内置预设相对目录，用于界面展示。"""

        return cls.get_resource_relative_dir(preset_dir_name, cls.PRESET_DIR_NAME)

    @classmethod
    def get_quality_rule_user_preset_dir(cls, preset_dir_name: str) -> str:
        """返回质量规则用户预设目录。"""

        return cls.get_user_data_path(preset_dir_name)

    @classmethod
    def get_quality_rule_legacy_user_preset_dir(cls, preset_dir_name: str) -> str:
        """返回旧版质量规则用户预设目录，用于启动迁移。"""

        return cls.get_resource_path(
            cls.PRESET_DIR_NAME,
            preset_dir_name,
            cls.USER_DIR_NAME,
        )

    @classmethod
    def get_quality_rule_legacy_builtin_preset_dir(
        cls,
        preset_dir_name: str,
        language: BaseLanguage.Enum,
    ) -> str:
        """返回旧版质量规则内置预设目录，用于启动迁移。"""

        return cls.get_resource_path(
            cls.PRESET_DIR_NAME,
            preset_dir_name,
            cls.get_language_dir_name(language),
        )

    @classmethod
    def get_model_preset_dir(cls) -> str:
        """返回单套内置模型预设目录。"""

        return cls.get_resource_path(
            cls.MODEL_DIR_NAME,
            cls.PRESET_DIR_NAME,
        )

    @classmethod
    def get_text_preserve_preset_dir(cls) -> str:
        """返回文本保护预设目录。"""

        return cls.get_quality_rule_builtin_preset_dir(
            cls.TEXT_PRESERVE_DIR_NAME,
        )
