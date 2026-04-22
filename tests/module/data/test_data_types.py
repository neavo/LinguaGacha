from dataclasses import FrozenInstanceError

import pytest

from module.Data.Core.DataTypes import AnalysisGlossaryImportPreview
from module.Data.Core.DataTypes import AnalysisGlossaryImportPreviewEntry
from module.Data.Core.DataTypes import ProjectFileMutationResult
from module.Data.Core.DataTypes import ProjectPrefilterRequest
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics


def test_project_prefilter_request_is_frozen() -> None:
    request = ProjectPrefilterRequest(
        token=7,
        seq=9,
        lg_path="demo/project.lg",
        reason="project_loaded",
        source_language="JA",
        mtool_optimizer_enable=True,
    )

    assert request.reason == "project_loaded"

    with pytest.raises(FrozenInstanceError):
        request.reason = "config_updated"


def test_analysis_glossary_import_preview_and_project_file_result_hold_public_state() -> (
    None
):
    report = QualityRuleMerger.Report(
        added=1,
        updated=0,
        filled=0,
        deduped=0,
        skipped_empty_src=0,
        conflicts=(),
    )
    preview_entry = AnalysisGlossaryImportPreviewEntry(
        entry={"src": "Alice", "dst": "爱丽丝"},
        statistics_key="Alice|0",
        is_new=True,
        incoming_indexes=(0,),
    )
    preview = AnalysisGlossaryImportPreview(
        merged_entries=({"src": "Alice", "dst": "爱丽丝"},),
        report=report,
        entries=(preview_entry,),
        statistics_results={
            "Alice|0": QualityRuleStatistics.RuleStatResult(matched_item_count=3)
        },
        subset_parents={"Alice|0": ("A|0",)},
    )
    result = ProjectFileMutationResult(rel_paths=("script/a.txt",))

    assert preview.report.added == 1
    assert preview.entries[0].incoming_indexes == (0,)
    assert preview.statistics_results["Alice|0"].matched_item_count == 3
    assert result.rel_paths == ("script/a.txt",)
    assert result.removed_rel_paths == ()
    assert result.total == 0

    with pytest.raises(FrozenInstanceError):
        preview_entry.is_new = False
