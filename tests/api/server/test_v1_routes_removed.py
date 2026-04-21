from types import SimpleNamespace

import httpx

from api.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_no_longer_registers_v1_runtime_routes() -> None:
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=object(),
        proofreading_app_service=object(),
        quality_rule_app_service=object(),
        task_app_service=SimpleNamespace(
            build_task_snapshot=lambda task_type: {"task_type": task_type}
        ),
        workbench_app_service=object(),
        model_app_service=object(),
        project_bootstrap_app_service=SimpleNamespace(
            runtime_service=None,
            stream_to_handler=lambda handler: None,
        ),
        project_mutation_app_service=object(),
        v2_project_app_service=object(),
        v2_task_app_service=object(),
        v2_model_app_service=object(),
        v2_quality_rule_app_service=object(),
    )

    old_runtime_routes = [
        ("GET", "/api/events/stream"),
        ("POST", "/api/project/load"),
        ("POST", "/api/tasks/snapshot"),
        ("POST", "/api/models/snapshot"),
        ("POST", "/api/workbench/snapshot"),
        ("POST", "/api/proofreading/snapshot"),
        ("POST", "/api/quality/rules/snapshot"),
    ]

    try:
        with httpx.Client(base_url=base_url) as client:
            for method, path in old_runtime_routes:
                response = client.request(method, path)
                assert response.status_code == 404
    finally:
        shutdown()
