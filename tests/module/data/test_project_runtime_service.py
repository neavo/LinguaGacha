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

    def get_name_dst(self):
        return None

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

    def get_items_all(self):
        return [StubItem()]


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
        "status",
        "text_type",
        "retry_count",
    ]
    assert block["rows"] == [[1, "chapter01.txt", 0, "原文", "译文", "DONE", "", 0]]


def test_build_files_block_uses_fields_and_rows():
    data_manager = StubDataManager()
    service = ProjectRuntimeService(data_manager)

    block = service.build_files_block()

    assert block["fields"] == ["rel_path", "file_type", "sort_index"]
    assert block["rows"] == [["chapter01.txt", "TXT", 0]]


class OrderedStubItem:
    def __init__(self, item_id: int, file_path: str, file_type: str) -> None:
        self.item_id = item_id
        self.file_path = file_path
        self.file_type = file_type

    def get_id(self):
        return self.item_id

    def get_file_path(self):
        return self.file_path

    def get_file_type(self):
        return self.file_type

    def get_src(self):
        return "原文"

    def get_dst(self):
        return "译文"

    def get_name_dst(self):
        return None

    def get_status(self):
        return StubStatus()

    def get_row(self):
        return 0

    def get_text_type(self):
        return None

    def get_retry_count(self):
        return 0


class OrderedStubDataManager:
    def get_all_asset_records(self):
        return [
            {"path": "script/a.txt", "sort_order": 0},
            {"path": "script/b.txt", "sort_order": 1},
            {"path": "script/c.txt", "sort_order": 2},
        ]

    def get_items_all(self):
        return [
            OrderedStubItem(2, "script/b.txt", "TXT"),
            OrderedStubItem(1, "script/a.txt", "TXT"),
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
