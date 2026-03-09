from module.Response.AnalysisResponseDecoder import AnalysisResponseDecoder


def test_decode_rejects_missing_terms_field() -> None:
    assert AnalysisResponseDecoder().decode('{"bad": []}') is None


def test_decode_rejects_non_string_term_field() -> None:
    response = '{"src":"Alice","dst":1,"type":"女性人名"}'

    assert AnalysisResponseDecoder().decode(response) is None


def test_decode_accepts_json_lines_with_type_field() -> None:
    response = """
{"src":"ガブリエラ","dst":"加布里埃拉","type":"女性人名"}
{"src":"ダリヤ","dst":"达莉娅","type":"女性人名"}
""".strip()

    assert AnalysisResponseDecoder().decode(response) == [
        {"src": "ガブリエラ", "dst": "加布里埃拉", "info": "女性人名"},
        {"src": "ダリヤ", "dst": "达莉娅", "info": "女性人名"},
    ]


def test_decode_accepts_single_json_line_term_object() -> None:
    response = '{"src":"HP","dst":"生命值","type":"属性"}'

    assert AnalysisResponseDecoder().decode(response) == [
        {"src": "HP", "dst": "生命值", "info": "属性"}
    ]


def test_decode_rejects_new_terms_object_shape() -> None:
    response = '{"terms":[{"src":"Alice","dst":"爱丽丝","info":"女性人名"}]}'

    assert AnalysisResponseDecoder().decode(response) is None
