from module.Engine.Analyzer.AnalysisModels import AnalysisProgressSnapshot
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskResult
from module.Engine.Analyzer.AnalysisModels import AnalysisItemContext


def test_analysis_task_context_exposes_item_count_and_source_texts() -> None:
    context = AnalysisTaskContext(
        task_fingerprint="fp",
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                source_text="A",
                source_hash="h1",
            ),
            AnalysisItemContext(
                item_id=2,
                file_path="story.txt",
                source_text="B",
                source_hash="h2",
            ),
        ),
    )

    assert context.item_count == 2
    assert context.source_texts == ("A", "B")
    assert context.retry_count == 0


def test_analysis_task_result_defaults_stay_empty_and_zero() -> None:
    context = AnalysisTaskContext(task_fingerprint="fp", file_path="a.txt", items=())

    result = AnalysisTaskResult(context=context, success=True, stopped=False)

    assert result.input_tokens == 0
    assert result.output_tokens == 0
    assert result.glossary_entries == tuple()


def test_analysis_progress_snapshot_to_dict_keeps_expected_fields() -> None:
    snapshot = AnalysisProgressSnapshot(
        start_time=1.0,
        time=2.0,
        total_line=3,
        line=2,
        processed_line=1,
        error_line=1,
        total_tokens=9,
        total_input_tokens=4,
        total_output_tokens=5,
        added_glossary=6,
    )

    assert snapshot.to_dict() == {
        "start_time": 1.0,
        "time": 2.0,
        "total_line": 3,
        "line": 2,
        "processed_line": 1,
        "error_line": 1,
        "total_tokens": 9,
        "total_input_tokens": 4,
        "total_output_tokens": 5,
        "added_glossary": 6,
    }
