from api.Application.WorkbenchAppService import WorkbenchAppService


def test_parse_file_routes_through_workbench_manager(
    workbench_app_service: WorkbenchAppService,
    fake_workbench_manager,
) -> None:
    """工作台 Py 服务只保留文件解析预演，写 mutation 已迁到 TS Gateway。"""

    result = workbench_app_service.parse_file(
        {"source_paths": ["C:/next/b.txt", "C:/next/c.txt"]}
    )

    assert result["files"][0]["target_rel_path"] == "script/b.txt"
    assert result["files"][0]["file_type"] == "TXT"
    assert result["files"][0]["source_path"] == "C:/next/b.txt"
    assert fake_workbench_manager.parse_calls == [
        ("C:/next/b.txt", None),
        ("C:/next/c.txt", None),
    ]


def test_parse_file_skips_failed_entries() -> None:
    """批量解析允许单文件失败，避免一个坏文件阻断整批预演。"""

    class PartlyFailingWorkbenchManager:
        def parse_file_preview(self, source_path: str) -> dict[str, object]:
            """模拟只读解析能力，坏文件抛错后由服务层跳过。"""

            if source_path.endswith("bad.txt"):
                raise ValueError("parse failed")
            return {
                "target_rel_path": "ok.txt",
                "file_type": "TXT",
                "parsed_items": [],
            }

    service = WorkbenchAppService(PartlyFailingWorkbenchManager())

    result = service.parse_file({"source_paths": ["C:/next/ok.txt", "C:/next/bad.txt"]})

    assert result == {
        "files": [
            {
                "source_path": "C:/next/ok.txt",
                "target_rel_path": "ok.txt",
                "file_type": "TXT",
                "parsed_items": [],
            }
        ]
    }
