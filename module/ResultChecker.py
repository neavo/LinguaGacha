import re
from enum import StrEnum

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Response.ResponseChecker import ResponseChecker
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor
from module.Utils.GapTool import GapTool


class WarningType(StrEnum):
    """检查警告类型枚举"""

    KANA = "KANA"  # 假名残留
    HANGEUL = "HANGEUL"  # 谚文残留
    TEXT_PRESERVE = "TEXT_PRESERVE"  # 文本保护失效
    SIMILARITY = "SIMILARITY"  # 相似度过高
    GLOSSARY = "GLOSSARY"  # 术语表未生效
    RETRY_THRESHOLD = "RETRY_THRESHOLD"  # 重试次数达阈值


class ResultChecker(Base):
    # 用常量集中维护过滤状态，避免调用点散落重复分支
    SKIPPED_STATUS: tuple[Base.ProjectStatus, ...] = (
        Base.ProjectStatus.NONE,
        Base.ProjectStatus.RULE_SKIPPED,
        Base.ProjectStatus.LANGUAGE_SKIPPED,
        Base.ProjectStatus.EXCLUDED,
        Base.ProjectStatus.DUPLICATED,
    )
    SIMILARITY_THRESHOLD: float = 0.80

    def __init__(self, config: Config) -> None:
        super().__init__()

        self.config: Config = config
        self.text_processor: TextProcessor = TextProcessor(config, Item())
        # 预处理术语表数据（用于单条检查时复用）
        self.prepared_glossary_data: list[dict] = self.prepare_glossary_data()

    def prepare_glossary_data(self) -> list[dict]:
        """预处理术语表数据"""
        glossary_items = DataManager.get().get_glossary()
        if not DataManager.get().get_glossary_enable() or not glossary_items:
            return []

        return [
            {
                "src": term.get("src", ""),
                "dst": term.get("dst", ""),
            }
            for term in glossary_items
        ]

    # 单条目检查的私有方法
    def get_replaced_text(
        self,
        item: Item,
        pre_rules: list[dict] | None = None,
        post_rules: list[dict] | None = None,
    ) -> tuple[str, str]:
        """获取单条目的替换后原文和替换前译文

        Args:
            item: 条目对象
            pre_rules: 可选的预热规则
            post_rules: 可选的预热规则
        """
        src = item.get_src()
        dst = item.get_dst()
        data_manager = DataManager.get()

        # 优先使用传入的预热规则，否则从管理器实时获取
        pre_replacement_data: list[dict]
        if pre_rules is not None:
            pre_replacement_data = pre_rules
        elif data_manager.get_pre_replacement_enable():
            pre_replacement_data = data_manager.get_pre_replacement()
        else:
            pre_replacement_data = []

        if pre_replacement_data:
            for replacement in pre_replacement_data:
                src = src.replace(
                    replacement.get("src", ""), replacement.get("dst", "")
                )

        post_replacement_data: list[dict]
        if post_rules is not None:
            post_replacement_data = post_rules
        elif data_manager.get_post_replacement_enable():
            post_replacement_data = data_manager.get_post_replacement()
        else:
            post_replacement_data = []

        if post_replacement_data:
            for replacement in post_replacement_data:
                dst = dst.replace(
                    replacement.get("dst", ""), replacement.get("src", "")
                )

        return src, dst

    def has_kana_error(self, item: Item) -> bool:
        """检查是否存在假名残留"""
        if self.config.source_language != BaseLanguage.Enum.JA:
            return False
        dst = self.normalize_dst_for_residue_check(item)
        return TextHelper.JA.any_hiragana(dst) or TextHelper.JA.any_katakana(dst)

    def has_hangeul_error(self, item: Item) -> bool:
        """检查是否存在谚文残留"""
        if self.config.source_language != BaseLanguage.Enum.KO:
            return False
        return TextHelper.KO.any_hangeul(self.normalize_dst_for_residue_check(item))

    def normalize_dst_for_residue_check(self, item: Item) -> str:
        """构建残留检测输入，避免保护片段中的字符被误判为残留"""
        dst = item.get_dst()
        rule: re.Pattern[str] | None = self.text_processor.get_re_sample(
            custom=self.text_processor.get_text_preserve_custom_enabled(),
            text_type=item.get_text_type(),
        )
        if rule is not None:
            dst = rule.sub("", dst)
        return dst

    def has_text_preserve_error(self, item: Item, src_repl: str, dst_repl: str) -> bool:
        """检查文本保护是否失效"""
        return not self.text_processor.check(src_repl, dst_repl, item.get_text_type())

    def normalize_text_for_similarity_check(
        self, item: Item, src_repl: str, dst_repl: str
    ) -> tuple[str, str]:
        """构建相似度检测输入，避免保护片段导致相似度误报"""
        src = src_repl
        dst = dst_repl
        rule: re.Pattern[str] | None = self.text_processor.get_re_sample(
            custom=self.text_processor.get_text_preserve_custom_enabled(),
            text_type=item.get_text_type(),
        )
        if rule is not None:
            src = rule.sub("", src)
            dst = rule.sub("", dst)
        return src.strip(), dst.strip()

    def has_similarity_error(self, item: Item, src_repl: str, dst_repl: str) -> bool:
        """检查原文和译文相似度是否过高"""
        src, dst = self.normalize_text_for_similarity_check(item, src_repl, dst_repl)
        # 剥离文本保护片段后若出现空串，跳过包含判断，避免 "" in text 触发误报。
        if src == "" or dst == "":
            return False
        # 判断是否包含或相似
        return (
            src in dst
            or dst in src
            or TextHelper.check_similarity_by_jaccard(src, dst)
            > __class__.SIMILARITY_THRESHOLD
        )

    def has_glossary_error(self, src_repl: str, dst_repl: str) -> bool:
        """检查术语表是否未生效"""
        if not self.prepared_glossary_data:
            return False
        return len(self.get_failed_glossary_terms_from_replaced(src_repl, dst_repl)) > 0

    def get_failed_glossary_terms(self, item: Item) -> list[tuple[str, str]]:
        """获取单个条目中未生效的术语列表，返回 (src, dst) 元组列表"""
        if not self.prepared_glossary_data:
            return []

        src_repl, dst_repl = self.get_replaced_text(item)
        return self.get_failed_glossary_terms_from_replaced(src_repl, dst_repl)

    def get_failed_glossary_terms_from_replaced(
        self, src_repl: str, dst_repl: str
    ) -> list[tuple[str, str]]:
        """复用术语命中判定，避免多处逻辑漂移"""
        failed_terms: list[tuple[str, str]] = []

        for term in self.prepared_glossary_data:
            glossary_src = term.get("src", "")
            glossary_dst = term.get("dst", "")
            # 原文包含术语原文，但译文不包含术语译文
            if (
                glossary_src
                and glossary_src in src_repl
                and glossary_dst not in dst_repl
            ):
                failed_terms.append((glossary_src, glossary_dst))

        return failed_terms

    def has_untranslated_error(self, item: Item) -> bool:
        """检查是否未翻译"""
        return item.get_status() == Base.ProjectStatus.NONE

    def has_retry_threshold_error(self, item: Item) -> bool:
        """检查重试次数是否达到阈值"""
        return item.get_retry_count() >= ResponseChecker.RETRY_COUNT_THRESHOLD

    # =========================================
    # 公共接口方法
    # =========================================

    def check_items(self, items: list[Item]) -> dict[int, list[WarningType]]:
        """
        对全量数据进行内存检查，返回警告映射表。
        通过一次性提取规则缓存，将复杂度从 O(N*M) 降至 O(N+M)。
        """
        warning_map: dict[int, list[WarningType]] = {}

        # 1. 在循环外部一次性准备所有规则数据
        prepared_glossary = self.prepare_glossary_data()
        pre_rules = (
            DataManager.get().get_pre_replacement()
            if DataManager.get().get_pre_replacement_enable()
            else []
        )
        post_rules = (
            DataManager.get().get_post_replacement()
            if DataManager.get().get_post_replacement_enable()
            else []
        )

        # 2. 紧凑循环处理
        for item in GapTool.iter(items):
            warnings = self.check_item(
                item,
                glossary=prepared_glossary,
                pre_rules=pre_rules,
                post_rules=post_rules,
            )
            if warnings:
                warning_map[id(item)] = warnings

        return warning_map

    def check_item(
        self,
        item: Item,
        glossary: list[dict] | None = None,
        pre_rules: list[dict] | None = None,
        post_rules: list[dict] | None = None,
    ) -> list[WarningType]:
        """
        对单个条目进行纯内存检查。

        Args:
            item: 待检查的 Item 对象
            glossary: 可选预热术语表
            pre_rules: 可选预热预替换规则
            post_rules: 可选预热后替换规则
        """
        warnings: list[WarningType] = []

        # 1. 快速过滤
        if item.get_status() in __class__.SKIPPED_STATUS:
            return warnings

        if not item.get_dst():
            return warnings

        # 2. 准备本次检查使用的术语表数据（优先使用传入的缓存）
        self.prepared_glossary_data = (
            glossary if glossary is not None else self.prepare_glossary_data()
        )

        # 3. 获取替换后的文本
        src_repl, dst_repl = self.get_replaced_text(
            item, pre_rules=pre_rules, post_rules=post_rules
        )

        # 4. 执行各项原子检查
        if self.has_kana_error(item):
            warnings.append(WarningType.KANA)

        if self.has_hangeul_error(item):
            warnings.append(WarningType.HANGEUL)

        if self.has_text_preserve_error(item, src_repl, dst_repl):
            warnings.append(WarningType.TEXT_PRESERVE)

        if self.has_similarity_error(item, src_repl, dst_repl):
            warnings.append(WarningType.SIMILARITY)

        if self.has_glossary_error(src_repl, dst_repl):
            warnings.append(WarningType.GLOSSARY)

        if self.has_retry_threshold_error(item):
            warnings.append(WarningType.RETRY_THRESHOLD)

        return warnings
