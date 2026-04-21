from module.Data.Project.V2.RuntimeService import V2ProjectRuntimeService


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

    def get_status(self):
        return StubStatus()


class StubDataManager:
    def get_all_asset_paths(self):
        return ["chapter01.txt"]

    def get_items_all(self):
        return [StubItem()]


def test_build_items_block_uses_schema_and_rows():
    data_manager = StubDataManager()
    service = V2ProjectRuntimeService(data_manager)

    block = service.build_items_block()

    assert block["schema"] == "project-items.v1"
    assert block["fields"] == ["item_id", "file_path", "src", "dst", "status"]
    assert block["rows"] == [[1, "chapter01.txt", "原文", "译文", "DONE"]]


def test_build_files_block_uses_schema_and_rows():
    data_manager = StubDataManager()
    service = V2ProjectRuntimeService(data_manager)

    block = service.build_files_block()

    assert block["schema"] == "project-files.v1"
    assert block["fields"] == ["rel_path", "file_type"]
    assert block["rows"] == [["chapter01.txt", "TXT"]]


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

    def get_status(self):
        return StubStatus()


class OrderedStubDataManager:
    def get_all_asset_paths(self):
        return ["script/a.txt", "script/b.txt", "script/c.txt"]

    def get_items_all(self):
        return [
            OrderedStubItem(2, "script/b.txt", "TXT"),
            OrderedStubItem(1, "script/a.txt", "TXT"),
        ]


def test_build_files_block_preserves_asset_sort_order():
    data_manager = OrderedStubDataManager()
    service = V2ProjectRuntimeService(data_manager)

    block = service.build_files_block()

    assert block["rows"] == [
        ["script/a.txt", "TXT"],
        ["script/b.txt", "TXT"],
        ["script/c.txt", "NONE"],
    ]
