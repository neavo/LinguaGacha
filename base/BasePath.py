import os
import sys
import tempfile
from pathlib import Path
from typing import ClassVar

from base.BaseLanguage import BaseLanguage


class BasePath:
    """统一管理运行时路径，避免各模块重复实现路径判定逻辑。"""

    MODULE_ROOT: ClassVar[Path] = Path(__file__).resolve().parents[1]
    DATA_DIR_NAME: ClassVar[str] = "LinguaGacha"
    RESOURCE_DIR_NAME: ClassVar[str] = "resource"
    USER_DATA_DIR_NAME: ClassVar[str] = "userdata"
    UPDATE_DIR_NAME: ClassVar[str] = "update"
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
    APP_DIR: ClassVar[str | None] = None
    DATA_DIR: ClassVar[str | None] = None

    @classmethod
    def initialize(
        cls,
        app_dir: str,
        is_frozen: bool,
    ) -> str | None:
        """启动期统一决定 app_dir/data_dir，并作为进程内单一来源缓存。"""

        cls.APP_DIR = app_dir

        # 规则提醒：
        # 1. resource/ 下的是随应用分发的内置资源，始终跟随 app_dir。
        # 2. config、log、userdata 等用户可写内容始终跟随 data_dir。
        # 3. 后续新增任何运行时路径规则，都必须先扩展 BasePath，再接入业务模块。
        data_dir, reason = cls.resolve_data_dir(app_dir, is_frozen)
        cls.DATA_DIR = data_dir
        return reason

    @classmethod
    def reset_for_test(cls) -> None:
        """测试辅助：清空缓存的运行时路径，避免用例互相污染。"""

        cls.APP_DIR = None
        cls.DATA_DIR = None

    @classmethod
    def resolve_app_dir(cls) -> str:
        """统一解析应用根目录，避免不同启动方式下路径漂移。"""

        if getattr(sys, "frozen", False):
            return os.path.dirname(os.path.abspath(sys.executable))
        return str(cls.MODULE_ROOT)

    @classmethod
    def is_appimage_runtime(cls) -> bool:
        """Linux AppImage 环境统一视为只读安装包。"""

        return os.environ.get("APPIMAGE") is not None

    @classmethod
    def is_macos_app_bundle(cls, app_dir: str) -> bool:
        """macOS 正式 .app 包应始终把用户数据放到主目录。"""

        return sys.platform == "darwin" and ".app/Contents/MacOS" in app_dir

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
    def get_home_data_dir(cls) -> str:
        """统一构造 LinguaGacha 的主目录数据路径。"""

        return os.path.join(os.path.expanduser("~"), cls.DATA_DIR_NAME)

    @classmethod
    def resolve_data_dir(
        cls,
        app_dir: str,
        is_frozen: bool,
    ) -> tuple[str, str | None]:
        """统一决定用户可写数据落点，避免只读安装目录导致启动期写入崩溃。"""

        home_data_dir = cls.get_home_data_dir()
        if is_frozen and cls.is_appimage_runtime():
            return home_data_dir, "appimage"
        if is_frozen and cls.is_macos_app_bundle(app_dir):
            return home_data_dir, "macos_app_bundle"
        if cls.can_write_directory(app_dir):
            return app_dir, None
        return home_data_dir, "app_dir_not_writable"

    @classmethod
    def get_app_dir(cls) -> str:
        """获取应用目录；未初始化时回退到稳定推导结果。"""

        if cls.APP_DIR is None:
            cls.APP_DIR = cls.resolve_app_dir()
        return cls.APP_DIR

    @classmethod
    def get_data_dir(cls) -> str:
        """获取用户数据目录；未初始化时回退到应用目录，供启动早期资源读取使用。"""

        if cls.DATA_DIR is None:
            cls.DATA_DIR = cls.get_app_dir()
        return cls.DATA_DIR

    @classmethod
    def get_resource_dir(cls) -> str:
        """返回应用资源目录，所有内置资源都应从这里继续派生。"""

        return os.path.join(cls.get_app_dir(), cls.RESOURCE_DIR_NAME)

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
        """统一拼接用户数据路径，确保所有可写数据都挂在 userdata 下。"""

        return os.path.join(cls.get_user_data_root_dir(), *parts)

    @classmethod
    def get_language_dir_name(cls, language: BaseLanguage.Enum) -> str:
        """统一把语言枚举转换成目录名，避免各模块各自 lower。"""

        return str(language).lower()

    @classmethod
    def get_log_dir(cls) -> str:
        """根据统一路径规则返回日志目录。"""

        return os.path.join(cls.get_data_dir(), cls.LOG_DIR_NAME)

    @classmethod
    def get_user_data_root_dir(cls) -> str:
        """返回统一的用户可写数据根目录。"""

        return os.path.join(cls.get_data_dir(), cls.USER_DATA_DIR_NAME)

    @classmethod
    def get_update_template_dir(cls) -> str:
        """返回只读更新脚本模板目录。"""

        return cls.get_resource_path(cls.UPDATE_DIR_NAME)

    @classmethod
    def get_update_runtime_dir(cls) -> str:
        """返回更新器运行时产物目录。"""

        return cls.get_user_data_path(cls.UPDATE_DIR_NAME)

    @classmethod
    def get_update_legacy_runtime_dir(cls) -> str:
        """返回旧版更新运行时目录，用于启动迁移与兼容清理。"""

        return cls.get_resource_path(cls.UPDATE_DIR_NAME)

    @classmethod
    def get_update_dir(cls) -> str:
        """兼容旧调用方：默认返回新的更新运行时目录。"""

        return cls.get_update_runtime_dir()

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
    def get_model_preset_dir(cls, language: BaseLanguage.Enum) -> str:
        """根据 UI 语言返回模型预设目录。"""

        lang_dir = "zh" if language == BaseLanguage.Enum.ZH else "en"
        return cls.get_resource_path(
            cls.PRESET_DIR_NAME,
            cls.MODEL_DIR_NAME,
            lang_dir,
        )

    @classmethod
    def get_text_preserve_preset_dir(cls) -> str:
        """返回文本保护预设目录。"""

        return cls.get_quality_rule_builtin_preset_dir(
            cls.TEXT_PRESERVE_DIR_NAME,
        )
