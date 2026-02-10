from __future__ import annotations

import io
import zipfile
from pathlib import Path

from lxml import etree

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst
from module.File.EPUB.EPUBAstWriter import EPUBAstWriter


def build_original_epub() -> bytes:
    chapter = b"<?xml version='1.0'?><html><body><p>old</p></body></html>"
    css = b"p{writing-mode:vertical-rl;color:red;}"
    opf = b'<spine page-progression-direction="rtl"></spine>'
    binary = b"\x89PNG\r\n\x1a\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("text/ch1.xhtml", chapter)
        zf.writestr("styles/main.css", css)
        zf.writestr("content.opf", opf)
        zf.writestr("img/a.png", binary)
    return buf.getvalue()


def build_epub_item(config: Config) -> Item:
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>old</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]
    p_path = ast.build_elem_path(root, p)
    digest = ast.sha1_hex_with_null_separator(["old"])
    return Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "row": 1,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "doc_path": "text/ch1.xhtml",
                    "parts": [{"slot": "text", "path": p_path}],
                    "block_path": p_path,
                    "src_digest": digest,
                }
            },
        }
    )


def test_build_epub_applies_translation_and_sanitizes_assets(
    config: Config,
    fs,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book.epub")

    writer.build_epub(
        original_epub_bytes=build_original_epub(),
        items=[build_epub_item(config)],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        chapter = zf.read("text/ch1.xhtml").decode("utf-8")
        css = zf.read("styles/main.css").decode("utf-8")
        opf = zf.read("content.opf").decode("utf-8")
        binary = zf.read("img/a.png")

    assert "new" in chapter
    assert "old" not in chapter
    assert "writing-mode" not in css
    assert "page-progression-direction" not in opf
    assert binary == b"\x89PNG\r\n\x1a\n"
