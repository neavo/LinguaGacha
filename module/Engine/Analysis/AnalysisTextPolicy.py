from __future__ import annotations

from model.Item import Item


class AnalysisTextPolicy:
    """统一分析文本口径，避免数据层和分析引擎各写一套规则。"""

    @staticmethod
    def build_source_text(item: Item) -> str:
        """统一拼装分析输入，保证哈希和待处理筛选都看同一份文本。"""

        src = item.get_src().strip()
        names_raw = item.get_name_src()
        names: list[str] = []
        if isinstance(names_raw, str):
            name = names_raw.strip()
            if name != "":
                names.append(name)
        elif isinstance(names_raw, list):
            for raw_name in names_raw:
                if not isinstance(raw_name, str):
                    continue
                name = raw_name.strip()
                if name == "" or name in names:
                    continue
                names.append(name)

        parts: list[str] = []
        if names:
            parts.append("\n".join(names))
        if src != "":
            parts.append(src)
        return "\n".join(parts).strip()

    @staticmethod
    def is_control_code_text(text: str) -> bool:
        """分析术语里只有纯控制码需要特殊放行。"""

        from module.Engine.Analysis.AnalysisFakeNameInjector import (
            AnalysisFakeNameInjector,
        )

        return AnalysisFakeNameInjector.is_control_code_text(str(text).strip())

    @staticmethod
    def is_control_code_self_mapping(src: str, dst: str) -> bool:
        """纯控制码自映射代表占位符本体，不走普通自映射过滤。"""

        from module.Engine.Analysis.AnalysisFakeNameInjector import (
            AnalysisFakeNameInjector,
        )

        return AnalysisFakeNameInjector.is_control_code_self_mapping(
            str(src).strip(),
            str(dst).strip(),
        )
