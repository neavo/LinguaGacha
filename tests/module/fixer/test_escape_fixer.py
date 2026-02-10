from module.Fixer.EscapeFixer import EscapeFixer


class TestEscapeFixer:
    def test_replace_newline_with_literal_escape(self) -> None:
        src = r"\\n[1]"
        dst = "line1\nline2"

        assert EscapeFixer.fix(src, dst) == "line1\\\\nline2"

    def test_return_original_when_escape_group_count_differs(self) -> None:
        src = r"\\a\\b\\c"
        dst = r"\\a\\\\b"

        assert EscapeFixer.fix(src, dst) == dst

    def test_align_escape_sequence_with_source(self) -> None:
        src = r"\\\\n[1] \\\\E"
        dst = r"\\n[1] \\E"

        assert EscapeFixer.fix(src, dst) == src
