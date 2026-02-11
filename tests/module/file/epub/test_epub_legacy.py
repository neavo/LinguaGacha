from __future__ import annotations

import io
import zipfile
from pathlib import Path

from bs4 import BeautifulSoup
from bs4.element import Tag
import pytest

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBLegacy import EPUBLegacy


def test_sanitize_opf_and_css(config: Config) -> None:
    legacy = EPUBLegacy(config)

    assert legacy.sanitize_opf('<spine page-progression-direction="rtl">') == "<spine >"
    assert "writing-mode" not in legacy.sanitize_css("p{writing-mode:vertical-rl;}")


def test_fix_svg_attributes_renames_case_sensitive_attrs(config: Config) -> None:
    legacy = EPUBLegacy(config)
    bs = BeautifulSoup(
        '<svg viewbox="0 0 1 1"><path pathlength="10"></path></svg>',
        "html.parser",
    )

    legacy.fix_svg_attributes(bs)

    svg = bs.find("svg")
    path = bs.find("path")
    assert isinstance(svg, Tag)
    assert isinstance(path, Tag)
    assert svg.get("viewBox") == "0 0 1 1"
    assert path.get("pathLength") == "10"


def test_process_ncx_replaces_text_nodes(config: Config) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("toc.ncx", "<ncx><text>old</text></ncx>")

    item = Item.from_dict({"src": "old", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_ncx(reader, writer, "toc.ncx", {"toc.ncx": [item]})

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        xml = result_zip.read("toc.ncx").decode("utf-8")
    assert "new" in xml


def test_process_ncx_falls_back_when_lxml_parser_fails(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("toc.ncx", "<ncx><text>old</text></ncx>")

    from bs4 import BeautifulSoup as RealBeautifulSoup

    def fake_bs(markup: str, features: str):
        if features == "lxml-xml":
            raise RuntimeError("boom")
        return RealBeautifulSoup(markup, features)

    monkeypatch.setattr("module.File.EPUB.EPUBLegacy.BeautifulSoup", fake_bs)

    item = Item.from_dict({"src": "old", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_ncx(reader, writer, "toc.ncx", {"toc.ncx": [item]})

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        xml = result_zip.read("toc.ncx").decode("utf-8")
    assert "new" in xml


def test_process_ncx_skips_empty_text_nodes(config: Config) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("toc.ncx", "<ncx><text> </text><text>old</text></ncx>")

    item = Item.from_dict({"src": "old", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_ncx(reader, writer, "toc.ncx", {"toc.ncx": [item]})

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        xml = result_zip.read("toc.ncx").decode("utf-8")
    assert "new" in xml


def test_process_ncx_noop_when_no_target_items(config: Config) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("toc.ncx", "<ncx><text>old</text></ncx>")

    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_ncx(reader, writer, "toc.ncx", {"toc.ncx": []})

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        xml = result_zip.read("toc.ncx").decode("utf-8")
    assert "old" in xml


def test_process_html_writes_bilingual_on_non_nav_page(config: Config) -> None:
    config.deduplication_in_bilingual = False
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("text/ch1.xhtml", "<html><body><p>old</p></body></html>")

    item = Item.from_dict({"src": "old", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_html(
                reader,
                writer,
                "text/ch1.xhtml",
                {"text/ch1.xhtml": [item]},
                bilingual=True,
            )

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        html = result_zip.read("text/ch1.xhtml").decode("utf-8")
    assert "new" in html
    assert "opacity:0.50;" in html


def test_process_html_cleans_class_and_style_and_skips_nested_tags(
    config: Config,
) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr(
            "text/ch1.xhtml",
            (
                "<html><body>"
                "<div class='vrtl keep' style='writing-mode:vertical-rl;color:red;'><p>old</p></div>"
                "<p>t1</p><p>t2</p>"
                "</body></html>"
            ),
        )

    item = Item.from_dict({"src": "t1", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_html(
                reader,
                writer,
                "text/ch1.xhtml",
                {"text/ch1.xhtml": [item]},
                bilingual=False,
            )

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        html = result_zip.read("text/ch1.xhtml").decode("utf-8")
    assert "keep" in html
    assert "writing-mode" not in html
    assert "color:red" in html


def test_process_html_sets_dom_string_when_source_not_in_dom(config: Config) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("text/ch1.xhtml", "<html><body><p>something</p></body></html>")

    item = Item.from_dict({"src": "old", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_html(
                reader,
                writer,
                "text/ch1.xhtml",
                {"text/ch1.xhtml": [item]},
                bilingual=False,
            )

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        html = result_zip.read("text/ch1.xhtml").decode("utf-8")
    assert "new" in html


def test_process_html_bilingual_skips_nav_page_insertion(config: Config) -> None:
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr(
            "text/nav.xhtml",
            "<html><body><nav epub:type='toc'></nav><p>old</p></body></html>",
        )

    item = Item.from_dict({"src": "old", "dst": "new", "file_type": Item.FileType.EPUB})
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_html(
                reader,
                writer,
                "text/nav.xhtml",
                {"text/nav.xhtml": [item]},
                bilingual=True,
            )

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        html = result_zip.read("text/nav.xhtml").decode("utf-8")
    assert "new" in html
    assert "opacity:0.50;" not in html


def test_process_html_bilingual_deduplicates_when_src_equals_dst(
    config: Config,
) -> None:
    config.deduplication_in_bilingual = True
    legacy = EPUBLegacy(config)
    src_buf = io.BytesIO()
    out_buf = io.BytesIO()
    with zipfile.ZipFile(src_buf, "w") as src_zip:
        src_zip.writestr("text/ch1.xhtml", "<html><body><p>same</p></body></html>")

    item = Item.from_dict(
        {"src": "same", "dst": "same", "file_type": Item.FileType.EPUB}
    )
    with zipfile.ZipFile(io.BytesIO(src_buf.getvalue()), "r") as reader:
        with zipfile.ZipFile(out_buf, "w") as writer:
            legacy.process_html(
                reader,
                writer,
                "text/ch1.xhtml",
                {"text/ch1.xhtml": [item]},
                bilingual=True,
            )

    with zipfile.ZipFile(io.BytesIO(out_buf.getvalue()), "r") as result_zip:
        html = result_zip.read("text/ch1.xhtml").decode("utf-8")
    assert "same" in html
    assert "opacity:0.50;" not in html


def test_build_epub_returns_early_when_no_epub_items(
    config: Config,
    fs,
) -> None:
    del fs
    legacy = EPUBLegacy(config)
    out_path = Path("/workspace/out/a.epub")
    legacy.build_epub(
        original_epub_bytes=b"not used",
        items=[Item.from_dict({"file_type": Item.FileType.TXT})],
        out_path=str(out_path),
        bilingual=False,
    )

    assert out_path.exists() is False


def test_build_epub_dispatches_css_opf_ncx_html_and_binary(
    config: Config,
    fs,
) -> None:
    del fs
    legacy = EPUBLegacy(config)
    src = io.BytesIO()
    with zipfile.ZipFile(src, "w") as zf:
        zf.writestr("styles/main.css", "p{writing-mode:vertical-rl;color:red;}")
        zf.writestr("content.opf", '<spine page-progression-direction="rtl"></spine>')
        zf.writestr("toc.ncx", "<ncx><text>oldtoc</text></ncx>")
        zf.writestr("text/ch1.xhtml", "<html><body><p>old</p></body></html>")
        zf.writestr("bin/data.bin", b"RAW")

    items = [
        Item.from_dict(
            {
                "src": "oldtoc",
                "dst": "newtoc",
                "row": 1,
                "file_type": Item.FileType.EPUB,
                "tag": "toc.ncx",
            }
        ),
        Item.from_dict(
            {
                "src": "old",
                "dst": "new",
                "row": 2,
                "file_type": Item.FileType.EPUB,
                "tag": "text/ch1.xhtml",
            }
        ),
    ]

    out_path = Path("/workspace/out/legacy.epub")
    legacy.build_epub(
        original_epub_bytes=src.getvalue(),
        items=items,
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        css = zf.read("styles/main.css").decode("utf-8")
        opf = zf.read("content.opf").decode("utf-8")
        ncx = zf.read("toc.ncx").decode("utf-8")
        html = zf.read("text/ch1.xhtml").decode("utf-8")
        binary = zf.read("bin/data.bin")

    assert "writing-mode" not in css
    assert "page-progression-direction" not in opf
    assert "newtoc" in ncx
    assert "new" in html
    assert binary == b"RAW"


def test_build_epub_writes_raw_css_and_opf_when_decode_fails(
    config: Config,
    fs,
) -> None:
    del fs
    legacy = EPUBLegacy(config)
    src = io.BytesIO()
    bad_css = b"\xff\xfe\x00"
    bad_opf = b"\xff\xfe\x00"
    with zipfile.ZipFile(src, "w") as zf:
        zf.writestr("styles/main.css", bad_css)
        zf.writestr("content.opf", bad_opf)
        zf.writestr("text/ch1.xhtml", "<html><body><p>old</p></body></html>")

    items = [
        Item.from_dict(
            {
                "src": "old",
                "dst": "new",
                "row": 1,
                "file_type": Item.FileType.EPUB,
                "tag": "text/ch1.xhtml",
            }
        )
    ]

    out_path = Path("/workspace/out/bad.epub")
    legacy.build_epub(
        original_epub_bytes=src.getvalue(),
        items=items,
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        assert zf.read("styles/main.css") == bad_css
        assert zf.read("content.opf") == bad_opf
