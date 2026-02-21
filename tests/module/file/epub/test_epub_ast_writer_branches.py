from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
import lxml.etree as etree

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst
from module.File.EPUB.EPUBAstWriter import EPUBAstWriter


def build_item_for_text_node(
    config: Config, text: str, dst: str, *, extra: dict | None = None
) -> tuple[Item, etree._Element]:
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>__PLACEHOLDER__</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]
    p.text = text
    p_path = ast.build_elem_path(root, p)
    digest = ast.sha1_hex_with_null_separator([ast.normalize_slot_text(text)])
    epub_extra: dict[str, object] = {
        "parts": [{"slot": "text", "path": p_path}],
        "block_path": p_path,
        "src_digest": digest,
    }
    if extra:
        epub_extra.update(extra)
    item = Item.from_dict(
        {
            "src": text,
            "dst": dst,
            "file_type": Item.FileType.EPUB,
            "extra_field": {"epub": epub_extra},
        }
    )
    return item, root


def build_zip_with_files(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, content in files.items():
            zf.writestr(path, content)
    return buf.getvalue()


def test_is_nav_page_accepts_literal_prefixed_attribute(config: Config) -> None:
    writer = EPUBAstWriter(config)
    root = etree.fromstring(
        b"<html xmlns:epub='http://www.idpf.org/2007/ops'><body><nav epub:type='landmarks'/></body></html>"
    )

    assert writer.is_nav_page(root) is True


def test_is_nav_page_returns_false_for_non_toc_type(config: Config) -> None:
    writer = EPUBAstWriter(config)
    root = etree.fromstring(
        b"<html xmlns:epub='http://www.idpf.org/2007/ops'><body><nav epub:type='other'/></body></html>"
    )

    assert writer.is_nav_page(root) is False


def test_parse_doc_uses_ncx_parser_for_ncx_path(config: Config) -> None:
    writer = EPUBAstWriter(config)
    root = writer.parse_doc(b"<ncx><text>t</text></ncx>", "toc.ncx")
    assert writer.ast.local_name(str(root.tag)) == "ncx"


def test_serialize_doc_emits_xml_declaration_for_namespaced_xhtml(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    root = etree.fromstring(
        b"<html xmlns='http://www.w3.org/1999/xhtml'><body/></html>"
    )
    raw = writer.serialize_doc(root)

    assert raw.startswith(b"<?xml")


def test_apply_items_to_tree_applies_valid_and_skips_invalid(config: Config) -> None:
    writer = EPUBAstWriter(config)
    valid, root = build_item_for_text_node(config, "src", "dst")

    invalid_items = [
        Item.from_dict({"src": "x", "dst": "x", "extra_field": "not dict"}),
        Item.from_dict({"src": "x", "dst": "x", "extra_field": {}}),
        Item.from_dict({"src": "x", "dst": "x", "extra_field": {"epub": "bad"}}),
        Item.from_dict({"src": "x", "dst": "x", "extra_field": {"epub": {}}}),
        Item.from_dict(
            {
                "src": "x",
                "dst": "x",
                "extra_field": {"epub": {"parts": []}},
            }
        ),
        Item.from_dict(
            {
                "src": "x",
                "dst": "x",
                "extra_field": {
                    "epub": {
                        "parts": [{"slot": "text", "path": "/html[1]"}],
                        "src_digest": "",
                    }
                },
            }
        ),
        Item.from_dict(
            {
                "src": "x",
                "dst": "a\nb",
                "extra_field": {
                    "epub": {
                        "parts": [{"slot": "text", "path": "/html[1]"}],
                        "src_digest": "x",
                    }
                },
            }
        ),
        Item.from_dict(
            {
                "src": "x",
                "dst": "x",
                "extra_field": {"epub": {"parts": [1], "src_digest": "x"}},
            }
        ),
        Item.from_dict(
            {
                "src": "x",
                "dst": "x",
                "extra_field": {
                    "epub": {
                        "parts": [{"slot": "bad", "path": "/html[1]"}],
                        "src_digest": "x",
                    }
                },
            }
        ),
        Item.from_dict(
            {
                "src": "x",
                "dst": "x",
                "extra_field": {
                    "epub": {
                        "parts": [{"slot": "text", "path": 1}],
                        "src_digest": "x",
                    }
                },
            }
        ),
        Item.from_dict(
            {
                "src": "x",
                "dst": "x",
                "extra_field": {
                    "epub": {
                        "parts": [{"slot": "text", "path": "/no[1]"}],
                        "src_digest": "x",
                    }
                },
            }
        ),
    ]

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[valid, *invalid_items],
        bilingual=False,
    )

    p = root.xpath(".//*[local-name()='p']")[0]
    assert applied == 1
    assert skipped == len(invalid_items)
    assert p.text == "dst"


def test_apply_items_to_tree_falls_back_to_find_by_path_when_map_missing(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    writer = EPUBAstWriter(config)
    item, root = build_item_for_text_node(config, "src", "dst")

    monkeypatch.setattr(writer.ast, "build_elem_by_path", lambda _root: {})

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=False,
    )

    p = root.xpath(".//*[local-name()='p']")[0]
    assert applied == 1
    assert skipped == 0
    assert p.text == "dst"


def test_apply_items_to_tree_does_not_insert_bilingual_when_src_equals_dst(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    item, root = build_item_for_text_node(config, "same", "same")

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    ps = root.xpath(".//*[local-name()='p']")
    assert applied == 1
    assert skipped == 0
    assert len(ps) == 1


def test_apply_items_to_tree_treats_is_nav_flag_as_nav_and_skips_insertion(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    item, root = build_item_for_text_node(config, "src", "dst", extra={"is_nav": True})

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    ps = root.xpath(".//*[local-name()='p']")
    assert applied == 1
    assert skipped == 0
    assert len(ps) == 1
    assert ps[0].text == "dst"


def test_apply_items_to_tree_skips_bilingual_insertion_for_ncx_doc(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(b"<ncx><text>src</text></ncx>")
    text_node = root.xpath(".//*[local-name()='text']")[0]
    node_path = ast.build_elem_path(root, text_node)
    digest = ast.sha1_hex_with_null_separator(["src"])
    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "text", "path": node_path}],
                    "block_path": node_path,
                    "src_digest": digest,
                }
            },
        }
    )

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="toc.ncx",
        items=[item],
        bilingual=True,
    )

    assert applied == 1
    assert skipped == 0
    assert root.xpath("string(.//*[local-name()='text'])") == "dst"


def test_build_epub_writes_raw_assets_when_opf_or_css_decode_fails(
    config: Config, fs
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    css_raw = b"\xff\xfe\x00"
    opf_raw = b"\xff"
    epub_bytes = build_zip_with_files(
        {
            "text/ch1.xhtml": b"<html><body><p>old</p></body></html>",
            "styles/main.css": css_raw,
            "content.opf": opf_raw,
        }
    )
    out_path = Path("/workspace/out/book.epub")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    writer.build_epub(
        original_epub_bytes=epub_bytes,
        items=[],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        assert zf.read("styles/main.css") == css_raw
        assert zf.read("content.opf") == opf_raw


def test_build_epub_uses_tag_as_doc_path_and_keeps_original_on_parse_failure(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>old</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]
    p_path = ast.build_elem_path(root, p)
    digest = ast.sha1_hex_with_null_separator(["old"])
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "tag": "text/ch1.xhtml",
            "row": 1,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "text", "path": p_path}],
                    "block_path": p_path,
                    "src_digest": digest,
                }
            },
        }
    )

    epub_bytes = build_zip_with_files(
        {"text/ch1.xhtml": b"<html><body><p>old</p></body></html>"}
    )
    out_path = Path("/workspace/out/book.epub")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, e: Exception) -> None:
            del e
            warnings.append(msg)

    monkeypatch.setattr(
        "module.File.EPUB.EPUBAstWriter.LogManager.get", lambda: DummyLogger()
    )

    def raise_parse(raw: bytes, doc_path: str):
        del raw
        del doc_path
        raise ValueError("parse failed")

    monkeypatch.setattr(writer, "parse_doc", raise_parse)

    writer.build_epub(
        original_epub_bytes=epub_bytes,
        items=[item],
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        chapter = zf.read("text/ch1.xhtml")

    assert chapter == b"<html><body><p>old</p></body></html>"
    assert warnings != []


def test_is_nav_page_ignores_non_element_nav_nodes(config: Config) -> None:
    writer = EPUBAstWriter(config)
    nav = etree.Element("nav", attrib={"id": "not-toc"})

    class DummyRoot:
        def xpath(self, expr: str):
            del expr
            return [123, nav]

    assert writer.is_nav_page(DummyRoot()) is False


def test_apply_items_to_tree_writes_tail_slot_without_bilingual_clone(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>head</p>tail-old</body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]
    p_path = ast.build_elem_path(root, p)
    digest = ast.sha1_hex_with_null_separator([ast.normalize_slot_text(p.tail or "")])
    item = Item.from_dict(
        {
            "src": "tail-old",
            "dst": "tail-new",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "tail", "path": p_path}],
                    "block_path": "",
                    "src_digest": digest,
                }
            },
        }
    )

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    assert applied == 1
    assert skipped == 0
    assert p.tail == "tail-new"
    assert len(root.xpath(".//*[local-name()='p']")) == 1


def test_apply_items_to_tree_skips_bilingual_clone_when_block_not_found(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>old</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]
    p_path = ast.build_elem_path(root, p)
    digest = ast.sha1_hex_with_null_separator(["old"])
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "text", "path": p_path}],
                    "block_path": "/missing[1]",
                    "src_digest": digest,
                }
            },
        }
    )

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    assert applied == 1
    assert skipped == 0
    assert p.text == "new"
    assert len(root.xpath(".//*[local-name()='p']")) == 1


def test_apply_items_to_tree_skips_bilingual_clone_when_block_has_no_parent(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>old</p></body></html>")
    p = root.xpath(".//*[local-name()='p']")[0]
    p_path = ast.build_elem_path(root, p)
    root_path = ast.build_elem_path(root, root)
    digest = ast.sha1_hex_with_null_separator(["old"])
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "text", "path": p_path}],
                    "block_path": root_path,
                    "src_digest": digest,
                }
            },
        }
    )

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    assert applied == 1
    assert skipped == 0
    assert p.text == "new"


def test_build_epub_skips_items_with_invalid_extra_shapes(config: Config, fs) -> None:
    del fs
    writer = EPUBAstWriter(config)
    epub_bytes = build_zip_with_files(
        {"text/ch1.xhtml": b"<html><body><p>old</p></body></html>"}
    )
    out_path = Path("/workspace/out/invalid-items.epub")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    items = [
        Item.from_dict({"file_type": Item.FileType.TXT}),
        Item.from_dict({"file_type": Item.FileType.EPUB, "extra_field": "bad"}),
        Item.from_dict(
            {
                "file_type": Item.FileType.EPUB,
                "extra_field": {"epub": "bad"},
            }
        ),
        Item.from_dict(
            {
                "file_type": Item.FileType.EPUB,
                "extra_field": {"epub": {}},
            }
        ),
    ]

    writer.build_epub(
        original_epub_bytes=epub_bytes,
        items=items,
        out_path=str(out_path),
        bilingual=False,
    )

    with zipfile.ZipFile(out_path, "r") as zf:
        assert zf.read("text/ch1.xhtml") == b"<html><body><p>old</p></body></html>"
