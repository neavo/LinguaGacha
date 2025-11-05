"""
问题检测器

检测翻译结果中的两类问题：
1. 源语言字符残留
2. 术语未生效
"""

import dataclasses
from module.Cache.CacheItem import CacheItem
from module.Text.TextHelper import TextHelper
from base.Base import Base
from base.BaseLanguage import BaseLanguage


@dataclasses.dataclass
class FixProblem:
    """检测到的问题"""
    cache_item: CacheItem
    problem_type: str  # "residue" 或 "glossary_miss"
    details: str  # 问题详情


class ProblemDetector(Base):
    """问题检测器"""

    def __init__(self, src_language: BaseLanguage.Enum, dst_language: BaseLanguage.Enum, glossary: dict):
        super().__init__()
        self.src_language = src_language
        self.dst_language = dst_language
        self.glossary = glossary

    def detect_all(self, cache_items: list[CacheItem]) -> list[FixProblem]:
        """检测所有问题"""
        problems = []

        for item in cache_items:
            # 1. 检测源语言残留（优先）
            if residue := self.detect_residue(item):
                problems.append(residue)
            # 2. 检测术语未生效（只检测没有残留的项）
            elif glossary_miss := self.detect_glossary_miss(item):
                problems.append(glossary_miss)

        return problems

    def detect_residue(self, item: CacheItem) -> FixProblem | None:
        """检测源语言残留"""
        dst = item.get_dst()

        # 使用 TextHelper 检测源语言字符
        has_residue = False

        if self.src_language == BaseLanguage.Enum.ZH:
            # 中文：检测汉字
            has_residue = TextHelper.CJK.any(dst)
        elif self.src_language == BaseLanguage.Enum.JA:
            # 日语：检测平假名、片假名、汉字
            has_residue = TextHelper.JA.any(dst)
        elif self.src_language == BaseLanguage.Enum.KO:
            # 韩语：检测谚文
            has_residue = TextHelper.KO.any(dst)
        elif self.src_language == BaseLanguage.Enum.RU:
            # 俄语：检测西里尔字母
            has_residue = TextHelper.RU.any(dst)
        elif self.src_language == BaseLanguage.Enum.AR:
            # 阿拉伯语：检测阿拉伯字母
            has_residue = TextHelper.AR.any(dst)
        elif self.src_language == BaseLanguage.Enum.EN:
            # 英语 → 其他语言：检测拉丁字母
            if self.dst_language not in [
                BaseLanguage.Enum.EN,
                BaseLanguage.Enum.DE,
                BaseLanguage.Enum.FR,
                BaseLanguage.Enum.ES,
                BaseLanguage.Enum.IT,
                BaseLanguage.Enum.PT,
                BaseLanguage.Enum.PL,
                BaseLanguage.Enum.HU,
                BaseLanguage.Enum.TR,
                BaseLanguage.Enum.ID,
                BaseLanguage.Enum.VI
            ]:
                has_residue = TextHelper.Latin.any(dst)

        if not has_residue:
            return None

        # 计算残留字符数量和位置
        residue_chars = self._extract_residue_chars(dst)
        residue_count = len(residue_chars)
        total_chars = len(dst)
        ratio = residue_count / total_chars if total_chars > 0 else 0

        # 生成详情描述
        preview = '、'.join(residue_chars[:5])
        if residue_count > 5:
            preview += f"... (还有 {residue_count-5} 处)"

        details = f"残留 {residue_count} 个字符，占比 {ratio*100:.1f}%：{preview}"

        return FixProblem(
            cache_item=item,
            problem_type="residue",
            details=details
        )

    def _extract_residue_chars(self, text: str) -> list[str]:
        """提取残留的字符（用于报告）"""
        residue_chars = []

        if self.src_language == BaseLanguage.Enum.ZH:
            # 提取所有汉字
            for char in text:
                if TextHelper.CJK.char(char):
                    residue_chars.append(char)
        elif self.src_language == BaseLanguage.Enum.JA:
            # 提取所有假名和汉字
            for char in text:
                if TextHelper.JA.char(char):
                    residue_chars.append(char)
        elif self.src_language == BaseLanguage.Enum.KO:
            # 提取所有谚文
            for char in text:
                if TextHelper.KO.char(char):
                    residue_chars.append(char)
        elif self.src_language == BaseLanguage.Enum.RU:
            # 提取所有西里尔字母
            for char in text:
                if TextHelper.RU.char(char):
                    residue_chars.append(char)
        elif self.src_language == BaseLanguage.Enum.AR:
            # 提取所有阿拉伯字母
            for char in text:
                if TextHelper.AR.char(char):
                    residue_chars.append(char)
        elif self.src_language == BaseLanguage.Enum.EN:
            # 提取所有拉丁字母（如果目标语言不是拉丁系）
            for char in text:
                if TextHelper.Latin.char(char):
                    residue_chars.append(char)

        return residue_chars

    def detect_glossary_miss(self, item: CacheItem) -> FixProblem | None:
        """检测术语未生效"""
        src = item.get_src()
        dst = item.get_dst()
        missed_terms = []

        for src_term, dst_term in self.glossary.items():
            # 原文包含术语，但译文不包含对应译文
            if src_term in src and dst_term not in dst:
                missed_terms.append(f"{src_term} → {dst_term}")

        if not missed_terms:
            return None

        details = f"未生效术语：{', '.join(missed_terms[:3])}"
        if len(missed_terms) > 3:
            details += f"... (还有 {len(missed_terms)-3} 个)"

        return FixProblem(
            cache_item=item,
            problem_type="glossary_miss",
            details=details
        )
