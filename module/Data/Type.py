from typing import Callable


ProgressCallback = Callable[[int, int, str], None]


RULE_META_KEYS: set[str] = {
    "glossary_enable",
    "text_preserve_mode",
    "pre_translation_replacement_enable",
    "post_translation_replacement_enable",
    "translation_prompt_enable",
    "analysis_prompt_enable",
}


ASSET_DECOMPRESS_CACHE_MAX: int = 32
