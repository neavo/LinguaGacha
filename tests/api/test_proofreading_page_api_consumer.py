from unittest.mock import Mock

from frontend.Proofreading.ProofreadingPage import ProofreadingPage
from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingItemView
from model.Api.ProofreadingModels import ProofreadingSearchResult
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


def test_proofreading_page_reload_invalidated_snapshot_restores_selected_item_id() -> (
    None
):
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.proofreading_api_client = Mock()
    page.api_state_store = Mock()
    page.api_state_store.is_busy.return_value = False
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


def test_proofreading_page_reload_invalidated_snapshot_skips_when_state_is_fresh() -> (
    None
):
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.proofreading_api_client = Mock()
    page.api_state_store = Mock()
    page.api_state_store.is_busy.return_value = False
    page.selected_item_id = 22
    page.api_state_store.is_proofreading_snapshot_invalidated.return_value = False
    page.apply_snapshot = Mock()

    page.reload_invalidated_snapshot_if_needed()

    page.proofreading_api_client.get_snapshot.assert_not_called()
    page.api_state_store.clear_proofreading_snapshot_invalidated.assert_not_called()
    page.apply_snapshot.assert_not_called()


def test_proofreading_page_apply_snapshot_replaces_page_level_snapshot_state() -> None:
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.table_widget = Mock()
    page.edit_panel = Mock()
    page.search_card = Mock()
    page.restore_selected_item = Mock()
    page.check_engine_status = Mock()
    page.current_snapshot = ProofreadingSnapshot()
    page.filtered_items = []
    page.current_item = None
    page.current_row_index = -1
    page.is_readonly = True

    snapshot = build_snapshot(revision=15, item_ids=(11, 22, 33))

    page.apply_snapshot(snapshot, preferred_item_id=22)

    assert page.current_snapshot == snapshot
    assert list(page.filtered_items) == list(snapshot.items)
    assert page.selected_item_id == 22
    assert page.is_readonly is False
    page.table_widget.set_items.assert_called_once_with(list(snapshot.items))
    page.restore_selected_item.assert_called_once_with()
    page.check_engine_status.assert_called_once_with()


def test_proofreading_page_apply_snapshot_rebuilds_search_state_on_new_snapshot() -> (
    None
):
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.table_widget = Mock()
    page.edit_panel = Mock()
    page.search_card = Mock()
    page.restore_selected_item = Mock()
    page.check_engine_status = Mock()
    page.start_search = Mock()
    page.current_snapshot = ProofreadingSnapshot()
    page.filtered_items = []
    page.current_item = None
    page.current_row_index = -1
    page.is_readonly = True
    page.search_keyword = "Hero"
    page.search_is_regex = False
    page.search_replace_mode = True
    page.search_result = Mock()
    page.search_match_indices = [8, 9]
    page.search_current_match = 1
    page.search_next_anchor_index = 8
    page.search_refilter_deferred = True
    page.replace_once_pending_jump = True
    page.replace_once_pending_refilter_apply = True

    snapshot = build_snapshot(revision=15, item_ids=(11, 22, 33))

    page.apply_snapshot(snapshot, preferred_item_id=22)

    assert page.current_snapshot == snapshot
    assert list(page.filtered_items) == list(snapshot.items)
    assert page.search_result is None
    assert page.search_match_indices == []
    assert page.search_current_match == -1
    assert page.search_next_anchor_index is None
    assert page.search_refilter_deferred is False
    assert page.replace_once_pending_jump is False
    assert page.replace_once_pending_refilter_apply is False
    page.search_card.clear_match_info.assert_called_once_with()
    page.start_search.assert_called_once_with()
    page.restore_selected_item.assert_not_called()


def test_proofreading_page_search_done_prefers_pending_selected_item_id() -> None:
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.search_card = Mock()
    page.emit = Mock()
    page.jump_to_match = Mock()
    page.search_result = None
    page.search_match_indices = []
    page.search_current_match = -1
    page.filtered_items = list(build_snapshot(revision=15, item_ids=(11, 22, 33)).items)
    page.pending_selected_item_id = 22

    page.on_search_done_ui(
        ProofreadingSearchResult(
            keyword="Hero",
            is_regex=False,
            matched_item_ids=(11, 22),
        )
    )

    assert page.search_current_match == 1
    page.jump_to_match.assert_called_once_with()


def test_proofreading_page_schedule_reload_defers_while_local_mutation_is_in_flight() -> (
    None
):
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.api_state_store = Mock()
    page.api_state_store.is_project_loaded.return_value = True
    page.api_state_store.is_busy.return_value = False
    page.edit_panel = Mock()
    page.edit_panel.has_unsaved_changes.return_value = False
    page.reload_timer = Mock()
    page.isVisible = Mock(return_value=True)
    page.is_loading = False
    page.reload_pending = False
    page.local_mutation_inflight_count = 1

    page.schedule_reload("mutation_busy")

    assert page.reload_pending is True
    page.reload_timer.start.assert_not_called()


def test_proofreading_page_check_engine_status_locks_local_mutation_without_clearing_page() -> (
    None
):
    page = ProofreadingPage.__new__(ProofreadingPage)
    snapshot = build_snapshot(revision=15, item_ids=(11, 22, 33))
    page.api_state_store = Mock()
    page.api_state_store.is_busy.return_value = False
    page.local_mutation_inflight_count = 1
    page.is_resetting = False
    page.current_snapshot = snapshot
    page.filtered_items = list(snapshot.items)
    page.data_stale = False
    page.reload_pending = False
    page.current_item = snapshot.items[0]
    page.current_row_index = 0
    page.selected_item_id = snapshot.items[0].item_id
    page.loading_token = 0
    page.is_loading = False
    page.btn_search = Mock()
    page.btn_replace = Mock()
    page.btn_filter = Mock()
    page.table_widget = Mock()
    page.edit_panel = Mock()
    page.reset_search_state = Mock()
    page.is_readonly = False

    page.check_engine_status()

    assert page.filtered_items == list(snapshot.items)
    page.table_widget.set_items.assert_not_called()
    page.reset_search_state.assert_not_called()
    page.table_widget.set_readonly.assert_called_once_with(True)
    page.edit_panel.set_readonly.assert_called_once_with(True)
    page.btn_search.setEnabled.assert_called_with(False)
    page.btn_replace.setEnabled.assert_called_with(False)
    page.btn_filter.setEnabled.assert_called_with(False)


def test_proofreading_page_visible_poll_reloads_invalidated_snapshot() -> None:
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.api_state_store = Mock()
    page.isVisible = Mock(return_value=True)
    page.reload_invalidated_snapshot_if_needed = Mock()

    page.api_state_store.is_proofreading_snapshot_invalidated.return_value = True

    page.poll_invalidated_snapshot_if_needed()

    page.reload_invalidated_snapshot_if_needed.assert_called_once_with()


def test_proofreading_page_hidden_poll_skips_invalidated_snapshot_reload() -> None:
    page = ProofreadingPage.__new__(ProofreadingPage)
    page.api_state_store = Mock()
    page.isVisible = Mock(return_value=False)
    page.reload_invalidated_snapshot_if_needed = Mock()

    page.api_state_store.is_proofreading_snapshot_invalidated.return_value = True

    page.poll_invalidated_snapshot_if_needed()

    page.reload_invalidated_snapshot_if_needed.assert_not_called()
