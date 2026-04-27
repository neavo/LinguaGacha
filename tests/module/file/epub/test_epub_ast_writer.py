from __future__ import annotations

import pytest

from lxml import etree

from module.Data.Core.Item import Item

from module.Config import Config

from module.File.EPUB.EPUBAst import EPUBAst

from module.File.EPUB.EPUBAstWriter import EPUBAstWriter

import io

import zipfile

from pathlib import Path


def build_item_for_block(
    config: Config, src: str, dst: str
) -> tuple[Item, etree._Element]:
    ast = EPUBAst(config)
    root = etree.fromstring(b"<html><body><p>__PLACEHOLDER__</p></body></html>")
    block = root.xpath(".//*[local-name()='p']")[0]
    block.text = src
    block_path = ast.build_elem_path(root, block)
    digest = ast.sha1_hex_with_null_separator([ast.normalize_slot_text(src)])
    item = Item.from_dict(
        {
            "src": src,
            "dst": dst,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "text", "path": block_path}],
                    "block_path": block_path,
                    "src_digest": digest,
                }
            },
        }
    )
    return item, root


def test_is_nav_page_detects_toc_nav(config: Config) -> None:
    root = etree.fromstring(
        b'<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"/></body></html>'
    )

    assert EPUBAstWriter(config).is_nav_page(root) is True


def test_sanitize_opf_and_css(config: Config) -> None:
    writer = EPUBAstWriter(config)

    assert writer.sanitize_opf('<spine page-progression-direction="rtl">') == "<spine >"
    assert "writing-mode" not in writer.sanitize_css("p{writing-mode:vertical-rl;}")


def test_parse_doc_raises_value_error_on_invalid_opf(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    writer = EPUBAstWriter(config)

    def always_fail(data: bytes, parser=None):
        del data
        del parser
        raise ValueError("bad opf")

    monkeypatch.setattr(
        "module.File.EPUB.EPUBAstWriter.etree.fromstring",
        always_fail,
    )

    with pytest.raises(ValueError, match="Failed to parse OPF XML"):
        writer.parse_doc(b"<package>", "content.opf")


def test_extract_opf_title_sync_pair_skips_invalid_metadata_shapes(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    by_doc = {
        "content.opf": [
            Item.from_dict({"src": "a", "dst": "b", "extra_field": {"epub": "bad"}}),
            Item.from_dict(
                {
                    "src": "a",
                    "dst": "b",
                    "extra_field": {
                        "epub": {
                            "is_opf_metadata": False,
                            "metadata_tag": "dc:title",
                        }
                    },
                }
            ),
            Item.from_dict(
                {
                    "src": "a",
                    "dst": "b",
                    "extra_field": {
                        "epub": {
                            "is_opf_metadata": True,
                            "metadata_tag": "dc:creator",
                        }
                    },
                }
            ),
            Item.from_dict(
                {
                    "src": "old",
                    "dst": "new",
                    "extra_field": {
                        "epub": {
                            "is_opf_metadata": True,
                            "metadata_tag": "dc:title",
                        }
                    },
                }
            ),
        ]
    }

    assert writer.extract_opf_title_sync_pair(by_doc) == ("old", "new")


def test_extract_opf_title_sync_pair_rejects_multiline_titles(config: Config) -> None:
    writer = EPUBAstWriter(config)
    by_doc = {
        "content.opf": [
            Item.from_dict(
                {
                    "src": "old\nline",
                    "dst": "new\nline",
                    "extra_field": {
                        "epub": {
                            "is_opf_metadata": True,
                            "metadata_tag": "dc:title",
                        }
                    },
                }
            )
        ]
    }

    assert writer.extract_opf_title_sync_pair(by_doc) is None


def test_sync_xhtml_title_skips_when_source_mismatch(config: Config) -> None:
    writer = EPUBAstWriter(config)
    root = etree.fromstring(b"<html><head><title>Other</title></head><body /></html>")

    changed = writer.sync_xhtml_title(root, "Old", "New")

    assert changed is False
    assert root.xpath("string(.//*[local-name()='title'])") == "Other"


def test_sync_xhtml_title_skips_when_already_translated(config: Config) -> None:
    writer = EPUBAstWriter(config)
    root = etree.fromstring(b"<html><head><title>Same</title></head><body /></html>")

    changed = writer.sync_xhtml_title(root, "Same", "Same")

    assert changed is False
    assert root.xpath("string(.//*[local-name()='title'])") == "Same"


def test_apply_items_to_tree_replaces_text_and_inserts_bilingual_block(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    item, root = build_item_for_block(config, "原文", "译文")

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    ps = root.xpath(".//*[local-name()='p']")
    assert applied == 1
    assert skipped == 0
    assert len(ps) == 2
    assert ps[1].text == "译文"
    assert ps[0].text == "原文"
    assert "opacity:0.50;" in str(ps[0].get("style"))


def test_apply_items_to_tree_skips_on_digest_mismatch(config: Config) -> None:
    writer = EPUBAstWriter(config)
    item, root = build_item_for_block(config, "原文", "译文")
    item.set_extra_field(
        {
            "epub": {
                "parts": item.get_extra_field()["epub"]["parts"],
                "block_path": item.get_extra_field()["epub"]["block_path"],
                "src_digest": "invalid",
            }
        }
    )

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=False,
    )

    p = root.xpath(".//*[local-name()='p']")[0]
    assert applied == 0
    assert skipped == 1
    assert p.text == "原文"


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


def build_ruby_item_for_block(config: Config, dst: str) -> tuple[Item, etree._Element]:
    ast = EPUBAst(config)
    root = etree.fromstring(
        (
            "<html><body><p><ruby>宝條<rt>ほうじょう</rt>"
            "直希<rt>なおき</rt></ruby></p></body></html>"
        ).encode("utf-8")
    )
    block = root.xpath(".//*[local-name()='p']")[0]
    block_path = ast.build_elem_path(root, block)
    slots = ast.iter_translatable_text_slots(root, block)
    part_texts = [ast.normalize_slot_text(text) for _ref, text in slots]
    part_defs = [{"slot": ref.slot, "path": ref.path} for ref, _text in slots]
    candidate = ast.build_ruby_clean_candidate(block, block_path)
    assert candidate is not None

    item = Item.from_dict(
        {
            "src": "\n".join(part_texts),
            "dst": dst,
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": part_defs,
                    "block_path": block_path,
                    "src_digest": ast.sha1_hex_with_null_separator(part_texts),
                    "ruby_clean_candidate": candidate,
                }
            },
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


def test_apply_items_to_tree_writes_ruby_candidate_block_and_keeps_bilingual_source(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    item, root = build_ruby_item_for_block(config, "宝条直希")

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item],
        bilingual=True,
    )

    ps = root.xpath(".//*[local-name()='body']/*[local-name()='p']")
    assert applied == 1
    assert skipped == 0
    assert len(ps) == 2

    source_block, translated_block = ps
    assert source_block.xpath(".//*[local-name()='rt']")
    assert translated_block.text == "宝条直希"
    assert translated_block.xpath(".//*[local-name()='rt']") == []


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


def test_apply_items_to_tree_bilingual_deduplicates_same_block_path(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(
        b"<html><body><div><p>head</p>tail-a<span/>tail-b</div></body></html>"
    )

    div = root.xpath(".//*[local-name()='div']")[0]
    p = root.xpath(".//*[local-name()='p']")[0]
    span = root.xpath(".//*[local-name()='span']")[0]
    div_path = ast.build_elem_path(root, div)
    p_path = ast.build_elem_path(root, p)
    span_path = ast.build_elem_path(root, span)

    item_a = Item.from_dict(
        {
            "src": "tail-a",
            "dst": "A",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "tail", "path": p_path}],
                    "block_path": div_path,
                    "src_digest": ast.sha1_hex_with_null_separator(["tail-a"]),
                }
            },
        }
    )
    item_b = Item.from_dict(
        {
            "src": "tail-b",
            "dst": "B",
            "file_type": Item.FileType.EPUB,
            "extra_field": {
                "epub": {
                    "parts": [{"slot": "tail", "path": span_path}],
                    "block_path": div_path,
                    "src_digest": ast.sha1_hex_with_null_separator(["tail-b"]),
                }
            },
        }
    )

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="text/ch1.xhtml",
        items=[item_a, item_b],
        bilingual=True,
    )

    divs = root.xpath(".//*[local-name()='body']/*[local-name()='div']")
    clones = [d for d in divs if "opacity:0.50" in (d.get("style") or "")]
    originals = [d for d in divs if "opacity:0.50" not in (d.get("style") or "")]

    assert applied == 2
    assert skipped == 0
    assert len(clones) == 1
    assert len(originals) == 1

    clone_p = clones[0].xpath("./*[local-name()='p']")[0]
    clone_span = clones[0].xpath("./*[local-name()='span']")[0]
    original_p = originals[0].xpath("./*[local-name()='p']")[0]
    original_span = originals[0].xpath("./*[local-name()='span']")[0]

    assert clone_p.tail == "tail-a"
    assert clone_span.tail == "tail-b"
    assert original_p.tail == "A"
    assert original_span.tail == "B"


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


def test_apply_items_to_tree_does_not_clone_opf_metadata_in_bilingual_mode(
    config: Config,
) -> None:
    writer = EPUBAstWriter(config)
    ast = EPUBAst(config)
    root = etree.fromstring(
        b"""<?xml version='1.0'?>
<package xmlns='http://www.idpf.org/2007/opf'
    xmlns:dc='http://purl.org/dc/elements/1.1/'>
  <metadata><dc:title>old</dc:title></metadata>
</package>
"""
    )
    title_elem = root.xpath(".//*[local-name()='metadata']/*[local-name()='title']")[0]
    title_path = ast.build_elem_path(root, title_elem)
    digest = ast.sha1_hex_with_null_separator(["old"])
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
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

    applied, skipped = writer.apply_items_to_tree(
        root=root,
        doc_path="content.opf",
        items=[item],
        bilingual=True,
    )

    titles = root.xpath(".//*[local-name()='metadata']/*[local-name()='title']")
    assert applied == 1
    assert skipped == 0
    assert len(titles) == 1
    assert titles[0].text == "new"


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
