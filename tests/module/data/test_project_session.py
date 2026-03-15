from module.Data.ProjectSession import ProjectSession
from module.Data.LGDatabase import LGDatabase


def test_project_session_initial_state() -> None:
    session = ProjectSession()

    assert session.db is None
    assert session.lg_path is None
    assert session.meta_cache == {}
    assert session.rule_cache == {}
    assert session.rule_text_cache == {}
    assert session.item_cache is None
    assert session.item_cache_index == {}
    assert len(session.asset_decompress_cache) == 0


def test_clear_all_caches_only_clears_cache_fields() -> None:
    session = ProjectSession()
    db = LGDatabase("demo/sample.lg")
    session.db = db
    session.lg_path = "demo/sample.lg"
    session.meta_cache = {"name": "demo"}
    session.rule_cache = {LGDatabase.RuleType.GLOSSARY: [{"src": "A"}]}
    session.rule_text_cache = {LGDatabase.RuleType.CUSTOM_PROMPT_EN: "prompt"}
    session.item_cache = [{"id": 1, "src": "A"}]
    session.item_cache_index = {1: 0}
    session.asset_decompress_cache["a.txt"] = b"data"

    session.clear_all_caches()

    assert session.db is db
    assert session.lg_path == "demo/sample.lg"
    assert session.meta_cache == {}
    assert session.rule_cache == {}
    assert session.rule_text_cache == {}
    assert session.item_cache is None
    assert session.item_cache_index == {}
    assert len(session.asset_decompress_cache) == 0
