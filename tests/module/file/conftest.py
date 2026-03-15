from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path

import pytest

from base.BaseLanguage import BaseLanguage
from module.Config import Config


class DummyDataManager:
    def __init__(self, translated_path: Path, bilingual_path: Path) -> None:
        self.translated_path = translated_path
        self.bilingual_path = bilingual_path
        self.assets: dict[str, bytes] = {}

    def get_translated_path(self) -> str:
        return str(self.translated_path)

    def get_bilingual_path(self) -> str:
        return str(self.bilingual_path)

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        return self.assets.get(rel_path)

    def timestamp_suffix_context(self):
        return nullcontext()


@pytest.fixture
def config() -> Config:
    cfg = Config()
    cfg.source_language = BaseLanguage.Enum.JA
    cfg.target_language = BaseLanguage.Enum.ZH
    cfg.deduplication_in_bilingual = True
    cfg.write_translated_name_fields_to_file = True
    return cfg


@pytest.fixture
def dummy_data_manager(fs) -> DummyDataManager:
    del fs
    translated_path = Path("/fake/translated")
    bilingual_path = Path("/fake/bilingual")
    translated_path.mkdir(parents=True, exist_ok=True)
    bilingual_path.mkdir(parents=True, exist_ok=True)
    return DummyDataManager(translated_path, bilingual_path)
