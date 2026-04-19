from types import SimpleNamespace

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Proofreading.ProofreadingEntryPatchService import (
    ProofreadingEntryPatchService,
)
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterOptions,
)
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterScanResult,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadKind,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadResult,
)


def build_item(item_id: int, file_path: str) -> Item:
    return Item(
        id=item_id,
        src=f"src-{item_id}",
        dst=f"dst-{item_id}",
        file_path=file_path,
        status=Base.ProjectStatus.PROCESSED,
    )


def test_get_patch_merges_filters_and_preserves_requested_item_order() -> None:
    item_one = build_item(1, "script/a.txt")
    item_two = build_item(2, "script/b.txt")
    load_result = ProofreadingLoadResult(
        kind=ProofreadingLoadKind.OK,
        lg_path="demo/project.lg",
        items=[item_one, item_two],
        items_by_id={1: item_one, 2: item_two},
        filter_options=ProofreadingFilterOptions(
            statuses={Base.ProjectStatus.PROCESSED},
            file_paths={"script/a.txt"},
        ),
        warning_map={1: ["GLOSSARY"], 2: ["LENGTH"]},
        checker=SimpleNamespace(name="checker"),
    )
    captured_call: dict[str, object] = {}

    def scan_filtered_items(
        items,
        warning_map,
        options,
        checker,
        **kwargs,
    ) -> ProofreadingFilterScanResult:
        captured_call["items"] = tuple(items)
        captured_call["warning_map"] = warning_map
        captured_call["options"] = options
        captured_call["checker"] = checker
        captured_call["kwargs"] = kwargs
        collect_when = kwargs["collect_when"]
        collected_items = tuple(item for item in items if collect_when(item))
        return ProofreadingFilterScanResult(
            items=collected_items,
            filtered_item_count=len(collected_items),
            warning_item_count=1,
        )

    service = ProofreadingEntryPatchService(
        snapshot_service=SimpleNamespace(load_snapshot=lambda lg_path: load_result),
        filter_service=SimpleNamespace(scan_filtered_items=scan_filtered_items),
    )

    result = service.get_patch(
        lg_path="demo/project.lg",
        request={
            "item_ids": [2, "1", True, "bad", 2],
            "filter_options": {"warning_types": {"GLOSSARY"}},
            "search_keyword": "勇者",
            "search_is_regex": True,
            "search_replace_mode": True,
        },
    )

    assert result.target_item_ids == (2, 1)
    assert result.full_items == (item_two, item_one)
    assert result.filtered_items == (item_one, item_two)
    assert result.filtered_item_count == 2
    assert result.filtered_warning_item_count == 1
    assert captured_call["items"] == (item_one, item_two)
    assert captured_call["warning_map"] == {1: ["GLOSSARY"], 2: ["LENGTH"]}
    assert captured_call["checker"] == load_result.checker
    options = captured_call["options"]
    assert isinstance(options, ProofreadingFilterOptions)
    assert options.warning_types == {"GLOSSARY"}
    assert options.statuses == {Base.ProjectStatus.PROCESSED}
    assert options.file_paths == {"script/a.txt"}
    scan_kwargs = captured_call["kwargs"]
    assert scan_kwargs["search_keyword"] == "勇者"
    assert scan_kwargs["search_is_regex"] is True
    assert scan_kwargs["search_dst_only"] is True
    assert scan_kwargs["enable_search_filter"] is True
    assert scan_kwargs["enable_glossary_term_filter"] is True


def test_normalize_item_ids_drops_duplicates_invalid_values_and_bool() -> None:
    service = ProofreadingEntryPatchService(
        snapshot_service=SimpleNamespace(),
        filter_service=SimpleNamespace(),
    )

    normalized_item_ids = service.normalize_item_ids([1, "2", True, "oops", 1, 2])

    assert normalized_item_ids == [1, 2]
