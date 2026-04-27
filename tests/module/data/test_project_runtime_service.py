from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService


class StubStatus:
    value = "DONE"


class StubItem:
    def get_id(self):
        return 1

    def get_file_path(self):
        return "chapter01.txt"

    def get_file_type(self):
        return "TXT"

    def get_src(self):
        return "原文"

    def get_dst(self):
        return "译文"

    def get_name_src(self):
        return "爱丽丝"

    def get_name_dst(self):
        return "Alice"

    def get_status(self):
        return StubStatus()

    def get_row(self):
        return 0

    def get_text_type(self):
        return None

    def get_retry_count(self):
        return 0


class StubDataManager:
    def get_all_asset_records(self):
        return [{"path": "chapter01.txt", "sort_order": 0}]

    def get_all_item_dicts(self):
        item = StubItem()
        return [
            {
                "id": item.get_id(),
                "file_path": item.get_file_path(),
                "file_type": item.get_file_type(),
                "row": item.get_row(),
                "src": item.get_src(),
                "dst": item.get_dst(),
                "name_src": item.get_name_src(),
                "name_dst": item.get_name_dst(),
                "status": item.get_status(),
                "text_type": item.get_text_type(),
                "retry_count": item.get_retry_count(),
            }
        ]


def test_build_items_block_uses_fields_and_rows():
    data_manager = StubDataManager()
    service = ProjectRuntimeService(data_manager)

    block = service.build_items_block()

    assert block["fields"] == [
        "item_id",
        "file_path",
        "row_number",
        "src",
        "dst",
        "name_src",
        "name_dst",
        "status",
        "text_type",
        "retry_count",
    ]
    assert block["rows"] == [
        [1, "chapter01.txt", 0, "原文", "译文", "爱丽丝", "Alice", "DONE", "", 0]
    ]


def test_build_files_block_uses_fields_and_rows():
    data_manager = StubDataManager()
    service = ProjectRuntimeService(data_manager)

    block = service.build_files_block()

    assert block["fields"] == ["rel_path", "file_type", "sort_index"]
    assert block["rows"] == [["chapter01.txt", "TXT", 0]]


class OrderedStubDataManager:
    def get_all_asset_records(self):
        return [
            {"path": "script/a.txt", "sort_order": 0},
            {"path": "script/b.txt", "sort_order": 1},
            {"path": "script/c.txt", "sort_order": 2},
        ]

    def get_all_item_dicts(self):
        return [
            {
                "id": 2,
                "file_path": "script/b.txt",
                "file_type": "TXT",
                "row": 0,
                "src": "原文",
                "dst": "译文",
                "status": StubStatus(),
            },
            {
                "id": 1,
                "file_path": "script/a.txt",
                "file_type": "TXT",
                "row": 0,
                "src": "原文",
                "dst": "译文",
                "status": StubStatus(),
            },
        ]


def test_build_files_block_preserves_asset_sort_order():
    data_manager = OrderedStubDataManager()
    service = ProjectRuntimeService(data_manager)

    block = service.build_files_block()

    assert block["rows"] == [
        ["script/a.txt", "TXT", 0],
        ["script/b.txt", "TXT", 1],
        ["script/c.txt", "NONE", 2],
    ]


class CountingDataManager(OrderedStubDataManager):
    def __init__(self) -> None:
        self.item_dict_calls = 0

    def get_all_item_dicts(self):
        self.item_dict_calls += 1
        return super().get_all_item_dicts()


def test_build_files_items_blocks_reuses_one_item_dict_snapshot():
    data_manager = CountingDataManager()
    service = ProjectRuntimeService(data_manager)

    blocks = service.build_files_items_blocks()

    assert data_manager.item_dict_calls == 1
    assert blocks["files"]["rows"] == [
        ["script/a.txt", "TXT", 0],
        ["script/b.txt", "TXT", 1],
        ["script/c.txt", "NONE", 2],
    ]
    assert blocks["items"]["rows"] == [
        [2, "script/b.txt", 0, "原文", "译文", None, None, "DONE", "NONE", 0],
        [1, "script/a.txt", 0, "原文", "译文", None, None, "DONE", "NONE", 0],
    ]


def test_build_item_records_keeps_partial_filter_semantics():
    data_manager = OrderedStubDataManager()
    service = ProjectRuntimeService(data_manager)

    records = service.build_item_records(item_ids=[1])

    assert records == [
        {
            "item_id": 1,
            "file_path": "script/a.txt",
            "row_number": 0,
            "src": "原文",
            "dst": "译文",
            "name_src": None,
            "name_dst": None,
            "status": "DONE",
            "text_type": "NONE",
            "retry_count": 0,
        }
    ]
