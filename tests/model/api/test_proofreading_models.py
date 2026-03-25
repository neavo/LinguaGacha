from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSnapshot


def test_proofreading_filter_options_snapshot_from_dict_normalizes_collections() -> (
    None
):
    options = ProofreadingFilterOptionsSnapshot.from_dict(
        {
            "warning_types": ["GLOSSARY"],
            "statuses": ["NONE", "PROCESSED"],
            "file_paths": ["chapter-1.txt"],
            "glossary_terms": [["HP", "生命值"]],
        }
    )

    assert options.warning_types == ("GLOSSARY",)
    assert options.statuses == ("NONE", "PROCESSED")
    assert options.file_paths == ("chapter-1.txt",)
    assert options.glossary_terms == (("HP", "生命值"),)


def test_proofreading_snapshot_from_dict_keeps_view_and_summary_models() -> None:
    snapshot = ProofreadingSnapshot.from_dict(
        {
            "project_id": "project-7",
            "readonly": True,
            "summary": {"total_items": 9},
            "items": [
                {
                    "row_number": 12,
                    "src": "原文",
                    "dst": "译文",
                    "status": "PROCESSED",
                    "file_path": "chapter-1.txt",
                    "warnings": ["GLOSSARY"],
                    "failed_glossary_terms": [["HP", "生命值"]],
                }
            ],
        }
    )

    assert snapshot.project_id == "project-7"
    assert snapshot.readonly is True
    assert snapshot.summary.total_items == 9
    assert snapshot.items[0].src == "原文"
    assert snapshot.items[0].row_number == 12
    assert snapshot.items[0].failed_glossary_terms == (("HP", "生命值"),)


def test_proofreading_mutation_result_from_dict_uses_safe_defaults() -> None:
    result = ProofreadingMutationResult.from_dict(None)

    assert result.success is False
    assert result.changed_count == 0
