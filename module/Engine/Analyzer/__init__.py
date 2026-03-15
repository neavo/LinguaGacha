# 统一从包根导出稳定入口，外部代码就不用关心内部拆成了几个实现文件。
from module.Engine.Analyzer.AnalysisModels import AnalysisCandidateAggregate
from module.Engine.Analyzer.AnalysisModels import AnalysisItemContext
from module.Engine.Analyzer.AnalysisModels import AnalysisProgressSnapshot
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskResult

__all__ = [
    "AnalysisCandidateAggregate",
    "AnalysisItemContext",
    "AnalysisProgressSnapshot",
    "AnalysisTaskContext",
    "AnalysisTaskResult",
    "AnalysisPipeline",
    "Analyzer",
]


def __getattr__(name: str) -> object:
    """延迟导出重模块，避免包初始化时把 DataManager 循环拉进来。"""

    if name == "AnalysisPipeline":
        from module.Engine.Analyzer.AnalysisPipeline import AnalysisPipeline

        return AnalysisPipeline
    if name == "Analyzer":
        from module.Engine.Analyzer.Analyzer import Analyzer

        return Analyzer
    raise AttributeError(name)
