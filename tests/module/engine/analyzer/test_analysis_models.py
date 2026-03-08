from model.Item import Item
from module.Engine.Analyzer.AnalysisModels import AnalysisChunkResult
from module.Engine.Analyzer.AnalysisModels import AnalysisFilePlan


def test_analysis_file_plan_chunk_count_matches_chunk_tuple_length() -> None:
    plan = AnalysisFilePlan(
        file_path="story.txt",
        chunks=((Item(src="A"), Item(src="B")), (Item(src="C"),)),
    )

    assert plan.chunk_count == 2
    assert plan.item_count == 3


def test_analysis_chunk_result_defaults_stay_empty_and_zero() -> None:
    result = AnalysisChunkResult(success=True, stopped=False)

    assert result.input_tokens == 0
    assert result.output_tokens == 0
    assert result.glossary_entries == tuple()
