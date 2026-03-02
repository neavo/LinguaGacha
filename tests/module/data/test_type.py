from module.Data.Type import ASSET_DECOMPRESS_CACHE_MAX
from module.Data.Type import ProgressCallback
from module.Data.Type import RULE_META_KEYS


def test_progress_callback_can_be_called_with_expected_signature() -> None:
    calls: list[tuple[int, int, str]] = []

    def callback(done: int, total: int, message: str) -> None:
        calls.append((done, total, message))

    typed_callback: ProgressCallback = callback
    typed_callback(3, 10, "running")

    assert calls == [(3, 10, "running")]


def test_rule_meta_keys_contains_expected_entries() -> None:
    assert "glossary_enable" in RULE_META_KEYS
    assert "text_preserve_mode" in RULE_META_KEYS
    assert "custom_prompt_en_enable" in RULE_META_KEYS
    assert len(RULE_META_KEYS) == 6


def test_asset_decompress_cache_limit_is_stable() -> None:
    assert ASSET_DECOMPRESS_CACHE_MAX == 32
