from module.Data.Project.V2.RuntimeService import V2ProjectRuntimeService


class StubStatus:
    value = "DONE"


class StubItem:
    def get_id(self):
        return 1

    def get_file_path(self):
        return "chapter01.txt"

    def get_src(self):
        return "原文"

    def get_dst(self):
        return "译文"

    def get_status(self):
        return StubStatus()


class StubDataManager:
    def get_items_all(self):
        return [StubItem()]


def test_build_items_block_uses_schema_and_rows():
    data_manager = StubDataManager()
    service = V2ProjectRuntimeService(data_manager)

    block = service.build_items_block()

    assert block["schema"] == "project-items.v1"
    assert block["fields"] == ["item_id", "file_path", "src", "dst", "status"]
    assert block["rows"] == [[1, "chapter01.txt", "原文", "译文", "DONE"]]
