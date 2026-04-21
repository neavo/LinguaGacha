def test_load_project_returns_loaded_snapshot(
    project_app_service,
    fake_project_manager,
    lg_path: str,
) -> None:
    result = project_app_service.load_project({"path": lg_path})

    assert fake_project_manager.load_calls == [lg_path]
    assert result["project"]["path"] == lg_path
    assert result["project"]["loaded"] is True


def test_create_project_loads_output_path_and_returns_loaded_snapshot(
    project_app_service,
    fake_project_manager,
) -> None:
    result = project_app_service.create_project(
        {
            "source_path": "E:/Project/LinguaGacha/source",
            "path": "E:/Project/LinguaGacha/output/demo.lg",
        }
    )

    assert fake_project_manager.create_calls == [
        (
            "E:/Project/LinguaGacha/source",
            "E:/Project/LinguaGacha/output/demo.lg",
        )
    ]
    assert fake_project_manager.load_calls == ["E:/Project/LinguaGacha/output/demo.lg"]
    assert result["project"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "loaded": True,
    }


def test_get_project_snapshot_uses_current_loaded_project_path(
    project_app_service,
    fake_project_manager,
) -> None:
    fake_project_manager.load_project("E:/Project/LinguaGacha/output/demo.lg")

    result = project_app_service.get_project_snapshot({})

    assert result["project"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "loaded": True,
    }


def test_unload_project_returns_cleared_snapshot(
    project_app_service,
    fake_project_manager,
) -> None:
    fake_project_manager.load_project("E:/Project/LinguaGacha/output/demo.lg")

    result = project_app_service.unload_project({})

    assert result["project"] == {
        "path": "",
        "loaded": False,
    }


def test_collect_source_files_returns_serializable_paths(
    project_app_service,
) -> None:
    result = project_app_service.collect_source_files(
        {"path": "E:/Project/LinguaGacha/source"}
    )

    assert result == {
        "source_files": ["E:/Project/LinguaGacha/source"],
    }


def test_get_project_preview_returns_preview_payload(
    project_app_service,
) -> None:
    result = project_app_service.get_project_preview(
        {"path": "E:/Project/LinguaGacha/output/demo.lg"}
    )

    assert result["preview"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "name": "demo",
        "source_language": "JA",
        "target_language": "ZH",
        "file_count": 1,
        "created_at": "",
        "updated_at": "",
        "total_items": 8,
        "translated_items": 3,
        "progress": 0.375,
    }
