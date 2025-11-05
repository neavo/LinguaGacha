"""
结果修正模块

用于自动检测并修正翻译结果中的问题：
1. 源语言字符残留
2. 术语未生效
"""

from .ResultFixer import ResultFixer
from .ProblemDetector import ProblemDetector, FixProblem
from .EnhancedPromptBuilder import EnhancedPromptBuilder
from .FixReport import FixReport, FixResult

__all__ = [
    "ResultFixer",
    "ProblemDetector",
    "FixProblem",
    "EnhancedPromptBuilder",
    "FixReport",
    "FixResult",
]
