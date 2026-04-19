from __future__ import annotations

import pytest

from lxml import etree

from module.Config import Config

from module.File.EPUB.EPUBAst import EPUBAst

import io

import zipfile


from module.Data.Core.Item import Item

from pathlib import Path


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


def build_zip_with_files(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, content in files.items():
            zf.writestr(path, content)
    return buf.getvalue()


def test_local_name_handles_namespaced_tag(config: Config) -> None:
    handler = EPUBAst(config)
    assert handler.local_name("{urn:test}html") == "html"


def test_iter_children_elements_skips_comments(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<root><!--c--><a/><b/></root>")

    children = list(handler.iter_children_elements(root))

    assert [handler.local_name(str(c.tag)) for c in children] == ["a", "b"]


def test_build_elem_path_tolerates_orphan_element(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.Element("root")
    orphan = etree.Element("child")

    assert handler.build_elem_path(root, orphan) == "/root[1]"


def test_iter_elem_path_pairs_returns_empty_for_non_element_root(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    root = etree.Comment("x")

    assert list(handler.iter_elem_path_pairs(root)) == []


def test_find_by_path_returns_none_on_root_mismatch_or_out_of_range(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>t</p></body></html>")

    assert handler.find_by_path(root, "/bad[1]") is None
    assert handler.find_by_path(root, "/html[1]/body[1]/p[2]") is None


def test_parse_container_opf_path_raises_on_invalid_container(config: Config) -> None:
    handler = EPUBAst(config)

    container_missing = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles />
</container>
"""
    content = build_zip_with_files({"META-INF/container.xml": container_missing})
    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        with pytest.raises(ValueError, match="contains no OPF rootfile"):
            handler.parse_container_opf_path(zf)

    container_no_path = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles><rootfile full-path='' /></rootfiles>
</container>
"""
    content = build_zip_with_files({"META-INF/container.xml": container_no_path})
    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        with pytest.raises(ValueError, match="Invalid OPF full-path"):
            handler.parse_container_opf_path(zf)


def test_parse_opf_handles_invalid_version_and_ncx_fallback(config: Config) -> None:
    handler = EPUBAst(config)
    opf = b"""<?xml version='1.0'?>
<package version='x' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='ncxfile' href='toc.ncx' media-type='application/x-dtbncx+xml'/>
    <item id='bad' media-type='application/xhtml+xml'/>
  </manifest>
  <spine>
    <itemref idref='chap1'/>
    <itemref idref='missing'/>
  </spine>
</package>
"""
    content = build_zip_with_files({"OEBPS/content.opf": opf})

    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        pkg = handler.parse_opf(zf, "OEBPS/content.opf")

    assert pkg.opf_version_major == 2
    assert pkg.spine_paths == ["OEBPS/text/ch1.xhtml"]
    assert pkg.nav_path is None
    assert pkg.ncx_path == "OEBPS/toc.ncx"


def test_parse_opf_title_skips_blank_and_uses_next_non_empty(config: Config) -> None:
    handler = EPUBAst(config)
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'
    xmlns:dc='http://purl.org/dc/elements/1.1/'>
  <metadata>
    <dc:title>
    </dc:title>
    <dc:title>  Book  Title  </dc:title>
  </metadata>
  <manifest />
  <spine />
</package>
"""
    content = build_zip_with_files({"OEBPS/content.opf": opf})

    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        pkg = handler.parse_opf(zf, "OEBPS/content.opf")

    assert pkg.opf_title_text == " Book Title "
    assert pkg.opf_title_path is not None
    assert pkg.opf_title_path.endswith("/metadata[1]/title[2]")


def test_parse_opf_title_defensive_skips_non_element_nodes(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    content = build_zip_with_files({"OEBPS/content.opf": b"<package />"})

    class DummyRoot:
        def get(self, name: str) -> str | None:
            del name
            return None

        def xpath(self, expr: str):
            if "metadata" in expr and "title" in expr:
                return ["bad-node"]
            return []

    monkeypatch.setattr(
        "module.File.EPUB.EPUBAst.etree.fromstring",
        lambda data: DummyRoot(),
    )

    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        pkg = handler.parse_opf(zf, "OEBPS/content.opf")

    assert pkg.opf_title_path is None
    assert pkg.opf_title_text is None


def test_parse_xhtml_or_html_recovers_from_undefined_named_entity(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    raw = b"<html><body><p>Hi&nbsp;there</p></body></html>"

    root = handler.parse_xhtml_or_html(raw)
    text = root.xpath("string(.//*[local-name()='p'])")

    assert any(ord(ch) == 160 for ch in text)


def test_normalize_html_named_entities_for_xml_returns_raw_when_no_amp(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    raw = b"<p>hello</p>"
    fixed = handler.normalize_html_named_entities_for_xml(raw)
    assert fixed is raw


def test_fix_ncx_bare_ampersands_returns_raw_when_no_amp(config: Config) -> None:
    handler = EPUBAst(config)
    raw = b"<ncx><text>abc</text></ncx>"
    fixed = handler.fix_ncx_bare_ampersands(raw)
    assert fixed is raw


def test_iter_translatable_text_slots_uses_path_map_and_collects_tail(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(
        b"<html><body><p>Head<span>Mid</span>Tail</p></body></html>"
    )
    p = root.xpath(".//*[local-name()='p']")[0]
    path_map = handler.build_elem_path_map(root)

    slots = handler.iter_translatable_text_slots(root, p, path_map=path_map)
    refs = [ref for ref, _text in slots]

    assert [r.slot for r in refs] == ["text", "text", "tail"]
    assert refs[0].path == handler.build_elem_path(root, p)


def test_is_inside_skipped_subtree_detects_code_and_rt(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(
        b"<html><body><code><p>skip</p></code><ruby>\xe6\xbc\xa2<rt>\xe3\x81\x8b\xe3\x82\x93</rt></ruby></body></html>"
    )
    p = root.xpath(".//*[local-name()='p']")[0]
    rt = root.xpath(".//*[local-name()='rt']")[0]
    body = root.xpath(".//*[local-name()='body']")[0]

    assert handler.is_inside_skipped_subtree(p) is True
    assert handler.is_inside_skipped_subtree(rt) is True
    assert handler.is_inside_skipped_subtree(body) is False


def test_extract_items_from_ncx_builds_rows_and_digests(config: Config) -> None:
    handler = EPUBAst(config)
    raw = b"<ncx><navMap><navPoint><navLabel><text>A</text></navLabel></navPoint><navPoint><navLabel><text></text></navLabel></navPoint><navPoint><navLabel><text>B</text></navLabel></navPoint></navMap></ncx>"

    items = handler.extract_items_from_ncx("toc.ncx", raw, "book.epub")

    assert [it.get_src() for it in items] == ["A", "B"]
    assert [it.get_row() for it in items] == [
        handler.ROW_BASE_NCX,
        handler.ROW_BASE_NCX + 1,
    ]

    extra_field = items[0].get_extra_field()
    assert isinstance(extra_field, dict)
    epub = extra_field.get("epub")
    assert isinstance(epub, dict)
    assert epub["is_ncx"] is True
    assert epub["src_digest"] == handler.sha1_hex("A")


def test_read_from_stream_processes_nav_and_ncx_and_skips_non_html_spine(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    container = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf'/>
  </rootfiles>
</container>
"""
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='img' href='img/a.png' media-type='image/png'/>
    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>
    <item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/>
  </manifest>
  <spine toc='ncx'>
    <itemref idref='chap1'/>
    <itemref idref='img'/>
  </spine>
</package>
"""

    epub_bytes = build_zip_with_files(
        {
            "META-INF/container.xml": container,
            "OEBPS/content.opf": opf,
            "OEBPS/text/ch1.xhtml": b"<html><body><p>ok</p></body></html>",
            "OEBPS/img/a.png": b"PNG",
            "OEBPS/nav.xhtml": b"<html><body><nav epub:type='toc' xmlns:epub='http://www.idpf.org/2007/ops'>toc</nav></body></html>",
            "OEBPS/toc.ncx": b"<ncx><text>toc</text></ncx>",
        }
    )

    called_docs: list[tuple[str, bool]] = []

    def fake_extract_doc(
        doc_path: str,
        raw: bytes,
        spine_index: int,
        rel_path: str,
        is_nav: bool = False,
    ) -> list[Item]:
        del raw
        del spine_index
        del rel_path
        called_docs.append((doc_path, is_nav))
        return []

    def fake_extract_ncx(ncx_path: str, raw: bytes, rel_path: str) -> list[Item]:
        del raw
        return [
            Item.from_dict(
                {
                    "src": ncx_path,
                    "dst": ncx_path,
                    "row": 1,
                    "file_type": Item.FileType.EPUB,
                    "file_path": rel_path,
                }
            )
        ]

    warnings: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, e: Exception) -> None:
            del e
            warnings.append(msg)

    monkeypatch.setattr(handler, "extract_items_from_document", fake_extract_doc)
    monkeypatch.setattr(handler, "extract_items_from_ncx", fake_extract_ncx)
    monkeypatch.setattr(
        "module.File.EPUB.EPUBAst.LogManager.get", lambda: DummyLogger()
    )

    items = handler.read_from_stream(epub_bytes, "book.epub")

    assert warnings == []
    assert ("OEBPS/text/ch1.xhtml", False) in called_docs
    assert ("OEBPS/nav.xhtml", True) in called_docs
    assert all("img/a.png" not in doc for doc, _ in called_docs)
    assert any(item.get_src().endswith("toc.ncx") for item in items)


def test_build_elem_path_records_sibling_index(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>1</p><p>2</p><p>3</p></body></html>")
    p2 = root.xpath(".//*[local-name()='p']")[1]

    path = handler.build_elem_path(root, p2)

    assert path.endswith("/p[2]")


def test_find_by_path_returns_none_on_empty_path(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>t</p></body></html>")

    assert handler.find_by_path(root, "") is None
    assert handler.find_by_path(root, "/") is None


def test_parse_opf_skips_empty_manifest_href_and_empty_idref(config: Config) -> None:
    handler = EPUBAst(config)
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='emptyhref' href='' media-type='application/xhtml+xml'/>
    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='cover-image nav'/>
  </manifest>
  <spine toc='missing-ncx'>
    <itemref idref=''/>
    <itemref idref='chap1'/>
  </spine>
</package>
"""
    content = build_zip_with_files({"OEBPS/content.opf": opf})

    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        pkg = handler.parse_opf(zf, "OEBPS/content.opf")

    assert pkg.spine_paths == ["OEBPS/text/ch1.xhtml"]
    assert pkg.nav_path == "OEBPS/nav.xhtml"


def test_parse_opf_handles_missing_spine_and_missing_ncx(config: Config) -> None:
    handler = EPUBAst(config)
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
  </manifest>
</package>
"""
    content = build_zip_with_files({"OEBPS/content.opf": opf})

    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        pkg = handler.parse_opf(zf, "OEBPS/content.opf")

    assert pkg.spine_paths == []
    assert pkg.nav_path is None
    assert pkg.ncx_path is None


def test_parse_xhtml_or_html_uses_recover_xml_when_strict_fails(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    calls: list[int] = []

    def fake_fromstring(data: bytes, parser=None):
        del data
        del parser
        calls.append(1)
        if len(calls) in {1, 2}:
            raise ValueError("strict failed")
        return etree.Element("html")

    monkeypatch.setattr("module.File.EPUB.EPUBAst.etree.fromstring", fake_fromstring)

    root = handler.parse_xhtml_or_html(b"<html><body><p>&foo;</p></body></html>")

    assert isinstance(root, etree._Element)
    assert len(calls) == 3


def test_parse_xhtml_or_html_uses_html_parser_when_xml_fails(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    calls: list[int] = []

    def fake_fromstring(data: bytes, parser=None):
        del data
        del parser
        calls.append(1)
        if len(calls) < 4:
            raise ValueError("xml failed")
        return etree.Element("html")

    monkeypatch.setattr("module.File.EPUB.EPUBAst.etree.fromstring", fake_fromstring)

    root = handler.parse_xhtml_or_html(b"<html><body><p>&foo;</p></body></html>")

    assert isinstance(root, etree._Element)
    assert len(calls) == 4


def test_parse_xhtml_or_html_raises_value_error_when_all_parsers_fail(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)

    def always_fail(data: bytes, parser=None):
        del data
        del parser
        raise ValueError("nope")

    monkeypatch.setattr("module.File.EPUB.EPUBAst.etree.fromstring", always_fail)

    with pytest.raises(ValueError, match="Failed to parse html/xhtml"):
        handler.parse_xhtml_or_html(b"<html><body><p>&foo;</p></body></html>")


def test_parse_ncx_xml_raises_value_error_when_all_parsers_fail(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)

    def always_fail(data: bytes, parser=None):
        del data
        del parser
        raise ValueError("nope")

    monkeypatch.setattr("module.File.EPUB.EPUBAst.etree.fromstring", always_fail)

    with pytest.raises(ValueError, match="Failed to parse ncx"):
        handler.parse_ncx_xml(b"<ncx><text>A</text></ncx>")


def test_iter_translatable_text_slots_skips_script_and_handles_missing_path_map(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(
        b"<html><body><p><span>Mid</span><script>SKIP</script>Tail</p></body></html>"
    )
    p = root.xpath(".//*[local-name()='p']")[0]

    # 故意传入不完整的 path_map，让 get_path 走回退逻辑。
    path_map = {id(root): "/html[1]"}
    slots = handler.iter_translatable_text_slots(root, p, path_map=path_map)

    assert [t for _ref, t in slots] == ["Mid", "Tail"]
    assert slots[0][0].path.endswith("/span[1]")
    assert slots[1][0].path.endswith("/script[1]")


def test_has_block_descendant_detects_nested_block_tags(config: Config) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<div><span><p>t</p></span></div>")
    span = root.xpath(".//*[local-name()='span']")[0]
    p = root.xpath(".//*[local-name()='p']")[0]

    assert handler.has_block_descendant(root) is True
    assert handler.has_block_descendant(span) is True
    assert handler.has_block_descendant(p) is False


def test_extract_items_from_document_skips_whitespace_only_blocks(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    raw = b"<html><body><p>   </p><p>A</p></body></html>"

    items = handler.extract_items_from_document(
        doc_path="text/ch1.xhtml",
        raw=raw,
        spine_index=0,
        rel_path="book.epub",
        is_nav=False,
    )

    assert [it.get_src() for it in items] == ["A"]


def test_extract_items_from_document_skips_whitespace_only_non_leaf_slots(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    raw = b"<html><body><div><p>A</p>   <br/> \n </div></body></html>"

    items = handler.extract_items_from_document(
        doc_path="text/ch1.xhtml",
        raw=raw,
        spine_index=0,
        rel_path="book.epub",
        is_nav=False,
    )

    assert [it.get_src() for it in items] == ["A"]


def test_extract_items_from_document_uses_path_map_without_rebuilding_paths(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)

    def fail_build_path(root, elem):
        del root
        del elem
        raise AssertionError("build_elem_path should not be called when path_map hits")

    monkeypatch.setattr(handler, "build_elem_path", fail_build_path)

    items = handler.extract_items_from_document(
        doc_path="text/ch1.xhtml",
        raw=b"<html><body><div><p>A</p>x<br/>y</div></body></html>",
        spine_index=0,
        rel_path="book.epub",
        is_nav=False,
    )

    assert [it.get_src() for it in items] == ["A", "x", "y"]


def test_get_path_from_map_falls_back_to_build_elem_path_on_miss(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>A</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]

    called: list[tuple[etree._Element, etree._Element]] = []

    def fake_build_path(node_root, elem):
        called.append((node_root, elem))
        return "/fallback[1]"

    monkeypatch.setattr(handler, "build_elem_path", fake_build_path)

    path = handler.get_path_from_map(root, p, {})

    assert path == "/fallback[1]"
    assert called == [(root, p)]


def test_extract_items_from_document_collects_non_leaf_direct_text(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    raw = b"<html><body><div>lead<p>A</p></div></body></html>"

    items = handler.extract_items_from_document(
        doc_path="text/ch1.xhtml",
        raw=raw,
        spine_index=0,
        rel_path="book.epub",
        is_nav=False,
    )

    assert [it.get_src() for it in items] == ["lead", "A"]


def test_read_from_stream_does_not_process_nav_twice_when_nav_in_spine(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)

    container = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf'/>
  </rootfiles>
</container>
"""
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>
  </manifest>
  <spine>
    <itemref idref='chap1'/>
    <itemref idref='nav'/>
  </spine>
</package>
"""
    epub_bytes = build_zip_with_files(
        {
            "META-INF/container.xml": container,
            "OEBPS/content.opf": opf,
            "OEBPS/text/ch1.xhtml": b"<html><body><p>ok</p></body></html>",
            "OEBPS/nav.xhtml": b"<html><body><nav>toc</nav></body></html>",
        }
    )

    called_docs: list[tuple[str, bool]] = []

    def fake_extract_doc(
        doc_path: str,
        raw: bytes,
        spine_index: int,
        rel_path: str,
        is_nav: bool = False,
    ) -> list[Item]:
        del raw
        del spine_index
        del rel_path
        called_docs.append((doc_path, is_nav))
        return []

    monkeypatch.setattr(handler, "extract_items_from_document", fake_extract_doc)

    handler.read_from_stream(epub_bytes, "book.epub")

    assert called_docs.count(("OEBPS/nav.xhtml", True)) == 1


def test_read_from_stream_skips_nav_when_not_html_extension(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)

    container = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf'/>
  </rootfiles>
</container>
"""
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='nav' href='nav.xml' media-type='application/xml' properties='nav'/>
  </manifest>
  <spine>
    <itemref idref='chap1'/>
  </spine>
</package>
"""
    epub_bytes = build_zip_with_files(
        {
            "META-INF/container.xml": container,
            "OEBPS/content.opf": opf,
            "OEBPS/text/ch1.xhtml": b"<html><body><p>ok</p></body></html>",
            "OEBPS/nav.xml": b"<nav>toc</nav>",
        }
    )

    called_docs: list[str] = []

    def fake_extract_doc(
        doc_path: str,
        raw: bytes,
        spine_index: int,
        rel_path: str,
        is_nav: bool = False,
    ) -> list[Item]:
        del raw
        del spine_index
        del rel_path
        del is_nav
        called_docs.append(doc_path)
        return []

    monkeypatch.setattr(handler, "extract_items_from_document", fake_extract_doc)

    handler.read_from_stream(epub_bytes, "book.epub")

    assert called_docs == ["OEBPS/text/ch1.xhtml"]


def test_extract_items_from_ncx_skips_non_element_xpath_results(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    text_elem = etree.Element("text")
    text_elem.text = "A"

    class DummyRoot:
        def xpath(self, expr: str):
            del expr
            return ["not-element", text_elem]

    monkeypatch.setattr(handler, "parse_ncx_xml", lambda raw: DummyRoot())
    monkeypatch.setattr(
        handler, "build_elem_path", lambda root, elem: "/ncx[1]/text[1]"
    )

    items = handler.extract_items_from_ncx("toc.ncx", b"ignored", "book.epub")

    assert [it.get_src() for it in items] == ["A"]


def test_parse_xhtml_or_html_skips_entity_fix_when_no_ampersand(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    calls: list[int] = []

    def fake_fromstring(data: bytes, parser=None):
        del data
        del parser
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("strict failed")
        return etree.Element("html")

    monkeypatch.setattr("module.File.EPUB.EPUBAst.etree.fromstring", fake_fromstring)

    root = handler.parse_xhtml_or_html(b"<html><body><p>hi</p></body></html>")

    assert isinstance(root, etree._Element)
    assert len(calls) == 2


def test_iter_translatable_text_slots_builds_paths_when_no_path_map(
    config: Config,
) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>Head</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]

    slots = handler.iter_translatable_text_slots(root, p)

    assert len(slots) == 1
    assert slots[0][0].path == handler.build_elem_path(root, p)
    assert slots[0][1] == "Head"


def test_has_block_descendant_skips_non_str_tag_and_self(config: Config) -> None:
    handler = EPUBAst(config)

    class DummyElem:
        def __init__(
            self, tag: object, descendants: list[DummyElem] | None = None
        ) -> None:
            self.tag = tag
            self._descendants = descendants or []

        def iterdescendants(self):
            return iter(self._descendants)

    root = DummyElem("div")
    non_str_tag = DummyElem(123)
    block = DummyElem("p")
    root._descendants = [non_str_tag, root, block]

    assert handler.has_block_descendant(root) is True


def test_build_elem_path_does_not_break_when_sibling_scan_misses_current(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>1</p><p>2</p></body></html>")
    p2 = root.xpath(".//*[local-name()='p']")[1]

    def only_first_child(elem):
        for child in elem:
            if isinstance(child.tag, str):
                yield child
                break

    monkeypatch.setattr(
        "module.File.EPUB.EPUBAst.EPUBAst.iter_children_elements", only_first_child
    )

    path = handler.build_elem_path(root, p2)

    assert path.endswith("/p[1]")


def test_parse_container_opf_path_and_parse_opf(config: Config) -> None:
    ast = EPUBAst(config)
    container = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf'/>
  </rootfiles>
</container>
"""
    opf = b"""<?xml version='1.0'?>
<package version='3.2' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>
    <item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/>
  </manifest>
  <spine toc='ncx'>
    <itemref idref='chap1'/>
  </spine>
</package>
"""
    content = build_zip_with_files(
        {
            "META-INF/container.xml": container,
            "OEBPS/content.opf": opf,
        }
    )

    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        opf_path = ast.parse_container_opf_path(zf)
        pkg = ast.parse_opf(zf, opf_path)

    assert opf_path == "OEBPS/content.opf"
    assert pkg.opf_version_major == 3
    assert pkg.spine_paths == ["OEBPS/text/ch1.xhtml"]
    assert pkg.nav_path == "OEBPS/nav.xhtml"
    assert pkg.ncx_path == "OEBPS/toc.ncx"


def test_extract_items_from_document_uses_leaf_blocks_and_skips_code_subtree(
    config: Config,
) -> None:
    ast = EPUBAst(config)
    raw = b"<html><body><div><p>A<span>B</span>C</p><div><p>D</p></div><code><p>X</p></code></div></body></html>"

    items = ast.extract_items_from_document(
        doc_path="text/ch1.xhtml",
        raw=raw,
        spine_index=0,
        rel_path="book.epub",
        is_nav=False,
    )

    assert len(items) == 2
    assert items[0].get_src() == "A\nB\nC"
    assert items[1].get_src() == "D"
    assert items[0].get_extra_field()["epub"]["is_nav"] is False


def test_extract_items_from_document_keeps_non_leaf_tail_text_order(
    config: Config,
) -> None:
    ast = EPUBAst(config)
    raw = (
        b"<html><body><div><div><p>intro</p></div>body_a<br/>body_b"
        b"<div><p>body_c</p></div>body_d</div></body></html>"
    )

    items = ast.extract_items_from_document(
        doc_path="text/ch1.xhtml",
        raw=raw,
        spine_index=0,
        rel_path="book.epub",
        is_nav=False,
    )

    assert [it.get_src() for it in items] == [
        "intro",
        "body_a",
        "body_b",
        "body_c",
        "body_d",
    ]


def test_parse_ncx_xml_handles_bare_ampersand(config: Config) -> None:
    ast = EPUBAst(config)
    raw = b"<ncx><navMap><navPoint><navLabel><text>a&b</text></navLabel></navPoint></navMap></ncx>"

    root = ast.parse_ncx_xml(raw)
    text = root.xpath("string(.//*[local-name()='text'])")

    assert text == "a&b"


def build_epub_bytes() -> bytes:
    container = b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf'/>
  </rootfiles>
</container>
"""
    opf = b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>
  <manifest>
    <item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>
    <item id='chap2' href='text/missing.xhtml' media-type='application/xhtml+xml'/>
    <item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>
    <item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/>
  </manifest>
  <spine toc='ncx'>
    <itemref idref='chap1'/>
    <itemref idref='chap2'/>
  </spine>
</package>
"""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("OEBPS/content.opf", opf)
        zf.writestr("OEBPS/text/ch1.xhtml", "<html><body><p>ok</p></body></html>")
        zf.writestr("OEBPS/nav.xhtml", "<html><body><nav>toc</nav></body></html>")
        zf.writestr("OEBPS/toc.ncx", "<ncx><text>toc</text></ncx>")
    return buf.getvalue()


def build_epub_bytes_for_title(
    *,
    opf_title: str | None,
    xhtml_title: str = "XHTML 原题",
) -> bytes:
    metadata_part = ""
    if opf_title is not None:
        metadata_part = (
            "<metadata xmlns:dc='http://purl.org/dc/elements/1.1/'>"
            f"<dc:title>{opf_title}</dc:title>"
            "</metadata>"
        )
    opf = (
        "<?xml version='1.0'?>"
        "<package version='3.0' xmlns='http://www.idpf.org/2007/opf'>"
        f"{metadata_part}"
        "<manifest>"
        "<item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>"
        "</manifest>"
        "<spine><itemref idref='chap1'/></spine>"
        "</package>"
    ).encode("utf-8")
    chapter = (
        "<?xml version='1.0'?>"
        "<html xmlns='http://www.w3.org/1999/xhtml'>"
        "<head>"
        f"<title>{xhtml_title}</title>"
        "</head>"
        "<body/>"
        "</html>"
    ).encode("utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "META-INF/container.xml",
            b"""<?xml version='1.0'?>
<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf'/>
  </rootfiles>
</container>
""",
        )
        zf.writestr("OEBPS/content.opf", opf)
        zf.writestr("OEBPS/text/ch1.xhtml", chapter)
    return buf.getvalue()


def test_read_from_stream_skips_missing_spine_and_logs_nav_ncx_warnings(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ast = EPUBAst(config)

    def fake_extract_doc(
        doc_path: str,
        raw: bytes,
        spine_index: int,
        rel_path: str,
        is_nav: bool = False,
    ) -> list[Item]:
        del raw
        del spine_index
        del rel_path
        if is_nav:
            raise ValueError("nav failed")
        return [
            Item.from_dict(
                {
                    "src": doc_path,
                    "dst": doc_path,
                    "row": 1,
                    "file_type": Item.FileType.EPUB,
                    "file_path": "book.epub",
                }
            )
        ]

    def fake_extract_ncx(ncx_path: str, raw: bytes, rel_path: str) -> list[Item]:
        del ncx_path
        del raw
        del rel_path
        raise ValueError("ncx failed")

    warnings: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, e: Exception) -> None:
            del e
            warnings.append(msg)

    monkeypatch.setattr(ast, "extract_items_from_document", fake_extract_doc)
    monkeypatch.setattr(ast, "extract_items_from_ncx", fake_extract_ncx)
    monkeypatch.setattr(
        "module.File.EPUB.EPUBAst.LogManager.get", lambda: DummyLogger()
    )

    items = ast.read_from_stream(build_epub_bytes(), "book.epub")

    assert any(item.get_src().endswith("text/ch1.xhtml") for item in items)
    assert len(warnings) == 2
    assert "Failed to process nav document" in warnings[0]
    assert "Failed to process NCX document" in warnings[1]


def test_read_from_stream_extracts_opf_dc_title_item(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ast = EPUBAst(config)

    monkeypatch.setattr(ast, "extract_items_from_document", lambda *args, **kwargs: [])

    items = ast.read_from_stream(
        build_epub_bytes_for_title(opf_title="原始书名"),
        "book.epub",
    )

    title_items: list[Item] = []
    for item in items:
        extra_field = item.get_extra_field()
        if not isinstance(extra_field, dict):
            continue
        epub = extra_field.get("epub")
        if not isinstance(epub, dict):
            continue
        if epub.get("is_opf_metadata") is not True:
            continue
        if epub.get("metadata_tag") != "dc:title":
            continue
        title_items.append(item)

    assert len(title_items) == 1
    title_item = title_items[0]
    epub_extra = title_item.get_extra_field()["epub"]
    assert title_item.get_src() == "原始书名"
    assert epub_extra["doc_path"] == "OEBPS/content.opf"
    assert epub_extra["parts"] != []
    assert epub_extra["parts"][0]["slot"] == "text"
    assert epub_extra["src_digest"] == ast.sha1_hex_with_null_separator(["原始书名"])


def test_read_from_stream_does_not_fallback_to_xhtml_title_without_opf_title(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ast = EPUBAst(config)

    monkeypatch.setattr(ast, "extract_items_from_document", lambda *args, **kwargs: [])

    items = ast.read_from_stream(
        build_epub_bytes_for_title(opf_title=None, xhtml_title="仅 XHTML 标题"),
        "book.epub",
    )

    assert all(item.get_src() != "仅 XHTML 标题" for item in items)
    assert all(
        not (
            isinstance(item.get_extra_field(), dict)
            and isinstance(item.get_extra_field().get("epub"), dict)
            and item.get_extra_field()["epub"].get("is_opf_metadata") is True
        )
        for item in items
    )


def test_read_from_path_reads_epub_files_and_rel_path(
    config: Config,
    fs,
) -> None:
    del fs
    ast = EPUBAst(config)
    input_root = Path("/workspace/epub")
    file_a = input_root / "a.epub"
    file_b = input_root / "sub" / "b.epub"
    file_b.parent.mkdir(parents=True, exist_ok=True)
    file_a.write_bytes(build_epub_bytes())
    file_b.write_bytes(build_epub_bytes())

    items = ast.read_from_path([str(file_a), str(file_b)], str(input_root))

    observed = sorted(
        (item.get_file_path().replace("\\", "/"), item.get_src()) for item in items
    )
    assert observed == [
        ("a.epub", "ok"),
        ("a.epub", "toc"),
        ("sub/b.epub", "ok"),
        ("sub/b.epub", "toc"),
    ]
