from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from module.Data.DataManager import DataManager
from module.Data.ProjectLifecycleService import ProjectLifecycleService
from module.Data.ProjectSession import ProjectSession


def build_service(session: ProjectSession) -> ProjectLifecycleService:
    meta_service = SimpleNamespace(refresh_cache_from_db=MagicMock())
    return ProjectLifecycleService(
        session,
        meta_service,
        MagicMock(),
        MagicMock(),
        DataManager.TextPreserveMode,
        DataManager.RuleType,
        DataManager.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE,
        DataManager.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE,
        DataManager.LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY,
    )


def build_fake_db(
    *,
    current_translation_prompt: str = "",
    legacy_prompt_zh: str = "",
    legacy_prompt_en: str = "",
) -> SimpleNamespace:
    return SimpleNamespace(
        set_meta=MagicMock(),
        close=MagicMock(),
        get_rule_text=MagicMock(return_value=current_translation_prompt),
        get_rule_text_by_name=MagicMock(
            side_effect=lambda rule_type: (
                legacy_prompt_zh
                if rule_type == DataManager.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE
                else legacy_prompt_en
            )
        ),
        set_rule_text=MagicMock(),
    )


def test_load_project_sets_session_and_migrates_legacy_values(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    session = ProjectSession()
    service = build_service(session)
    service.meta_service.refresh_cache_from_db = lambda: session.meta_cache.update(
        {"text_preserve_enable": True}
    )

    lg_path = Path("/workspace/project/demo.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = build_fake_db(legacy_prompt_zh="旧中文提示词")
    monkeypatch.setattr(
        "module.Data.ProjectLifecycleService.LGDatabase", lambda path: fake_db
    )

    service.load_project(str(lg_path))

    assert session.db is fake_db
    assert session.lg_path == str(lg_path)
    fake_db.set_meta.assert_any_call("text_preserve_mode", "custom")
    fake_db.set_meta.assert_any_call("translation_prompt_legacy_migrated", True)


def test_load_project_raises_when_project_missing(fs) -> None:
    del fs
    session = ProjectSession()
    service = build_service(session)

    with pytest.raises(FileNotFoundError, match="工程文件不存在"):
        service.load_project("/workspace/missing.lg")


def test_unload_project_closes_db_and_returns_old_path() -> None:
    session = ProjectSession()
    session.db = SimpleNamespace(close=MagicMock())
    session.lg_path = "demo.lg"
    service = build_service(session)

    old_path = service.unload_project()

    assert old_path == "demo.lg"
    session.db is None
