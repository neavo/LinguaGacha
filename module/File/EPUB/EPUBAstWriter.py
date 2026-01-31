import copy
import io
import os
import re
import zipfile

from lxml import etree

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUBAst import EPUBAst


class EPUBAstWriter(Base):
    def __init__(self, config: Config) -> None:
        super().__init__()
        self.config = config
        self.ast = EPUBAst(config)

    @staticmethod
    def is_nav_page(root: etree._Element) -> bool:
        # nav 页面常含 toc/landmarks，双语输出会造成链接重复指向，因此跳过插入原文段。
        for nav in root.xpath(".//*[local-name()='nav']"):
            if not isinstance(nav, etree._Element):
                continue
            for k, v in nav.attrib.items():
                key = str(k)
                if key == "epub:type" or key.endswith(":type") or key.endswith("}type"):
                    if v in {"toc", "landmarks"}:
                        return True
        return False

    @staticmethod
    def sanitize_opf(text: str) -> str:
        # 保持旧实现：移除 RTL 翻页声明，避免某些阅读器显示异常
        return text.replace('page-progression-direction="rtl"', "")

    @staticmethod
    def sanitize_css(text: str) -> str:
        # 保持旧实现：移除竖排样式声明
        return re.sub(
            r"[^;\s]*writing-mode\s*:\s*vertical-rl;*",
            "",
            text,
        )

    def parse_doc(self, raw: bytes) -> etree._Element:
        return self.ast.parse_xhtml_or_html(raw)

    def serialize_doc(self, root: etree._Element) -> bytes:
        # XML 树保持 utf-8 + xml declaration；HTML 树用 HTML 序列化减少格式扰动。
        tag = str(root.tag)
        is_plain_html = tag.lower() == "html" and not tag.startswith("{")
        if is_plain_html:
            return etree.tostring(root, encoding="utf-8", method="html")
        return etree.tostring(root, encoding="utf-8", xml_declaration=True)

    def apply_items_to_tree(
        self,
        root: etree._Element,
        doc_path: str,
        items: list[Item],
        bilingual: bool,
    ) -> tuple[int, int]:
        applied = 0
        skipped = 0

        doc_lower = doc_path.lower()
        is_ncx = (
            doc_lower.endswith(".ncx") or self.ast.local_name(str(root.tag)) == "ncx"
        )

        is_nav_flag = False
        for item in items:
            extra = item.get_extra_field()
            epub = extra.get("epub") if isinstance(extra, dict) else None
            if isinstance(epub, dict) and epub.get("is_nav") is True:
                is_nav_flag = True
                break

        is_nav = self.is_nav_page(root) or is_nav_flag
        allow_bilingual_insert = bilingual and (not is_nav) and (not is_ncx)

        # 先应用翻译（不改变结构），并记录 block 元素引用供后续双语插入。
        # items 在抽取阶段按文档顺序生成，row 越大越靠后。双语插入会改变 sibling index，
        # 因此必须在所有 path 查找完成后再做插入。
        block_refs: list[tuple[Item, etree._Element, etree._Element]] = []

        for item in items:
            extra = item.get_extra_field()
            if not isinstance(extra, dict):
                skipped += 1
                continue
            epub = extra.get("epub")
            if not isinstance(epub, dict):
                skipped += 1
                continue

            parts = epub.get("parts")
            if not isinstance(parts, list) or not parts:
                skipped += 1
                continue

            src_digest = epub.get("src_digest")
            if not isinstance(src_digest, str) or src_digest == "":
                skipped += 1
                continue

            # 译文行数必须与槽位一致
            dst_lines = item.get_dst().split("\n")
            if len(dst_lines) != len(parts):
                skipped += 1
                continue

            # 计算当前树中对应槽位的 digest，避免写错位置
            current_texts: list[str] = []
            resolved: list[tuple[str, etree._Element]] = []
            ok = True
            for p in parts:
                if not isinstance(p, dict):
                    ok = False
                    break
                slot = p.get("slot")
                path = p.get("path")
                if slot not in {"text", "tail"} or not isinstance(path, str):
                    ok = False
                    break
                elem = self.ast.find_by_path(root, path)
                if elem is None:
                    ok = False
                    break
                if slot == "text":
                    current_texts.append(self.ast.normalize_slot_text(elem.text or ""))
                else:
                    current_texts.append(self.ast.normalize_slot_text(elem.tail or ""))
                resolved.append((slot, elem))

            if not ok:
                skipped += 1
                continue

            digest = self.ast.sha1_hex("\u0000".join(current_texts))
            if digest != src_digest:
                skipped += 1
                continue

            # 双语插入需要保留原文块的快照（必须在写回译文前 clone）
            if allow_bilingual_insert and not (
                self.config.deduplication_in_bilingual
                and item.get_src() == item.get_dst()
            ):
                block_path = epub.get("block_path")
                if isinstance(block_path, str) and block_path != "":
                    block_elem = self.ast.find_by_path(root, block_path)
                    if block_elem is not None:
                        block_refs.append((item, block_elem, copy.deepcopy(block_elem)))

            # 翻译写回
            for (slot, elem), text in zip(resolved, dst_lines, strict=True):
                if slot == "text":
                    elem.text = text
                else:
                    elem.tail = text

            applied += 1

        # 双语插入：在每个 block 前插入原文 block（目录页/NCX 除外）
        if allow_bilingual_insert:
            # 为避免插入影响顺序，这里按文档顺序的逆序插入
            for item, block, clone in reversed(block_refs):
                parent = block.getparent()
                if parent is None:
                    continue
                style = clone.get("style", "")
                style = style.rstrip(";")
                style = (style + ";" if style else "") + "opacity:0.50;"
                clone.set("style", style)
                idx = parent.index(block)
                parent.insert(idx, clone)
                # 轻量换行，避免某些阅读器把两个块挤在一起
                clone.tail = (clone.tail or "") + "\n"

        return applied, skipped

    def build_epub(
        self,
        original_epub_bytes: bytes,
        items: list[Item],
        out_path: str,
        bilingual: bool,
    ) -> None:
        # group by internal doc path
        by_doc: dict[str, list[Item]] = {}
        for item in items:
            if item.get_file_type() != Item.FileType.EPUB:
                continue
            extra = item.get_extra_field()
            if not isinstance(extra, dict):
                continue
            epub = extra.get("epub")
            if not isinstance(epub, dict):
                continue
            doc_path = epub.get("doc_path")
            if not isinstance(doc_path, str) or doc_path == "":
                # 兼容：旧逻辑用 tag 作为 doc path
                doc_path = item.get_tag()
            if not isinstance(doc_path, str) or doc_path == "":
                continue
            by_doc.setdefault(doc_path, []).append(item)

        for doc_items in by_doc.values():
            doc_items.sort(key=lambda x: x.get_row())

        os.makedirs(os.path.dirname(out_path), exist_ok=True)

        src_zip = io.BytesIO(original_epub_bytes)
        with zipfile.ZipFile(out_path, "w") as zip_writer:
            with zipfile.ZipFile(src_zip, "r") as zip_reader:
                for name in zip_reader.namelist():
                    lower = name.lower()

                    # OPF/CSS 清理（保持旧行为）
                    if lower.endswith(".opf"):
                        raw = zip_reader.read(name)
                        try:
                            text = raw.decode("utf-8-sig")
                            zip_writer.writestr(name, self.sanitize_opf(text))
                        except Exception:
                            zip_writer.writestr(name, raw)
                        continue
                    if lower.endswith(".css"):
                        raw = zip_reader.read(name)
                        try:
                            text = raw.decode("utf-8-sig")
                            zip_writer.writestr(name, self.sanitize_css(text))
                        except Exception:
                            zip_writer.writestr(name, raw)
                        continue

                    # 内容文档回写
                    if (
                        lower.endswith((".xhtml", ".html", ".htm", ".ncx"))
                        and name in by_doc
                    ):
                        raw = zip_reader.read(name)
                        try:
                            root = self.parse_doc(raw)
                            self.apply_items_to_tree(
                                root, name, by_doc.get(name, []), bilingual
                            )
                            zip_writer.writestr(name, self.serialize_doc(root))
                        except Exception:
                            # 解析/回写失败时原样写回，避免破坏 epub
                            zip_writer.writestr(name, raw)
                        continue

                    # 默认：原样拷贝
                    zip_writer.writestr(name, zip_reader.read(name))
