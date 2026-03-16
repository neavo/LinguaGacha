from module.Response.ResponseCleaner import ResponseCleaner


def test_extract_why_from_response_returns_empty_values_for_empty_response() -> None:
    assert ResponseCleaner.extract_why_from_response("") == ("", "")


def test_extract_why_from_response_splits_cleaned_text_and_why_block() -> None:
    cleaned, why_text = ResponseCleaner.extract_why_from_response(
        "start\n<why> first </why>\nbody\n<why>second</why>"
    )

    assert cleaned == "start\n\nbody\n"
    assert why_text == "first\nsecond"


def test_extract_why_from_response_returns_original_when_no_why_block() -> None:
    assert ResponseCleaner.extract_why_from_response("plain text") == ("plain text", "")


def test_normalize_blank_lines_returns_empty_text_when_input_is_empty() -> None:
    assert ResponseCleaner.normalize_blank_lines("") == ""


def test_normalize_blank_lines_compresses_consecutive_empty_lines() -> None:
    assert ResponseCleaner.normalize_blank_lines("a\n\n\nb\n \n\nc") == "a\n\nb\n\nc"


def test_merge_text_blocks_joins_two_non_empty_blocks() -> None:
    assert ResponseCleaner.merge_text_blocks("first", "second") == "first\nsecond"


def test_merge_text_blocks_keeps_only_non_empty_second_block() -> None:
    assert ResponseCleaner.merge_text_blocks("", "second") == "second"


def test_merge_text_blocks_returns_empty_when_both_blocks_are_empty() -> None:
    assert ResponseCleaner.merge_text_blocks("", "") == ""
