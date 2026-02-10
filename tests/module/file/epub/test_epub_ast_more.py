from __future__ import annotations

import io
import zipfile

from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst


def build_zip_with_files(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, content in files.items():
            zf.writestr(path, content)
    return buf.getvalue()


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


def test_parse_ncx_xml_handles_bare_ampersand(config: Config) -> None:
    ast = EPUBAst(config)
    raw = b"<ncx><navMap><navPoint><navLabel><text>a&b</text></navLabel></navPoint></navMap></ncx>"

    root = ast.parse_ncx_xml(raw)
    text = root.xpath("string(.//*[local-name()='text'])")

    assert text == "a&b"
