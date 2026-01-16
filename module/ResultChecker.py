import json
import os
from enum import StrEnum

import opencc

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Response.ResponseChecker import ResponseChecker
from module.Text.TextHelper import TextHelper
from module.TextProcessor import TextProcessor

class WarningType(StrEnum):
    """检查警告类型枚举"""
    KANA = "KANA"                           # 假名残留
    HANGEUL = "HANGEUL"                     # 谚文残留
    TEXT_PRESERVE = "TEXT_PRESERVE"         # 文本保护失效
    SIMILARITY = "SIMILARITY"               # 相似度过高
    GLOSSARY = "GLOSSARY"                   # 术语表未生效
    RETRY_THRESHOLD = "RETRY_THRESHOLD"     # 重试次数达阈值


class ResultChecker(Base):

    # 类变量
    OPENCCT2S = opencc.OpenCC("t2s")
    OPENCCS2T = opencc.OpenCC("s2tw")

    def __init__(self, config: Config) -> None:
        super().__init__()

        self.config: Config = config
        self.text_processor: TextProcessor = TextProcessor(config, None)
        # 预处理术语表数据（用于单条检查时复用）
        self._prepared_glossary_data: list[dict] = self._prepare_glossary_data()

    def _prepare_glossary_data(self) -> list[dict]:
        """预处理术语表数据，根据繁简设置转换译文"""
        if not self.config.glossary_enable or not self.config.glossary_data:
            return []

        # 根据繁体输出设置转换术语表译文
        converter = ResultChecker.OPENCCS2T if self.config.traditional_chinese_enable else ResultChecker.OPENCCT2S
        return [
            {
                "src": v.get("src", ""),
                "dst": converter.convert(v.get("dst", "")),
            }
            for v in self.config.glossary_data
        ]

    # =========================================
    # 单条目检查的私有方法
    # =========================================

    def _get_repl_texts(self, item: Item) -> tuple[str, str]:
        """获取单条目的替换后原文和替换前译文"""
        src = item.get_src()
        dst = item.get_dst()

        # 译前替换
        if self.config.pre_translation_replacement_enable and self.config.pre_translation_replacement_data:
            for v in self.config.pre_translation_replacement_data:
                src = src.replace(v.get("src", ""), v.get("dst", ""))

        # 译后逆替换（还原）
        if self.config.post_translation_replacement_enable and self.config.post_translation_replacement_data:
            for v in self.config.post_translation_replacement_data:
                dst = dst.replace(v.get("dst", ""), v.get("src", ""))

        return src, dst

    def _has_kana_error(self, item: Item) -> bool:
        """检查是否存在假名残留"""
        if self.config.source_language != BaseLanguage.Enum.JA:
            return False
        dst = item.get_dst()
        return TextHelper.JA.any_hiragana(dst) or TextHelper.JA.any_katakana(dst)

    def _has_hangeul_error(self, item: Item) -> bool:
        """检查是否存在谚文残留"""
        if self.config.source_language != BaseLanguage.Enum.KO:
            return False
        return TextHelper.KO.any_hangeul(item.get_dst())

    def _has_text_preserve_error(self, item: Item, src_repl: str, dst_repl: str) -> bool:
        """检查文本保护是否失效"""
        return not self.text_processor.check(src_repl, dst_repl, item.get_text_type())

    def _has_similarity_error(self, src_repl: str, dst_repl: str) -> bool:
        """检查原文和译文相似度是否过高"""
        src = src_repl.strip()
        dst = dst_repl.strip()
        # 判断是否包含或相似
        return src in dst or dst in src or TextHelper.check_similarity_by_jaccard(src, dst) > 0.80

    def _has_glossary_error(self, src_repl: str, dst_repl: str) -> bool:
        """检查术语表是否未生效"""
        if not self._prepared_glossary_data:
            return False

        for v in self._prepared_glossary_data:
            glossary_src = v.get("src", "")
            glossary_dst = v.get("dst", "")
            # 原文包含术语原文，但译文不包含术语译文
            if glossary_src and glossary_src in src_repl and glossary_dst not in dst_repl:
                return True
        return False

    def _has_untranslated_error(self, item: Item) -> bool:
        """检查是否未翻译"""
        return item.get_status() == Base.ProjectStatus.NONE

    def _has_retry_threshold_error(self, item: Item) -> bool:
        """检查重试次数是否达到阈值"""
        return item.get_retry_count() >= ResponseChecker.RETRY_COUNT_THRESHOLD

    # =========================================
    # 公共接口方法
    # =========================================

    def get_check_results(self, items: list[Item]) -> dict[int, list[WarningType]]:
        """
        对全量数据进行内存检查，返回警告映射表。

        Args:
            items: 待检查的 Item 列表

        Returns:
            以 id(item) 为 Key，警告类型列表为 Value 的字典
            示例: { 140234567890: [WarningType.KANA, WarningType.SIMILARITY], ... }
        """
        warning_map: dict[int, list[WarningType]] = {}

        for item in items:
            warnings = self.check_single_item(item)
            if warnings:
                warning_map[id(item)] = warnings

        return warning_map

    def check_single_item(self, item: Item) -> list[WarningType]:
        """
        对单个条目进行纯内存检查。

        Args:
            item: 待检查 of Item 对象

        Returns:
            该条目存在的警告类型列表
        """
        warnings: list[WarningType] = []

        # 跳过未翻译的条目
        if item.get_status() == Base.ProjectStatus.NONE:
            return warnings

        # 跳过空译文
        if not item.get_dst():
            return warnings

        # 获取替换后的文本
        src_repl, dst_repl = self._get_repl_texts(item)

        # 假名残留检查
        if self._has_kana_error(item):
            warnings.append(WarningType.KANA)

        # 谚文残留检查
        if self._has_hangeul_error(item):
            warnings.append(WarningType.HANGEUL)

        # 文本保护检查
        if self._has_text_preserve_error(item, src_repl, dst_repl):
            warnings.append(WarningType.TEXT_PRESERVE)

        # 相似度检查
        if self._has_similarity_error(src_repl, dst_repl):
            warnings.append(WarningType.SIMILARITY)

        # 术语表检查
        if self._has_glossary_error(src_repl, dst_repl):
            warnings.append(WarningType.GLOSSARY)

        # 重试次数阈值检查
        if self._has_retry_threshold_error(item):
            warnings.append(WarningType.RETRY_THRESHOLD)

        return warnings
