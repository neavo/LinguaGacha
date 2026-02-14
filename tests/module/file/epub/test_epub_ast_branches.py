from __future__ import annotations

import io
import zipfile

import pytest
import lxml.etree as etree

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst


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
    assert len(items) == 1
    assert items[0].get_src().endswith("toc.ncx")


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
