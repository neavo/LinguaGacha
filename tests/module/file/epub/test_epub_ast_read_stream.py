from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst


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
    file_a.write_bytes(b"a")
    file_b.write_bytes(b"b")

    called: list[str] = []

    def fake_read_from_stream(content: bytes, rel_path: str) -> list[Item]:
        del content
        called.append(rel_path.replace("\\", "/"))
        return [Item.from_dict({"src": rel_path})]

    ast.read_from_stream = fake_read_from_stream
    items = ast.read_from_path([str(file_a), str(file_b)], str(input_root))

    assert sorted(called) == ["a.epub", "sub/b.epub"]
    assert len(items) == 2
