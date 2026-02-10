from __future__ import annotations

import pytest
from lxml import etree

from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst


def test_normalize_slot_text_collapses_line_whitespace(config: Config) -> None:
    handler = EPUBAst(config)

    assert handler.normalize_slot_text("a\n\tb  c") == "a b c"
    assert handler.normalize_slot_text("不变") == "不变"


def test_build_elem_path_and_find_by_path_round_trip(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(
        b"<html><body><div><p>first</p><p><span>second</span></p></div></body></html>"
    )
    target = root.xpath(".//*[local-name()='span']")[0]

    path = handler.build_elem_path(root, target)
    found = handler.find_by_path(root, path)

    assert path.endswith("/span[1]")
    assert found is target


def test_parse_elem_path_invalid_raises(config: Config) -> None:
    handler = EPUBAst(config)

    with pytest.raises(ValueError, match="Invalid element path"):
        handler.parse_elem_path("/html/body/p")


def test_normalize_html_named_entities_for_xml_respects_cdata(config: Config) -> None:
    handler = EPUBAst(config)
    raw = b"<p>&nbsp; &foo; <![CDATA[&nbsp;]]></p>"

    fixed = handler.normalize_html_named_entities_for_xml(raw)

    assert b"&#160;" in fixed
    assert b"&amp;foo;" in fixed
    assert b"<![CDATA[&nbsp;]]>" in fixed


def test_fix_ncx_bare_ampersands(config: Config) -> None:
    handler = EPUBAst(config)
    raw = b"<text>a&b <![CDATA[c&d]]> e&amp;f</text>"

    fixed = handler.fix_ncx_bare_ampersands(raw)

    assert b"a&amp;b" in fixed
    assert b"<![CDATA[c&d]]>" in fixed
    assert b"e&amp;f" in fixed
