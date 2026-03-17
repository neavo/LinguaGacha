from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar
from typing import Self

from base.LogManager import LogManager


@dataclass(frozen=True)
class BrandDocsRoutes:
    """收口品牌相关帮助与跳转链接，避免页面各自写死仓库地址。"""

    quality_help_url: str
    thinking_support_url_zh: str
    thinking_support_url_en: str
    glossary_tool_url: str | None = None


@dataclass(frozen=True)
class BrandWorkbenchFlags:
    """统一描述工作台在不同品牌中的显隐差异。"""

    show_translation_export: bool
    show_translation_stats: bool
    show_translation_reset: bool


@dataclass(frozen=True)
class BrandBuildNames:
    """统一管理不同平台下的品牌应用名与打包命名。"""

    app_name: str
    dist_dir_name: str
    macos_bundle_name: str
    linux_desktop_name: str
    linux_icon_name: str
    bundle_identifier: str


@dataclass(frozen=True)
class BaseBrand:
    """统一定义 LG/KG 两个品牌的稳定元信息。"""

    brand_id: str
    app_name: str
    repo_url: str
    release_api_url: str
    release_url: str
    user_agent_name: str
    project_display_name: str
    data_dir_name: str
    enabled_pages: frozenset[str]
    workbench_flags: BrandWorkbenchFlags
    docs_routes: BrandDocsRoutes
    build_names: BrandBuildNames
    enable_app_update: bool = True

    DEFAULT_BRAND_ID: ClassVar[str] = "lg"
    CURRENT_BRAND_ID: ClassVar[str | None] = None
    BUNDLED_BRAND_RELATIVE_PATH: ClassVar[Path] = Path("resource") / "brand.txt"

    @classmethod
    def normalize_brand_id(cls, brand_id: str | None) -> str | None:
        """把外部输入统一规整成受支持的品牌标识。"""

        if not isinstance(brand_id, str):
            return None

        normalized = brand_id.strip().lower()
        if normalized in {"lg", "kg"}:
            return normalized
        return None

    @classmethod
    def set_current_brand_id(cls, brand_id: str | None) -> None:
        """把启动阶段已决的品牌写入进程内单一来源。"""

        normalized_brand_id = cls.normalize_brand_id(brand_id)
        if normalized_brand_id is None:
            normalized_brand_id = cls.DEFAULT_BRAND_ID
        cls.CURRENT_BRAND_ID = normalized_brand_id

    @classmethod
    def get_current_brand_id(cls) -> str:
        """统一读取当前进程内品牌，未初始化时回退到默认值。"""

        if cls.CURRENT_BRAND_ID is None:
            return cls.DEFAULT_BRAND_ID
        return cls.CURRENT_BRAND_ID

    @classmethod
    def read_bundled_brand_id(cls, app_dir: str) -> str | None:
        """正式包只认随包分发的品牌文件，避免被目录名或参数误导。"""

        bundled_brand_path = Path(app_dir) / cls.BUNDLED_BRAND_RELATIVE_PATH
        try:
            if not bundled_brand_path.is_file():
                LogManager.get().warning(
                    f"Bundled brand file missing: {bundled_brand_path}"
                )
                return None

            bundled_brand_id = cls.normalize_brand_id(
                bundled_brand_path.read_text(encoding="utf-8-sig").strip()
            )
            if bundled_brand_id is None:
                LogManager.get().warning(
                    f"Bundled brand file invalid: {bundled_brand_path}"
                )
                return None

            return bundled_brand_id
        except Exception as e:
            LogManager.get().warning(
                f"Failed to read bundled brand file: {bundled_brand_path}",
                e,
            )
            return None

    @classmethod
    def resolve_runtime_brand_id(
        cls,
        explicit_brand_id: str | None,
        app_dir: str,
        is_frozen: bool,
    ) -> str:
        """启动时只解析一次品牌，保证后续模块读取同一个结果。"""

        normalized_brand_id = cls.normalize_brand_id(explicit_brand_id)
        if not is_frozen:
            if normalized_brand_id is not None:
                return normalized_brand_id
            return cls.DEFAULT_BRAND_ID

        bundled_brand_id = cls.read_bundled_brand_id(app_dir)
        if bundled_brand_id is not None:
            return bundled_brand_id
        return cls.DEFAULT_BRAND_ID

    @classmethod
    def get(cls, brand_id: str | None = None) -> Self:
        """获取当前品牌档案；显式传参优先，其余只读进程内已决状态。"""

        resolved_brand_id = cls.normalize_brand_id(brand_id)
        if resolved_brand_id is None:
            resolved_brand_id = cls.get_current_brand_id()
        return BRAND_PROFILES[resolved_brand_id]

    def is_page_enabled(self, page_name: str) -> bool:
        """页面显隐统一从品牌档案读取，避免 UI 层散落条件判断。"""

        return page_name in self.enabled_pages


BRAND_PROFILES: dict[str, BaseBrand] = {
    "lg": BaseBrand(
        brand_id="lg",
        app_name="LinguaGacha",
        repo_url="https://github.com/neavo/LinguaGacha",
        release_api_url="https://api.github.com/repos/neavo/LinguaGacha/releases/latest",
        release_url="https://github.com/neavo/LinguaGacha/releases/latest",
        user_agent_name="LinguaGacha",
        project_display_name="LinguaGacha",
        data_dir_name="LinguaGacha",
        enabled_pages=frozenset(
            {
                "model_page",
                "translation_page",
                "analysis_page",
                "proofreading_page",
                "workbench_page",
                "basic_settings_page",
                "expert_settings_page",
                "glossary_page",
                "text_preserve_page",
                "replacement_page",
                "pre_translation_replacement_page",
                "post_translation_replacement_page",
                "custom_prompt_page",
                "translation_prompt_page",
                "analysis_prompt_page",
                "laboratory_page",
                "tool_box_page",
                "name_field_extraction_page",
                "ts_conversion_page",
                "app_settings_page",
            }
        ),
        workbench_flags=BrandWorkbenchFlags(
            show_translation_export=True,
            show_translation_stats=True,
            show_translation_reset=True,
        ),
        docs_routes=BrandDocsRoutes(
            quality_help_url="https://github.com/neavo/LinguaGacha/wiki",
            thinking_support_url_zh="https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupport",
            thinking_support_url_en="https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupportEN",
            glossary_tool_url="https://github.com/neavo/KeywordGacha",
        ),
        build_names=BrandBuildNames(
            app_name="LinguaGacha",
            dist_dir_name="LinguaGacha",
            macos_bundle_name="LinguaGacha.app",
            linux_desktop_name="linguagacha",
            linux_icon_name="linguagacha",
            bundle_identifier="me.neavo.linguagacha",
        ),
    ),
    "kg": BaseBrand(
        brand_id="kg",
        app_name="KeywordGacha",
        repo_url="https://github.com/neavo/KeywordGacha",
        release_api_url="https://api.github.com/repos/neavo/KeywordGacha/releases/latest",
        release_url="https://github.com/neavo/KeywordGacha/releases/latest",
        user_agent_name="KeywordGacha",
        project_display_name="KeywordGacha",
        data_dir_name="KeywordGacha",
        enabled_pages=frozenset(
            {
                "model_page",
                "analysis_page",
                "workbench_page",
                "basic_settings_page",
                "glossary_page",
                "custom_prompt_page",
                "analysis_prompt_page",
                "app_settings_page",
            }
        ),
        workbench_flags=BrandWorkbenchFlags(
            show_translation_export=False,
            show_translation_stats=False,
            show_translation_reset=False,
        ),
        docs_routes=BrandDocsRoutes(
            quality_help_url="https://github.com/neavo/KeywordGacha",
            thinking_support_url_zh="https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupport",
            thinking_support_url_en="https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupportEN",
            glossary_tool_url=None,
        ),
        build_names=BrandBuildNames(
            app_name="KeywordGacha",
            dist_dir_name="KeywordGacha",
            macos_bundle_name="KeywordGacha.app",
            linux_desktop_name="keywordgacha",
            linux_icon_name="keywordgacha",
            bundle_identifier="me.neavo.keywordgacha",
        ),
    ),
}
