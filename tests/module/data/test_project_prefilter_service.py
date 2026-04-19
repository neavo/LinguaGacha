from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from module.Data.Core.Item import Item
from module.Data.Core.BatchService import BatchService
from module.Data.Core.ItemService import ItemService
from module.Data.Project.ProjectPrefilterService import ProjectPrefilterService
from module.Data.Core.ProjectSession import ProjectSession
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Filter.ProjectPrefilter import ProjectPrefilterStats


def make_config() -> SimpleNamespace:
    return SimpleNamespace(
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )


def build_service() -> tuple[ProjectPrefilterService, ProjectSession]:
    session = ProjectSession()
    session.db = SimpleNamespace(
        update_batch=MagicMock(),
        delete_analysis_item_checkpoints=MagicMock(),
        clear_analysis_candidate_aggregates=MagicMock(),
    )
    session.lg_path = "demo/project.lg"
    item_service = ItemService(session)
    item_service.clear_item_cache = MagicMock()
    batch_service = BatchService(session)
    return ProjectPrefilterService(session, item_service, batch_service), session


def test_enqueue_request_starts_worker_on_first_request() -> None:
    service, _session = build_service()

    request, start_worker = service.enqueue_request(
        make_config(),
        reason="unit_test",
        lg_path="demo/project.lg",
    )

    assert start_worker is True
    assert request.token == 1
    assert request.seq == 1
    assert service.prefilter_running is True


def test_enqueue_request_merges_when_running() -> None:
    service, _session = build_service()
    service.prefilter_running = True
    service.prefilter_active_token = 9
    service.prefilter_request_seq = 4

    request, start_worker = service.enqueue_request(
        make_config(),
        reason="merge",
        lg_path="demo/project.lg",
    )

    assert start_worker is False
    assert request.token == 9
    assert request.seq == 5


def test_is_prefilter_needed_only_skips_when_config_matches_exactly() -> None:
    service, _session = build_service()
    config = make_config()

    assert (
        service.is_prefilter_needed(
            {
                "source_language": "EN",
                "mtool_optimizer_enable": False,
            },
            config,
        )
        is False
    )
    config.target_language = "JP"
    assert (
        service.is_prefilter_needed(
            {
                "source_language": "EN",
                "mtool_optimizer_enable": False,
            },
            config,
        )
        is False
    )
    assert service.is_prefilter_needed({"source_language": "EN"}, config) is True
    assert service.is_prefilter_needed("bad-config", config) is True


def test_enqueue_sync_request_waits_when_running(monkeypatch) -> None:
    service, _session = build_service()
    service.prefilter_running = True
    service.prefilter_active_token = 5

    wait_called = {"value": False}

    def fake_wait_for(predicate):
        service.prefilter_running = False
        wait_called["value"] = True
        return bool(predicate())

    monkeypatch.setattr(service.prefilter_cond, "wait_for", fake_wait_for)

    request, should_run = service.enqueue_sync_request(
        make_config(),
        reason="running",
        lg_path="demo/project.lg",
    )

    assert request is None
    assert should_run is False
    assert wait_called["value"] is True


def test_enqueue_sync_request_returns_request_when_idle() -> None:
    service, _session = build_service()

    request, should_run = service.enqueue_sync_request(
        make_config(),
        reason="sync",
        lg_path="demo/project.lg",
    )

    assert request is not None
    assert request.token == 1
    assert request.seq == 1
    assert should_run is True
    assert service.prefilter_running is True


def test_pop_pending_request_mark_handled_and_finish_worker_reset_runtime_flags() -> (
    None
):
    service, _session = build_service()
    request, _start_worker = service.enqueue_request(
        make_config(),
        reason="queue",
        lg_path="demo/project.lg",
    )

    popped = service.pop_pending_request()
    service.mark_request_handled(request)
    service.finish_worker()

    assert popped == request
    assert service.pop_pending_request() is None
    assert service.prefilter_last_handled_seq == request.seq
    assert service.prefilter_running is False
    assert service.prefilter_active_token == 0


def test_apply_once_updates_batch_and_clears_analysis_tables(monkeypatch) -> None:
    service, session = build_service()
    items = [Item(id=1, src="A"), Item(id=2, src="B")]
    session.meta_cache["analysis_candidate_count"] = 7

    expected_result = ProjectPrefilterResult(
        stats=ProjectPrefilterStats(
            rule_skipped=0,
            language_skipped=0,
            mtool_skipped=0,
        ),
        prefilter_config={
            "source_language": "EN",
            "mtool_optimizer_enable": False,
        },
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectPrefilterService.ProjectPrefilter.apply",
        MagicMock(return_value=expected_result),
    )

    result = service.apply_once(
        service.build_request(
            make_config(),
            reason="apply",
            lg_path="demo/project.lg",
            token=1,
        ),
        items=items,
    )

    assert result == expected_result
    assert session.meta_cache["prefilter_config"] == expected_result.prefilter_config
    assert session.meta_cache["analysis_extras"] == {}
    assert session.meta_cache["analysis_candidate_count"] == 0
    assert "source_language" not in session.meta_cache
    assert "target_language" not in session.meta_cache
    session.db.delete_analysis_item_checkpoints.assert_called_once()
    assert "analysis_term_pool" not in session.meta_cache


def test_apply_once_returns_none_when_project_not_loaded() -> None:
    service, session = build_service()
    session.db = None

    result = service.apply_once(
        service.build_request(
            make_config(),
            reason="apply",
            lg_path="demo/project.lg",
            token=1,
        ),
        items=[Item(id=1, src="A")],
    )

    assert result is None


def test_apply_once_ignores_stale_request_when_project_path_changes(
    monkeypatch,
) -> None:
    service, session = build_service()
    items = [Item(id=1, src="A")]
    expected_result = ProjectPrefilterResult(
        stats=ProjectPrefilterStats(
            rule_skipped=0,
            language_skipped=0,
            mtool_skipped=0,
        ),
        prefilter_config={
            "source_language": "EN",
            "mtool_optimizer_enable": False,
        },
    )

    def fake_apply(*args, **kwargs):
        _ = args
        _ = kwargs
        session.lg_path = "demo/other-project.lg"
        return expected_result

    monkeypatch.setattr(
        "module.Data.Project.ProjectPrefilterService.ProjectPrefilter.apply",
        fake_apply,
    )

    result = service.apply_once(
        service.build_request(
            make_config(),
            reason="apply",
            lg_path="demo/project.lg",
            token=1,
        ),
        items=items,
    )

    assert result is None
    session.db.update_batch.assert_not_called()
    session.db.delete_analysis_item_checkpoints.assert_not_called()
    session.db.clear_analysis_candidate_aggregates.assert_not_called()
