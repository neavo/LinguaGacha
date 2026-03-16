# 统一从包根导出稳定入口，外部代码就不用关心内部拆成了几个实现文件。
from module.Engine.Analysis.AnalysisModels import AnalysisCandidateAggregate
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot

__all__ = [
    "AnalysisCandidateAggregate",
    "AnalysisItemContext",
    "TaskProgressSnapshot",
    "AnalysisTaskContext",
    "AnalysisTaskResult",
    "AnalysisPipeline",
    "Analysis",
]


def __getattr__(name: str) -> object:
    """延迟导出重模块，避免包初始化时把 DataManager 循环拉进来。"""

    if name == "AnalysisPipeline":
        from module.Engine.Analysis.AnalysisPipeline import AnalysisPipeline

        return AnalysisPipeline
    if name == "Analysis":
        from module.Engine.Analysis.Analysis import Analysis

        return Analysis
    raise AttributeError(name)
