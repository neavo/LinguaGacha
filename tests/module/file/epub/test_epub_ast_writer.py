from __future__ import annotations

from lxml import etree

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst
from module.File.EPUB.EPUBAstWriter import EPUBAstWriter


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
