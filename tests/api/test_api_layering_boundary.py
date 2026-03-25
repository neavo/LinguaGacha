import re
from pathlib import Path
from unittest.mock import Mock

from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Bridge.EventTopic import EventTopic
from api.Client.ApiStateStore import ApiStateStore
from api.Client.ApiClient import ApiClient
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Client.AppClientContext import AppClientContext
from api.Server.Routes.ProofreadingRoutes import ProofreadingRoutes
from api.Server.Routes.QualityRoutes import QualityRoutes
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSearchResult
from model.Api.ProofreadingModels import ProofreadingSnapshot
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot
from tests.api.boundary_contracts import PHASE_ONE_FRONTEND_FILES
from tests.api.boundary_contracts import PHASE_TWO_PROOFREADING_FRONTEND_FILES
from tests.api.boundary_contracts import PHASE_TWO_PROOFREADING_ROUTE_PATHS
from tests.api.boundary_contracts import PHASE_TWO_QUALITY_FRONTEND_FILES
from tests.api.boundary_contracts import PHASE_TWO_QUALITY_ROUTE_PATHS
from tests.api.boundary_contracts import PHASE_TWO_SPEC_ROUTE_PATHS
from tests.api.boundary_contracts import PROOFREADING_HELPER_FILES


def test_app_client_context_groups_ui_clients() -> None:
    context = AppClientContext(
        project_api_client=ProjectApiClient.__new__(ProjectApiClient),
        task_api_client=TaskApiClient.__new__(TaskApiClient),
        workbench_api_client=WorkbenchApiClient.__new__(WorkbenchApiClient),
        settings_api_client=SettingsApiClient.__new__(SettingsApiClient),
        quality_rule_api_client=QualityRuleApiClient.__new__(QualityRuleApiClient),
        proofreading_api_client=ProofreadingApiClient.__new__(ProofreadingApiClient),
        api_state_store=ApiStateStore(),
    )

    assert isinstance(context.api_state_store, ApiStateStore)
    assert isinstance(context.quality_rule_api_client, QualityRuleApiClient)
    assert isinstance(context.proofreading_api_client, ProofreadingApiClient)


def test_api_application_layer_does_not_import_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_dir = root_dir / "api" / "Application"

    for file_path in application_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "from api.Client" not in content
        assert "import api.Client" not in content


def test_ui_bootstrap_imports_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    app_content = (root_dir / "app.py").read_text(encoding="utf-8")
    window_content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(
        encoding="utf-8"
    )

    assert "from api.Client.AppClientContext import AppClientContext" in app_content
    assert "from api.Client.AppClientContext import AppClientContext" in window_content
    assert "from api.Application.AppContext import AppContext" not in app_content
    assert "from api.Application.AppContext import AppContext" not in window_content
    assert "quality_rule_api_client=QualityRuleApiClient(api_client)" in app_content
    assert "proofreading_api_client=ProofreadingApiClient(api_client)" in app_content
    assert (
        "self.quality_rule_api_client = app_client_context.quality_rule_api_client"
        in window_content
    )
    assert (
        "self.proofreading_api_client = app_client_context.proofreading_api_client"
        in window_content
    )
    assert re.search(
        r"self\.proofreading_page = ProofreadingPage\(\s*"
        r"\"proofreading_page\",\s*"
        r"self\.proofreading_api_client,\s*"
        r"self\.api_state_store,\s*"
        r"self,\s*\)",
        window_content,
        re.MULTILINE,
    )


def test_frontend_core_design_doc_uses_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (
        root_dir
        / "docs"
        / "superpowers"
        / "specs"
        / "2026-03-24-frontend-core-separation-design.md"
    ).read_text(encoding="utf-8")

    assert "AppClientContext.py" in spec_content
    assert "AppContext.py" not in spec_content


def test_phase_two_frontend_boundary_lists_are_declared_in_single_source() -> None:
    assert PHASE_TWO_QUALITY_FRONTEND_FILES
    assert PHASE_TWO_PROOFREADING_FRONTEND_FILES
    assert len(set(PHASE_ONE_FRONTEND_FILES)) == len(PHASE_ONE_FRONTEND_FILES)
    assert len(set(PHASE_TWO_QUALITY_FRONTEND_FILES)) == len(
        PHASE_TWO_QUALITY_FRONTEND_FILES
    )
    assert len(set(PHASE_TWO_PROOFREADING_FRONTEND_FILES)) == len(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PHASE_ONE_FRONTEND_FILES).isdisjoint(PHASE_TWO_QUALITY_FRONTEND_FILES)
    assert set(PHASE_ONE_FRONTEND_FILES).isdisjoint(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PHASE_TWO_QUALITY_FRONTEND_FILES).isdisjoint(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PROOFREADING_HELPER_FILES).issubset(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )


def test_phase_two_routes_match_registered_server_contract() -> None:
    quality_paths = (
        QualityRoutes.SNAPSHOT_PATH,
        QualityRoutes.UPDATE_META_PATH,
        QualityRoutes.SAVE_ENTRIES_PATH,
        QualityRoutes.IMPORT_RULES_PATH,
        QualityRoutes.EXPORT_RULES_PATH,
        QualityRoutes.RULE_PRESETS_PATH,
        QualityRoutes.RULE_PRESET_READ_PATH,
        QualityRoutes.RULE_PRESET_SAVE_PATH,
        QualityRoutes.RULE_PRESET_RENAME_PATH,
        QualityRoutes.RULE_PRESET_DELETE_PATH,
        QualityRoutes.QUERY_PROOFREADING_PATH,
        QualityRoutes.STATISTICS_PATH,
        QualityRoutes.PROMPT_SNAPSHOT_PATH,
        QualityRoutes.PROMPT_TEMPLATE_PATH,
        QualityRoutes.PROMPT_SAVE_PATH,
        QualityRoutes.PROMPT_IMPORT_PATH,
        QualityRoutes.PROMPT_EXPORT_PATH,
        QualityRoutes.PROMPT_PRESETS_PATH,
        QualityRoutes.PROMPT_PRESET_READ_PATH,
        QualityRoutes.PROMPT_PRESET_SAVE_PATH,
        QualityRoutes.PROMPT_PRESET_RENAME_PATH,
        QualityRoutes.PROMPT_PRESET_DELETE_PATH,
    )
    proofreading_paths = (
        ProofreadingRoutes.SNAPSHOT_PATH,
        ProofreadingRoutes.FILTER_PATH,
        ProofreadingRoutes.SEARCH_PATH,
        ProofreadingRoutes.SAVE_ITEM_PATH,
        ProofreadingRoutes.SAVE_ALL_PATH,
        ProofreadingRoutes.REPLACE_ALL_PATH,
        ProofreadingRoutes.RECHECK_ITEM_PATH,
        ProofreadingRoutes.RETRANSLATE_ITEMS_PATH,
    )

    assert quality_paths == PHASE_TWO_QUALITY_ROUTE_PATHS
    assert proofreading_paths == PHASE_TWO_PROOFREADING_ROUTE_PATHS

    quality_core_api_server = Mock()
    proofreading_core_api_server = Mock()
    quality_app_service = Mock()
    proofreading_app_service = Mock()

    QualityRoutes.register(quality_core_api_server, quality_app_service)
    ProofreadingRoutes.register(
        proofreading_core_api_server,
        proofreading_app_service,
    )

    quality_calls = quality_core_api_server.add_json_route.call_args_list
    proofreading_calls = proofreading_core_api_server.add_json_route.call_args_list

    assert tuple(call.args[0] for call in quality_calls) == ("POST",) * len(
        PHASE_TWO_QUALITY_ROUTE_PATHS
    )
    assert (
        tuple(call.args[1] for call in quality_calls) == PHASE_TWO_QUALITY_ROUTE_PATHS
    )
    assert tuple(call.args[0] for call in proofreading_calls) == ("POST",) * len(
        PHASE_TWO_PROOFREADING_ROUTE_PATHS
    )
    assert tuple(call.args[1] for call in proofreading_calls) == (
        PHASE_TWO_PROOFREADING_ROUTE_PATHS
    )


def test_phase_two_sse_and_client_contracts_use_real_runtime_symbols() -> None:
    assert (
        EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value
        == "proofreading.snapshot_invalidated"
    )

    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_type": "glossary"},
    )

    assert topic == EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value
    assert payload["reason"] == "quality_rule_update"

    api_client = Mock(spec=ApiClient)
    api_client.post.side_effect = [
        {
            "snapshot": {
                "rule_type": "glossary",
                "revision": 1,
            }
        },
        {
            "snapshot": {
                "rule_type": "glossary",
                "revision": 2,
            }
        },
        {
            "query": {
                "keyword": "勇者",
                "is_regex": True,
            }
        },
        {
            "snapshot": {
                "revision": 3,
                "items": [{"item_id": 1}],
            }
        },
        {
            "search_result": {
                "keyword": "勇者",
                "is_regex": False,
                "matched_item_ids": [1],
            }
        },
        {
            "result": {
                "revision": 4,
                "changed_item_ids": [1],
            }
        },
    ]

    quality_client = QualityRuleApiClient(api_client)
    proofreading_client = ProofreadingApiClient(api_client)

    quality_snapshot = quality_client.get_rule_snapshot("glossary")
    updated_snapshot = quality_client.update_meta({"rule_type": "glossary"})
    lookup_query = quality_client.query_proofreading({"src": "勇者", "regex": True})
    proofreading_snapshot = proofreading_client.get_snapshot({})
    search_result = proofreading_client.search({"keyword": "勇者"})
    mutation_result = proofreading_client.save_item({"item": {"id": 1}})

    assert isinstance(quality_snapshot, QualityRuleSnapshot)
    assert isinstance(updated_snapshot, QualityRuleSnapshot)
    assert isinstance(lookup_query, ProofreadingLookupQuery)
    assert isinstance(proofreading_snapshot, ProofreadingSnapshot)
    assert isinstance(search_result, ProofreadingSearchResult)
    assert isinstance(mutation_result, ProofreadingMutationResult)
    assert api_client.post.call_args_list[0].args[0] == QualityRoutes.SNAPSHOT_PATH
    assert api_client.post.call_args_list[1].args[0] == QualityRoutes.UPDATE_META_PATH
    assert (
        api_client.post.call_args_list[2].args[0]
        == QualityRoutes.QUERY_PROOFREADING_PATH
    )
    assert api_client.post.call_args_list[3].args[0] == ProofreadingRoutes.SNAPSHOT_PATH
    assert api_client.post.call_args_list[4].args[0] == ProofreadingRoutes.SEARCH_PATH
    assert (
        api_client.post.call_args_list[5].args[0] == ProofreadingRoutes.SAVE_ITEM_PATH
    )


def test_api_spec_documents_phase_two_routes_topics_and_errors() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (root_dir / "api" / "SPEC.md").read_text(encoding="utf-8")

    for route_path in PHASE_TWO_SPEC_ROUTE_PATHS:
        assert route_path in spec_content

    assert "proofreading.snapshot_invalidated" in spec_content
    assert "REVISION_CONFLICT" in spec_content
    assert '{"snapshot": {...}}' in spec_content
    assert '{"search_result": {...}}' in spec_content
    assert '{"result": {...}}' in spec_content
    assert '{"prompt": {...}}' in spec_content
