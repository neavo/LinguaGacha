from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext


def test_analysis_task_context_exposes_item_count_and_src_texts() -> None:
    context = AnalysisTaskContext(
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                src_text="A",
            ),
            AnalysisItemContext(
                item_id=2,
                file_path="story.txt",
                src_text="B",
            ),
        ),
    )

    assert context.item_count == 2
    assert context.src_texts == ("A", "B")
    assert context.retry_count == 0


def test_analysis_task_result_defaults_stay_empty_and_zero() -> None:
    context = AnalysisTaskContext(file_path="a.txt", items=())

    result = AnalysisTaskResult(context=context, success=True, stopped=False)

    assert result.input_tokens == 0
    assert result.output_tokens == 0
    assert result.glossary_entries == tuple()
