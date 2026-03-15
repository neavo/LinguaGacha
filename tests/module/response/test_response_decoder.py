from module.Response.ResponseDecoder import ResponseDecoder


class TestResponseDecoderLineBased:
    def test_decode_parses_translation_and_glossary_entries(self) -> None:
        response = """
{"0":"你好"}
{"src":"Alice","dst":"爱丽丝","gender":"female"}
{"invalid":1}
""".strip()

        dsts, glossary = ResponseDecoder().decode(response)

        assert dsts == ["你好"]
        assert glossary == [{"src": "Alice", "dst": "爱丽丝", "info": "female"}]

    def test_decode_skips_non_string_translation_values(self) -> None:
        response = '{"0":100}\n{"1":"ok"}'

        dsts, glossary = ResponseDecoder().decode(response)

        assert dsts == ["ok"]
        assert glossary == []

    def test_decode_skips_blank_lines_and_invalid_glossary_shape(self) -> None:
        response = '\n  \n{"src":"Alice","dst":"爱丽丝","role":"hero"}\n{"a":"A","b":"B"}\n{"0":"你好"}'

        dsts, glossary = ResponseDecoder().decode(response)

        assert dsts == ["你好"]
        assert glossary == []


class TestResponseDecoderFallback:
    def test_decode_uses_whole_json_when_line_parse_has_no_translation(self) -> None:
        response = '{"a":"A","b":2,"c":"C"}'

        dsts, glossary = ResponseDecoder().decode(response)

        assert dsts == ["A", "C"]
        assert glossary == []

    def test_decode_returns_empty_when_response_is_not_json(self) -> None:
        dsts, glossary = ResponseDecoder().decode("not a json response")

        assert dsts == []
        assert glossary == []
