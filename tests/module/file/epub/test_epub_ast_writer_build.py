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


def build_original_epub_with_title(opf_title: str, xhtml_title: str) -> bytes:
    chapter = (
        "<?xml version='1.0'?>"
        "<html xmlns='http://www.w3.org/1999/xhtml'>"
        "<head>"
        f"<title>{xhtml_title}</title>"
        "</head>"
        "<body><p>old</p></body>"
        "</html>"
    ).encode("utf-8")
    opf = (
        "<?xml version='1.0'?>"
        "<package version='3.0' xmlns='http://www.idpf.org/2007/opf' "
        "xmlns:dc='http://purl.org/dc/elements/1.1/'>"
        "<metadata>"
        f"<dc:title>{opf_title}</dc:title>"
        "</metadata>"
        "<manifest>"
        "<item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>"
        "</manifest>"
        "<spine page-progression-direction='rtl'>"
        "<itemref idref='chap1'/>"
        "</spine>"
        "</package>"
    ).encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("text/ch1.xhtml", chapter)
        zf.writestr("content.opf", opf)
    return buf.getvalue()


def build_original_epub_with_title_entity(opf_title: str, xhtml_title: str) -> bytes:
    chapter = (
        "<?xml version='1.0'?>"
        "<html xmlns='http://www.w3.org/1999/xhtml'>"
        "<head>"
        f"<title>{xhtml_title}</title>"
        "</head>"
        "<body><p>old</p></body>"
        "</html>"
    ).encode("utf-8")
    opf = (
        "<?xml version='1.0'?>"
        f"<!DOCTYPE package [<!ENTITY booktitle '{opf_title}'>]>"
        "<package version='3.0' xmlns='http://www.idpf.org/2007/opf' "
        "xmlns:dc='http://purl.org/dc/elements/1.1/'>"
        "<metadata>"
        "<dc:title>&booktitle;</dc:title>"
        "</metadata>"
        "<manifest>"
        "<item id='chap1' href='text/ch1.xhtml' media-type='application/xhtml+xml'/>"
        "</manifest>"
        "<spine page-progression-direction='rtl'>"
        "<itemref idref='chap1'/>"
        "</spine>"
        "</package>"
    ).encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("text/ch1.xhtml", chapter)
        zf.writestr("content.opf", opf)
    return buf.getvalue()


def build_opf_title_item(
    config: Config,
    src_title: str,
    dst_title: str,
    *,
    src_digest: str | None = None,
) -> Item:
    ast = EPUBAst(config)
    opf_root = etree.fromstring(
        b"""<?xml version='1.0'?>
<package version='3.0' xmlns='http://www.idpf.org/2007/opf'
    xmlns:dc='http://purl.org/dc/elements/1.1/'>
  <metadata><dc:title>placeholder</dc:title></metadata>
</package>
"""
    )
    title_elem = opf_root.xpath(
        ".//*[local-name()='metadata']/*[local-name()='title']"
    )[0]
    title_path = ast.build_elem_path(opf_root, title_elem)
    digest = src_digest or ast.sha1_hex_with_null_separator([src_title])
    return Item.from_dict(
        {
            "src": src_title,
            "dst": dst_title,
            "row": 1,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "mode": "slot_per_line",
                    "doc_path": "content.opf",
                    "parts": [{"slot": "text", "path": title_path}],
                    "block_path": title_path,
                    "src_digest": digest,
                    "is_opf_metadata": True,
                    "metadata_tag": "dc:title",
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


def test_build_epub_writes_opf_title_and_syncs_xhtml_title(
    config: Config,
    fs,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-title.epub")
    source_title = "Old Book Title"
    translated_title = "新书名"

    writer.build_epub(
        original_epub_bytes=build_original_epub_with_title(
            opf_title=source_title,
            xhtml_title=source_title,
        ),
        items=[build_opf_title_item(config, source_title, translated_title)],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        opf_raw = zf.read("content.opf")
        chapter_raw = zf.read("text/ch1.xhtml")

    opf_root = etree.fromstring(opf_raw)
    chapter_root = etree.fromstring(chapter_raw)
    opf_title = opf_root.xpath(
        "string(.//*[local-name()='metadata']/*[local-name()='title'][1])"
    )
    chapter_title = chapter_root.xpath(
        "string(.//*[local-name()='head']/*[local-name()='title'][1])"
    )

    assert opf_title == translated_title
    assert chapter_title == translated_title
    assert "page-progression-direction" not in opf_raw.decode("utf-8")


def test_build_epub_does_not_overwrite_opf_title_when_src_digest_mismatches(
    config: Config,
    fs,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-title-digest-mismatch.epub")
    source_title = "Old Book Title"
    translated_title = "新书名"

    writer.build_epub(
        original_epub_bytes=build_original_epub_with_title(
            opf_title=source_title,
            xhtml_title=source_title,
        ),
        items=[
            build_opf_title_item(
                config,
                source_title,
                translated_title,
                src_digest="digest-mismatch",
            )
        ],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        opf_root = etree.fromstring(zf.read("content.opf"))
        chapter_root = etree.fromstring(zf.read("text/ch1.xhtml"))

    opf_title = opf_root.xpath(
        "string(.//*[local-name()='metadata']/*[local-name()='title'][1])"
    )
    chapter_title = chapter_root.xpath(
        "string(.//*[local-name()='head']/*[local-name()='title'][1])"
    )

    assert opf_title == source_title
    assert chapter_title == source_title


def test_extract_opf_title_sync_pair_requires_actual_translation_change(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    source_title = "Old Book Title"
    translated_title = "新书名"

    no_translation = build_opf_title_item(config, source_title, "")
    same_translation = build_opf_title_item(config, source_title, source_title)
    changed_translation = build_opf_title_item(config, source_title, translated_title)

    assert writer.extract_opf_title_sync_pair({"content.opf": [no_translation]}) is None
    assert (
        writer.extract_opf_title_sync_pair({"content.opf": [same_translation]}) is None
    )
    assert writer.extract_opf_title_sync_pair(
        {"content.opf": [changed_translation]}
    ) == (source_title, translated_title)


def test_build_epub_keeps_original_opf_structure_when_no_item_applied(
    config: Config,
    fs,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-title-entity-digest-mismatch.epub")
    source_title = "Old Book Title"
    translated_title = "新书名"
    original_epub_bytes = build_original_epub_with_title_entity(
        opf_title=source_title,
        xhtml_title=source_title,
    )

    writer.build_epub(
        original_epub_bytes=original_epub_bytes,
        items=[
            build_opf_title_item(
                config,
                source_title,
                translated_title,
                src_digest="digest-mismatch",
            )
        ],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(io.BytesIO(original_epub_bytes), "r") as src_zip:
        original_opf_text = src_zip.read("content.opf").decode("utf-8")
    expected_opf_text = writer.sanitize_opf(original_opf_text)

    with zipfile.ZipFile(out_path, "r") as out_zip:
        output_opf_text = out_zip.read("content.opf").decode("utf-8")

    assert output_opf_text == expected_opf_text
    assert (
        "<!DOCTYPE package [<!ENTITY booktitle 'Old Book Title'>]>" in output_opf_text
    )
    assert "<dc:title>&booktitle;</dc:title>" in output_opf_text


def test_build_epub_skips_xhtml_sync_scan_when_opf_title_dst_is_empty(
    config: Config,
    fs,
    monkeypatch,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-title-empty-dst.epub")
    source_title = "Old Book Title"
    xhtml_parse_count = 0
    parse_doc_fn = writer.parse_doc

    def count_parse_for_xhtml(raw: bytes, doc_path: str):
        nonlocal xhtml_parse_count
        if doc_path.lower().endswith(".xhtml"):
            xhtml_parse_count += 1
        return parse_doc_fn(raw, doc_path)

    monkeypatch.setattr(writer, "parse_doc", count_parse_for_xhtml)
    writer.build_epub(
        original_epub_bytes=build_original_epub_with_title(
            opf_title=source_title,
            xhtml_title=source_title,
        ),
        items=[build_opf_title_item(config, source_title, "")],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as out_zip:
        chapter_root = etree.fromstring(out_zip.read("text/ch1.xhtml"))

    chapter_title = chapter_root.xpath(
        "string(.//*[local-name()='head']/*[local-name()='title'][1])"
    )

    assert xhtml_parse_count == 0
    assert chapter_title == source_title


def test_build_epub_keeps_raw_opf_when_no_real_translation_and_decode_fails(
    config: Config,
    fs,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-opf-raw-fallback.epub")
    original_opf = b"\xff"
    original_epub_bytes = io.BytesIO()
    with zipfile.ZipFile(original_epub_bytes, "w") as zf:
        zf.writestr("content.opf", original_opf)
        zf.writestr("text/ch1.xhtml", b"<html><body><p>old</p></body></html>")

    item = Item.from_dict(
        {
            "src": "same",
            "dst": "same",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "doc_path": "content.opf",
                    "parts": [{"slot": "text", "path": "/package[1]/metadata[1]"}],
                    "src_digest": "digest",
                }
            },
        }
    )

    writer.build_epub(
        original_epub_bytes=original_epub_bytes.getvalue(),
        items=[item],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as out_zip:
        assert out_zip.read("content.opf") == original_opf


def test_build_epub_keeps_raw_xhtml_when_title_sync_has_no_actual_change(
    config: Config,
    fs,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-xhtml-no-sync-change.epub")
    source_title = "Old Book Title"
    xhtml_title = "Different Chapter Title"
    original_epub_bytes = build_original_epub_with_title(
        opf_title=source_title,
        xhtml_title=xhtml_title,
    )

    with zipfile.ZipFile(io.BytesIO(original_epub_bytes), "r") as src_zip:
        original_chapter_raw = src_zip.read("text/ch1.xhtml")

    writer.build_epub(
        original_epub_bytes=original_epub_bytes,
        items=[build_opf_title_item(config, source_title, "新书名")],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as out_zip:
        chapter_raw = out_zip.read("text/ch1.xhtml")

    assert chapter_raw == original_chapter_raw


def test_build_epub_opf_parse_failure_falls_back_to_sanitize_text(
    config: Config,
    fs,
    monkeypatch,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-opf-parse-fallback.epub")
    source_title = "Old Book Title"
    original_epub_bytes = build_original_epub_with_title(
        opf_title=source_title,
        xhtml_title=source_title,
    )
    parse_doc_fn = writer.parse_doc
    warnings: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, e: Exception) -> None:
            del e
            warnings.append(msg)

    def fail_on_opf(raw: bytes, doc_path: str):
        if doc_path.lower().endswith(".opf"):
            raise ValueError("opf parse failed")
        return parse_doc_fn(raw, doc_path)

    monkeypatch.setattr(writer, "parse_doc", fail_on_opf)
    monkeypatch.setattr(
        "module.File.EPUB.EPUBAstWriter.LogManager.get",
        lambda: DummyLogger(),
    )
    writer.build_epub(
        original_epub_bytes=original_epub_bytes,
        items=[build_opf_title_item(config, source_title, "新书名")],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(io.BytesIO(original_epub_bytes), "r") as src_zip:
        expected_opf_text = writer.sanitize_opf(
            src_zip.read("content.opf").decode("utf-8")
        )

    with zipfile.ZipFile(out_path, "r") as out_zip:
        opf_text = out_zip.read("content.opf").decode("utf-8")

    assert warnings != []
    assert opf_text == expected_opf_text
    assert source_title in opf_text


def test_build_epub_precheck_skips_non_opf_empty_and_missing_opf_entries(
    config: Config,
    fs,
    monkeypatch,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-precheck-skip-branches.epub")
    source_title = "Old Book Title"
    original_epub_bytes = build_original_epub_with_title(
        opf_title=source_title,
        xhtml_title=source_title,
    )

    xhtml_item = build_epub_item(config)
    xhtml_item.set_extra_field(
        {
            "epub": {
                "doc_path": "text/ch1.xhtml",
                "parts": [{"slot": "text", "path": "/html[1]/body[1]/p[1]"}],
                "block_path": "/html[1]/body[1]/p[1]",
                "src_digest": "digest-mismatch",
            }
        }
    )
    empty_opf_item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "row": 2,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "doc_path": "empty.opf",
                    "parts": [{"slot": "text", "path": "/package[1]/metadata[1]"}],
                    "src_digest": "x",
                }
            },
        }
    )
    missing_opf_item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "row": 3,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "doc_path": "missing.opf",
                    "parts": [{"slot": "text", "path": "/package[1]/metadata[1]"}],
                    "src_digest": "x",
                }
            },
        }
    )

    def fake_extract_sync_pair(by_doc: dict[str, list[Item]]) -> tuple[str, str]:
        by_doc["empty.opf"] = []
        return source_title, "新书名"

    monkeypatch.setattr(writer, "extract_opf_title_sync_pair", fake_extract_sync_pair)
    writer.build_epub(
        original_epub_bytes=original_epub_bytes,
        items=[xhtml_item, empty_opf_item, missing_opf_item],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as out_zip:
        assert out_zip.read("content.opf") != b""
        assert out_zip.read("text/ch1.xhtml") != b""


def test_build_epub_opf_exception_decode_failure_keeps_raw(
    config: Config,
    fs,
    monkeypatch,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    out_path = Path("/workspace/out/book-opf-exception-raw.epub")
    original_opf = b"\xff"
    original_epub_bytes = io.BytesIO()
    with zipfile.ZipFile(original_epub_bytes, "w") as zf:
        zf.writestr("content.opf", original_opf)
        zf.writestr("text/ch1.xhtml", b"<html><body><p>old</p></body></html>")

    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "doc_path": "content.opf",
                    "parts": [{"slot": "text", "path": "/package[1]/metadata[1]"}],
                    "src_digest": "digest",
                }
            },
        }
    )
    warnings: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, e: Exception) -> None:
            del e
            warnings.append(msg)

    monkeypatch.setattr(
        "module.File.EPUB.EPUBAstWriter.LogManager.get",
        lambda: DummyLogger(),
    )
    writer.build_epub(
        original_epub_bytes=original_epub_bytes.getvalue(),
        items=[item],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as out_zip:
        assert out_zip.read("content.opf") == original_opf
    assert warnings != []
