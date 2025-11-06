"""
修正报告生成器

生成详细的修正报告，包括成功/失败统计和每条问题的详情。
"""

import dataclasses
import json
from datetime import datetime
from .ProblemDetector import FixProblem


@dataclasses.dataclass
class FixResult:
    """单个问题的修正结果"""
    problem: FixProblem
    success: bool
    attempts: int  # 尝试次数
    final_dst: str  # 最终译文
    platform_name: str = ""  # 使用的平台名称
    error_message: str = ""  # 如果失败，记录原因


@dataclasses.dataclass
class FixReport:
    """修正报告"""
    total: int  # 总问题数
    fixed: int  # 修正成功数
    failed: int  # 修正失败数
    backup_path: str  # 备份路径
    details: list[FixResult] = None  # 详细结果

    def to_dict(self) -> dict:
        """转为字典"""
        return {
            "timestamp": datetime.now().isoformat(),
            "summary": {
                "total": self.total,
                "fixed": self.fixed,
                "failed": self.failed,
                "success_rate": f"{self.fixed/self.total*100:.1f}%" if self.total > 0 else "N/A"
            },
            "backup_path": self.backup_path,
            "details": [
                {
                    "problem_type": detail.problem.problem_type,
                    "problem_details": detail.problem.details,
                    "success": detail.success,
                    "attempts": detail.attempts,
                    "original_text": detail.problem.cache_item.get_src()[:100] + "..." if len(detail.problem.cache_item.get_src()) > 100 else detail.problem.cache_item.get_src(),
                    "final_translation": detail.final_dst[:100] + "..." if len(detail.final_dst) > 100 else detail.final_dst,
                    "error_message": detail.error_message
                }
                for detail in (self.details or [])
            ]
        }

    def save(self, path: str):
        """保存报告到文件"""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
