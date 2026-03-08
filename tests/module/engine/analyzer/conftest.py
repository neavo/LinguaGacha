from collections.abc import Callable
from types import SimpleNamespace

import pytest

from base.Base import Base
from model.Item import Item
from module.Engine.Analyzer.AnalysisModels import AnalysisFilePlan
from module.Engine.Engine import Engine


class FakeDataManager:
    """最小假数据管理器，用来隔离分析器测试的数据库副作用。"""

    def __init__(self) -> None:
        self.loaded = True
        self.analysis_state: dict[str, Base.ProjectStatus] = {}
        self.analysis_extras: dict[str, object] = {}
        self.updated_rules: list[dict] = []
        self.clear_calls = 0
        self.open_calls = 0
        self.close_calls = 0

    def is_loaded(self) -> bool:
        return self.loaded

    def open_db(self) -> None:
        self.open_calls += 1

    def close_db(self) -> None:
        self.close_calls += 1

    def clear_analysis_progress(self) -> None:
        self.clear_calls += 1
        self.analysis_state = {}
        self.analysis_extras = {}

    def get_analysis_state(self) -> dict[str, Base.ProjectStatus]:
        return dict(self.analysis_state)

    def set_analysis_state(self, state: dict[str, Base.ProjectStatus | str]) -> None:
        normalized: dict[str, Base.ProjectStatus] = {}
        for rel_path, status in state.items():
            if isinstance(status, Base.ProjectStatus):
                normalized[rel_path] = status
            else:
                normalized[rel_path] = Base.ProjectStatus(str(status))
        self.analysis_state = normalized

    def get_analysis_extras(self) -> dict[str, object]:
        return dict(self.analysis_extras)

    def set_analysis_extras(self, extras: dict[str, object]) -> None:
        self.analysis_extras = dict(extras)

    def merge_glossary_incoming(
        self,
        incoming: list[dict[str, object]],
        *,
        merge_mode: object,
        save: bool,
    ) -> tuple[list[dict[str, object]], SimpleNamespace]:
        del merge_mode, save
        return list(incoming), SimpleNamespace(added=len(incoming), filled=0)

    def update_batch(
        self,
        items: list[dict[str, object]] | None = None,
        rules: dict[object, object] | None = None,
        meta: dict[str, object] | None = None,
    ) -> None:
        del items, meta
        if rules is not None:
            self.updated_rules.append(rules)

    def get_all_items(self) -> list[Item]:
        return []


@pytest.fixture(autouse=True)
def reset_engine_singleton() -> None:
    if hasattr(Engine, "__instance__"):
        delattr(Engine, "__instance__")
    yield
    if hasattr(Engine, "__instance__"):
        delattr(Engine, "__instance__")


@pytest.fixture
def fake_data_manager() -> FakeDataManager:
    return FakeDataManager()


@pytest.fixture
def plan_factory() -> Callable[[str, int], AnalysisFilePlan]:
    def make_plan(file_path: str, chunk_count: int) -> AnalysisFilePlan:
        chunks = tuple(
            (Item(src=f"{file_path}-{index}"),) for index in range(chunk_count)
        )
        return AnalysisFilePlan(file_path=file_path, chunks=chunks)

    return make_plan
