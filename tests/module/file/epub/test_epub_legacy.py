from __future__ import annotations

import io
import zipfile
from pathlib import Path

from bs4 import BeautifulSoup
from bs4.element import Tag

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
