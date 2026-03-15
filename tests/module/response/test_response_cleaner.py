from module.Response.ResponseCleaner import ResponseCleaner


def test_extract_why_from_response_splits_cleaned_text_and_why_block() -> None:
    cleaned, why_text = ResponseCleaner.extract_why_from_response(
        "start\n<why> first </why>\nbody\n<why>second</why>"
    )

    assert cleaned == "start\n\nbody\n"
    assert why_text == "first\nsecond"


def test_extract_why_from_response_returns_original_when_no_why_block() -> None:
    assert ResponseCleaner.extract_why_from_response("plain text") == ("plain text", "")


def test_normalize_blank_lines_compresses_consecutive_empty_lines() -> None:
    assert ResponseCleaner.normalize_blank_lines("a\n\n\nb\n \n\nc") == "a\n\nb\n\nc"


def test_merge_text_blocks_joins_non_empty_blocks() -> None:
    assert ResponseCleaner.merge_text_blocks("first", "second") == "first\nsecond"
    assert ResponseCleaner.merge_text_blocks("", "second") == "second"
    assert ResponseCleaner.merge_text_blocks("", "") == ""
