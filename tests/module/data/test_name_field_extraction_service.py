from __future__ import annotations

from typing import Any

from model.Item import Item


class FakeDataManager:
    """提供姓名提取服务所需的最小数据桩。"""

    def __init__(
        self,
        *,
        loaded: bool = True,
        items: list[Item] | None = None,
        glossary: list[dict[str, Any]] | None = None,
    ) -> None:
        self.loaded = loaded
        self.items = list(items or [])
        self.glossary = [dict(entry) for entry in glossary or []]
        self.saved_glossary: list[dict[str, Any]] | None = None

    def is_loaded(self) -> bool:
        return self.loaded

    def get_all_items(self) -> list[Item]:
        return list(self.items)

    def get_glossary(self) -> list[dict[str, Any]]:
        return [dict(entry) for entry in self.glossary]

    def set_glossary(self, entries: list[dict[str, Any]], save: bool = True) -> None:
        del save
        self.saved_glossary = [dict(entry) for entry in entries]
        self.glossary = [dict(entry) for entry in entries]


class FakeConfig:
    """提供姓名翻译服务所需的最小配置桩。"""

    def __init__(self, *, activate_model_id: str = "demo-model") -> None:
        self.activate_model_id = activate_model_id

    def load(self) -> FakeConfig:
        return self


class FakeEngine:
    """同步回放翻译结果，便于断言成功失败统计。"""

    def __init__(self, responses: dict[str, tuple[bool, str]]) -> None:
        self.responses = dict(responses)

    def translate_single_item(
        self,
        item: Item,
        config: FakeConfig,
        callback: Any,
    ) -> None:
        del config
        src = item.get_src()
        success, translated = self.responses.get(src, (False, ""))
        result_item = Item()
        result_item.set_dst(translated)
        callback(result_item, success)


def build_item(src: str, name_src: str | list[str] | None) -> Item:
    item = Item()
    item.set_src(src)
    item.set_name_src(name_src)
    return item


def test_name_field_extraction_service_extracts_unique_names_and_longest_context() -> (
    None
):
    from module.Data.Extra.NameFieldExtractionService import NameFieldExtractionService

    # Arrange
    data_manager = FakeDataManager(
        items=[
            build_item("勇者が来た", "勇者"),
            build_item("勇者", "勇者"),
            build_item("魔王も来た", ["魔王", "勇者"]),
        ],
        glossary=[{"src": "魔王", "dst": "Demon King"}],
    )
    service = NameFieldExtractionService(data_manager_getter=lambda: data_manager)

    # Act
    snapshot = service.extract_name_fields()

    # Assert
    assert snapshot["items"][0]["src"] == "勇者"
    assert snapshot["items"][0]["context"] == "勇者が来た"
    assert snapshot["items"][1]["src"] == "魔王"
    assert snapshot["items"][1]["dst"] == "Demon King"


def test_translate_name_fields_returns_success_failure_counts_and_keeps_order() -> None:
    from module.Data.Extra.NameFieldExtractionService import NameFieldExtractionService

    # Arrange
    engine = FakeEngine(
        {
            "【勇者】\n勇者が来た": (True, "【Hero】\nThe hero arrived"),
            "【魔王】\n魔王も来た": (False, ""),
        }
    )
    service = NameFieldExtractionService(
        engine_getter=lambda: engine,
        config_loader=lambda: FakeConfig(),
    )

    # Act
    result = service.translate_name_fields(
        [
            {"src": "勇者", "dst": "", "context": "勇者が来た", "status": "未翻译"},
            {"src": "魔王", "dst": "", "context": "魔王も来た", "status": "未翻译"},
        ]
    )

    # Assert
    assert result["success_count"] == 1
    assert result["failed_count"] == 1
    assert result["items"][0]["src"] == "勇者"
    assert result["items"][0]["dst"] == "Hero"
    assert result["items"][1]["src"] == "魔王"
    assert result["items"][1]["dst"] == ""


def test_save_name_fields_to_glossary_merges_existing_entries() -> None:
    from module.Data.Extra.NameFieldExtractionService import NameFieldExtractionService

    # Arrange
    data_manager = FakeDataManager(
        glossary=[
            {
                "src": "魔王",
                "dst": "Old Name",
                "info": "",
                "case_sensitive": False,
            },
            {
                "src": "贤者",
                "dst": "Sage",
                "info": "",
                "case_sensitive": False,
            },
        ]
    )
    service = NameFieldExtractionService(data_manager_getter=lambda: data_manager)

    # Act
    snapshot = service.save_name_fields_to_glossary(
        [
            {
                "src": "勇者",
                "dst": "Hero",
                "context": "勇者が来た",
                "status": "翻译完成",
            },
            {
                "src": "魔王",
                "dst": "Demon King",
                "context": "魔王も来た",
                "status": "翻译完成",
            },
        ]
    )

    # Assert
    assert data_manager.saved_glossary is not None
    assert data_manager.saved_glossary == [
        {
            "src": "勇者",
            "dst": "Hero",
            "info": "",
            "case_sensitive": False,
        },
        {
            "src": "贤者",
            "dst": "Sage",
            "info": "",
            "case_sensitive": False,
        },
        {
            "src": "魔王",
            "dst": "Demon King",
            "info": "",
            "case_sensitive": False,
        },
    ]
    assert snapshot["items"][0]["src"] == "勇者"
