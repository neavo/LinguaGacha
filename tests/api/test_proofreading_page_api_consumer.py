from unittest.mock import Mock

from frontend.Proofreading.ProofreadingPage import ProofreadingPage
from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingItemView
from model.Api.ProofreadingModels import ProofreadingSnapshot
from model.Api.ProofreadingModels import ProofreadingSummary


def build_snapshot(*, revision: int, item_ids: tuple[int, ...]) -> ProofreadingSnapshot:
    return ProofreadingSnapshot(
        revision=revision,
        project_id="demo/project.lg",
        readonly=False,
        summary=ProofreadingSummary(
            total_items=len(item_ids),
            filtered_items=len(item_ids),
            warning_items=1 if item_ids else 0,
        ),
        filters=ProofreadingFilterOptionsSnapshot(
            warning_types=("GLOSSARY",),
            statuses=("NONE", "PROCESSED"),
            file_paths=("script/a.txt",),
            glossary_terms=(("勇者", "Hero"),),
        ),
        items=tuple(
            ProofreadingItemView(
                item_id=item_id,
                file_path="script/a.txt",
                row_number=index + 1,
                src=f"src-{item_id}",
                dst=f"dst-{item_id}",
                status="PROCESSED" if item_id % 2 == 0 else "NONE",
                warnings=("GLOSSARY",) if index == 0 else (),
                failed_glossary_terms=(("勇者", "Hero"),) if index == 0 else (),
            )
            for index, item_id in enumerate(item_ids)
        ),
    )


def test_proofreading_page_reload_invalidated_snapshot_restores_selected_item_id() -> None:
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.proofreading_api_client = Mock()
    page.api_state_store = Mock()
    page.selected_item_id = 22

    snapshot = build_snapshot(revision=9, item_ids=(11, 22))
    page.proofreading_api_client.get_snapshot.return_value = snapshot
    page.api_state_store.is_proofreading_snapshot_invalidated.return_value = True

    consumed: dict[str, object] = {}

    def fake_apply_snapshot(
        payload: ProofreadingSnapshot,
        *,
        preferred_item_id: int | str | None,
    ) -> None:
        consumed["snapshot"] = payload
        consumed["preferred_item_id"] = preferred_item_id

    page.apply_snapshot = fake_apply_snapshot

    page.reload_invalidated_snapshot_if_needed()

    page.proofreading_api_client.get_snapshot.assert_called_once_with({})
    page.api_state_store.clear_proofreading_snapshot_invalidated.assert_called_once_with()
    assert consumed["snapshot"] == snapshot
    assert consumed["preferred_item_id"] == 22


def test_proofreading_page_reload_invalidated_snapshot_skips_when_state_is_fresh() -> None:
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.proofreading_api_client = Mock()
    page.api_state_store = Mock()
    page.selected_item_id = 22
    page.api_state_store.is_proofreading_snapshot_invalidated.return_value = False
    page.apply_snapshot = Mock()

    page.reload_invalidated_snapshot_if_needed()

    page.proofreading_api_client.get_snapshot.assert_not_called()
    page.api_state_store.clear_proofreading_snapshot_invalidated.assert_not_called()
    page.apply_snapshot.assert_not_called()
