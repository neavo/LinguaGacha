import dataclasses
import hashlib
import html.entities
import io
import os
import posixpath
import re
import unicodedata
import zipfile
from typing import Iterator
from typing import NamedTuple

from lxml import etree

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config


class EpubPathSeg(NamedTuple):
    name: str
    pos: int


@dataclasses.dataclass(frozen=True)
class EpubPartRef:
    # slot=text 时 path 指向拥有 .text 的 element
    # slot=tail 时 path 指向拥有 .tail 的 child element
    slot: str  # "text" | "tail"
    path: str


@dataclasses.dataclass(frozen=True)
class EpubPackageInfo:
    opf_path: str
    opf_dir: str
    opf_version_major: int
    spine_paths: list[str]
    nav_path: str | None
    ncx_path: str | None


class EPUBAst(Base):
    """基于 OPF spine + lxml AST 的 EPUB 抽取器。

    设计目标：
    - 只抽取"可翻译纯文本"，不把 HTML tag 发给模型
    - 定位信息写入 Item.extra_field，写回时只修改 text/tail
    - 同时兼容 EPUB2/EPUB3（通过 OPF version + nav/ncx）

    Row 编号规则（用于保证不同文档类型间的有序性）：
    - 正文章节：spine_index * ROW_MULTIPLIER + unit_index，支持最多 8000 章
    - Nav 文档：ROW_BASE_NAV + unit_index（当 nav 不在 spine 时）
    - NCX 文档：ROW_BASE_NCX + unit_index（始终排在最后）
    """

    # Row 编号常量：用于保证 item 在不同文档类型间的有序性
    ROW_MULTIPLIER = 1_000_000  # 每个 spine 文档最多 100 万个翻译单元
    ROW_BASE_NAV = 8_000_000_000  # nav.xhtml 的 row 基数（支持最多 8000 章正文）
    ROW_BASE_NCX = 9_000_000_000  # NCX 的 row 基数（始终排在 nav 之后）

    BLOCK_TAGS: tuple[str, ...] = (
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "div",
        "li",
        "td",
        "th",
        "caption",
        "figcaption",
        "dt",
        "dd",
    )

    RE_SLOT_INLINE_WHITESPACE = re.compile(r"[\r\n\t]+")
    RE_MULTI_SPACE = re.compile(r"[ ]{2,}")

    # NCX 里常见的轻度不规范：裸 '&'（例如：<text>a&b</text>）。
    # 用 bytes 级别的最小修复，避免引入编码误判。
    RE_NCX_BARE_AMP = re.compile(
        rb"&(?!(?:[A-Za-z][A-Za-z0-9._:-]*|#[0-9]+|#[xX][0-9A-Fa-f]+);)"
    )
    RE_HTML_NAMED_ENTITY = re.compile(rb"&([A-Za-z][A-Za-z0-9._:-]*);")
    RE_CDATA_SECTION = re.compile(rb"<!\[CDATA\[.*?\]\]>", re.DOTALL)

    SKIP_SUBTREE_TAGS: frozenset[str] = frozenset(
        {
            "script",
            "style",
            "code",
            "pre",
            "kbd",
            "samp",
            "var",
            "noscript",
            "rt",  # ruby 读音默认不翻译
        }
    )

    OCF_NS = "urn:oasis:names:tc:opendocument:xmlns:container"

    def __init__(self, config: Config) -> None:
        super().__init__()
        self.config = config

    @classmethod
    def normalize_slot_text(cls, text: str) -> str:
        """把 text/tail 槽位的源码排版换行归一化为行内空白。

        EPUB 的 XHTML 往往为了源码可读性会在文本节点中包含换行与缩进空白；
        slot-per-line 方案若直接使用 '\n' 分隔，会导致 parts 数与行数不一致。
        """

        if (
            "\r" not in text
            and "\n" not in text
            and "\t" not in text
            and "  " not in text
        ):
            return text

        # 只处理控制换行/制表符，避免破坏全角空格等非 ASCII 空白。
        text = cls.RE_SLOT_INLINE_WHITESPACE.sub(" ", text)
        return cls.RE_MULTI_SPACE.sub(" ", text)

    @staticmethod
    def normalize_epub_path(path: str) -> str:
        # calibre 会做 NFC 归一；这里也统一一下，降低跨平台差异。
        path = path.replace("\\", "/")
        path = unicodedata.normalize("NFC", path)
        return path

    @staticmethod
    def resolve_href(base_dir: str, href: str) -> str:
        href = EPUBAst.normalize_epub_path(href)
        # OPF 内 href 通常是 URL path，posixpath 更合适
        joined = posixpath.normpath(posixpath.join(base_dir, href))
        # normpath 可能返回 '.'
        return joined.lstrip("./")

    @staticmethod
    def local_name(tag: str) -> str:
        if tag.startswith("{"):
            return tag.split("}", 1)[1]
        return tag

    @staticmethod
    def iter_children_elements(elem: etree._Element) -> Iterator[etree._Element]:
        for child in elem:
            if isinstance(child.tag, str):
                yield child

    @classmethod
    def build_elem_path(cls, root: etree._Element, elem: etree._Element) -> str:
        # 用 local-name + 同名兄弟序号生成稳定路径，避免 namespace/prefix 漂移。
        segs: list[EpubPathSeg] = []
        cur: etree._Element | None = elem
        while cur is not None and cur is not root:
            parent = cur.getparent()
            if parent is None:
                break
            name = cls.local_name(cur.tag)
            # 只统计同名 element sibling
            same = [
                c
                for c in cls.iter_children_elements(parent)
                if cls.local_name(c.tag) == name
            ]
            idx = 1
            for i, c in enumerate(same, start=1):
                if c is cur:
                    idx = i
                    break
            segs.append(EpubPathSeg(name=name, pos=idx))
            cur = parent
        # 根节点
        segs.append(EpubPathSeg(name=cls.local_name(root.tag), pos=1))
        segs.reverse()
        return "/" + "/".join(f"{s.name}[{s.pos}]" for s in segs)

    @classmethod
    def iter_elem_path_pairs(
        cls, root: etree._Element
    ) -> Iterator[tuple[etree._Element, str]]:
        if not isinstance(root.tag, str):
            return

        root_path = f"/{cls.local_name(root.tag)}[1]"
        stack: list[tuple[etree._Element, str]] = [(root, root_path)]
        while stack:
            parent, parent_path = stack.pop()
            yield parent, parent_path

            counter: dict[str, int] = {}
            child_entries: list[tuple[etree._Element, str]] = []
            for child in cls.iter_children_elements(parent):
                name = cls.local_name(child.tag)
                idx = counter.get(name, 0) + 1
                counter[name] = idx
                child_entries.append((child, f"{parent_path}/{name}[{idx}]"))

            for child, child_path in reversed(child_entries):
                stack.append((child, child_path))

    @classmethod
    def build_elem_path_map(cls, root: etree._Element) -> dict[int, str]:
        return {id(elem): path for elem, path in cls.iter_elem_path_pairs(root)}

    @classmethod
    def build_elem_by_path(cls, root: etree._Element) -> dict[str, etree._Element]:
        return {path: elem for elem, path in cls.iter_elem_path_pairs(root)}

    @classmethod
    def parse_elem_path(cls, path: str) -> list[EpubPathSeg]:
        parts = [p for p in path.strip().split("/") if p]
        segs: list[EpubPathSeg] = []
        for p in parts:
            m = re.fullmatch(r"([A-Za-z0-9:_\-]+)\[(\d+)\]", p)
            if m is None:
                raise ValueError(f"Invalid element path: {path}")
            segs.append(EpubPathSeg(name=m.group(1), pos=int(m.group(2))))
        return segs

    @classmethod
    def find_by_path(cls, root: etree._Element, path: str) -> etree._Element | None:
        segs = cls.parse_elem_path(path)
        # 第一个 seg 必须匹配 root
        if not segs:
            return None
        if cls.local_name(root.tag) != segs[0].name:
            return None
        cur: etree._Element = root
        for seg in segs[1:]:
            candidates = [
                c
                for c in cls.iter_children_elements(cur)
                if cls.local_name(c.tag) == seg.name
            ]
            if seg.pos <= 0 or seg.pos > len(candidates):
                return None
            cur = candidates[seg.pos - 1]
        return cur

    @staticmethod
    def sha1_hex(text: str) -> str:
        return hashlib.sha1(text.encode("utf-8")).hexdigest()

    @staticmethod
    def sha1_hex_with_null_separator(parts: list[str]) -> str:
        hasher = hashlib.sha1()
        for i, part in enumerate(parts):
            if i:
                hasher.update(b"\x00")
            hasher.update(part.encode("utf-8"))
        return hasher.hexdigest()

    @classmethod
    def parse_container_opf_path(cls, zip_reader: zipfile.ZipFile) -> str:
        container_path = "META-INF/container.xml"
        with zip_reader.open(container_path) as f:
            data = f.read()
        root = etree.fromstring(data)
        ns = {"ocf": cls.OCF_NS}
        nodes = root.xpath(
            "./ocf:rootfiles/ocf:rootfile[@full-path]",
            namespaces=ns,
        )
        if not nodes:
            raise ValueError("META-INF/container.xml contains no OPF rootfile")
        opf_path = nodes[0].get("full-path")
        if not opf_path:
            raise ValueError("Invalid OPF full-path")
        return cls.normalize_epub_path(opf_path)

    @classmethod
    def parse_opf(cls, zip_reader: zipfile.ZipFile, opf_path: str) -> EpubPackageInfo:
        with zip_reader.open(opf_path) as f:
            opf_bytes = f.read()

        opf_root = etree.fromstring(opf_bytes)
        opf_version = opf_root.get("version") or "2.0"
        # 2.0 / 3.0 / 3.2 ...
        try:
            major = int(opf_version.split(".", 1)[0])
        except ValueError:
            major = 2

        opf_dir = posixpath.dirname(opf_path)

        # 解析 manifest
        manifest_items: dict[str, dict[str, str]] = {}
        for item in opf_root.xpath(
            ".//*[local-name()='manifest']/*[local-name()='item'][@id][@href]"
        ):
            item_id = item.get("id")
            href = item.get("href")
            if not item_id or not href:
                continue
            media_type = item.get("media-type") or ""
            props = item.get("properties") or ""
            path = cls.resolve_href(opf_dir, href)
            manifest_items[item_id] = {
                "path": path,
                "media_type": media_type,
                "properties": props,
            }

        # nav（EPUB3）
        nav_path: str | None = None
        for _, v in manifest_items.items():
            props = v.get("properties", "")
            if "nav" in {p.strip() for p in props.split()}:
                nav_path = v.get("path")
                break

        # ncx（EPUB2）
        ncx_path: str | None = None
        toc_id = None
        spine = opf_root.xpath(".//*[local-name()='spine']")
        if spine:
            toc_id = spine[0].get("toc")
        if toc_id and toc_id in manifest_items:
            ncx_path = manifest_items[toc_id].get("path")
        else:
            # 兜底：找 media-type 为 ncx
            for _id, v in manifest_items.items():
                mt = (v.get("media_type") or "").lower()
                if mt.endswith("application/x-dtbncx+xml"):
                    ncx_path = v.get("path")
                    break

        # spine 顺序
        spine_paths: list[str] = []
        for itemref in opf_root.xpath(
            ".//*[local-name()='spine']/*[local-name()='itemref'][@idref]"
        ):
            idref = itemref.get("idref")
            if not idref:
                continue
            m = manifest_items.get(idref)
            if not m:
                continue
            spine_paths.append(m.get("path") or "")
        spine_paths = [p for p in spine_paths if p]

        return EpubPackageInfo(
            opf_path=opf_path,
            opf_dir=opf_dir,
            opf_version_major=major,
            spine_paths=spine_paths,
            nav_path=nav_path,
            ncx_path=ncx_path,
        )

    @classmethod
    def parse_xhtml_or_html(cls, raw: bytes) -> etree._Element:
        # 优先严格按 XML 解析（XHTML）。若失败，先把 HTML 命名实体转成数字引用再重试，
        # 避免 libxml2 的 recover 模式在遇到未定义实体时出现静默损坏。

        try:
            parser = etree.XMLParser(
                recover=False, resolve_entities=True, no_network=True
            )
            return etree.fromstring(raw, parser=parser)
        except Exception:
            pass

        fixed = cls.normalize_html_named_entities_for_xml(raw)
        if fixed is not raw:
            try:
                parser = etree.XMLParser(
                    recover=False, resolve_entities=True, no_network=True
                )
                return etree.fromstring(fixed, parser=parser)
            except Exception:
                pass

        try:
            # 一些 epub 的 xhtml 有小瑕疵但结构仍可恢复，尽量保持 XML 语义。
            parser = etree.XMLParser(
                recover=True, resolve_entities=True, no_network=True
            )
            return etree.fromstring(fixed, parser=parser)
        except Exception:
            pass

        try:
            parser = etree.HTMLParser(recover=True)
            return etree.fromstring(raw, parser=parser)
        except Exception as e:
            raise ValueError("Failed to parse html/xhtml") from e

    @classmethod
    def normalize_html_named_entities_for_xml(cls, raw: bytes) -> bytes:
        """把 HTML 命名实体转换为 XML 可解析的形式。

        - 已知命名实体：替换为等价的数字字符引用（例如：&nbsp; -> &#160;）。
        - 未知命名实体：把 '&' 转义为 '&amp;'，以保留原始文本（例如：&foo; -> &amp;foo;）。
        """

        if b"&" not in raw:
            return raw

        # html.entities.name2codepoint 只覆盖单码点实体；html5 能覆盖多码点实体。
        html5_entities = html.entities.html5

        def repl(m: re.Match[bytes]) -> bytes:
            name_bytes = m.group(1)

            # RE_HTML_NAMED_ENTITY 只匹配 ASCII 字符集，decode 不会失败。
            name = name_bytes.decode("ascii")

            value = html5_entities.get(f"{name};") or html5_entities.get(name)
            if value is None:
                return b"&amp;" + name_bytes + b";"

            # 转成数字引用，确保 XML 一定可解析；多码点实体会展开为多个字符引用。
            return "".join(f"&#{ord(ch)};" for ch in value).encode("ascii")

        # CDATA 内本就不会展开实体，保持原样避免误改。
        parts: list[bytes] = []
        last_end = 0
        for m in cls.RE_CDATA_SECTION.finditer(raw):
            before = raw[last_end : m.start()]
            parts.append(cls.RE_HTML_NAMED_ENTITY.sub(repl, before))
            parts.append(raw[m.start() : m.end()])
            last_end = m.end()

        tail = raw[last_end:]
        parts.append(cls.RE_HTML_NAMED_ENTITY.sub(repl, tail))
        return b"".join(parts)

    @classmethod
    def fix_ncx_bare_ampersands(cls, raw: bytes) -> bytes:
        if b"&" not in raw:
            return raw

        # CDATA 内 '&' 是合法字符，避免误改。
        parts: list[bytes] = []
        last_end = 0
        for m in cls.RE_CDATA_SECTION.finditer(raw):
            before = raw[last_end : m.start()]
            parts.append(cls.RE_NCX_BARE_AMP.sub(b"&amp;", before))
            parts.append(raw[m.start() : m.end()])
            last_end = m.end()

        tail = raw[last_end:]
        parts.append(cls.RE_NCX_BARE_AMP.sub(b"&amp;", tail))
        return b"".join(parts)

    @classmethod
    def parse_ncx_xml(cls, raw: bytes) -> etree._Element:
        # 优先严格 XML；失败后做最小修复再容错解析，降低 warning 噪音。
        try:
            parser = etree.XMLParser(
                recover=False, resolve_entities=True, no_network=True
            )
            return etree.fromstring(raw, parser=parser)
        except Exception:
            pass

        fixed = cls.fix_ncx_bare_ampersands(raw)
        try:
            parser = etree.XMLParser(
                recover=False, resolve_entities=True, no_network=True
            )
            return etree.fromstring(fixed, parser=parser)
        except Exception:
            pass

        try:
            parser = etree.XMLParser(
                recover=True, resolve_entities=True, no_network=True
            )
            return etree.fromstring(fixed, parser=parser)
        except Exception as e:
            raise ValueError("Failed to parse ncx") from e

    def iter_translatable_text_slots(
        self,
        root: etree._Element,
        block: etree._Element,
        path_map: dict[int, str] | None = None,
    ) -> list[tuple[EpubPartRef, str]]:
        results: list[tuple[EpubPartRef, str]] = []

        def get_path(elem: etree._Element) -> str:
            if path_map is not None:
                path = path_map.get(id(elem))
                if path is not None:
                    return path
            return self.build_elem_path(root, elem)

        def walk(elem: etree._Element) -> None:
            name = self.local_name(elem.tag)
            if name in self.SKIP_SUBTREE_TAGS:
                return

            # elem.text
            if elem.text is not None and elem.text != "":
                ref = EpubPartRef(slot="text", path=get_path(elem))
                results.append((ref, elem.text))

            # children
            for child in self.iter_children_elements(elem):
                walk(child)
                if child.tail is not None and child.tail != "":
                    ref = EpubPartRef(slot="tail", path=get_path(child))
                    results.append((ref, child.tail))

        walk(block)
        return results

    def is_block_candidate(self, elem: etree._Element) -> bool:
        name = self.local_name(elem.tag)
        return name in self.BLOCK_TAGS

    def has_block_descendant(self, elem: etree._Element) -> bool:
        for d in elem.iterdescendants():
            if not isinstance(d.tag, str):
                continue
            if d is elem:
                continue
            if self.local_name(d.tag) in self.BLOCK_TAGS:
                return True
        return False

    def is_inside_skipped_subtree(self, elem: etree._Element) -> bool:
        cur: etree._Element | None = elem
        while cur is not None:
            if (
                isinstance(cur.tag, str)
                and self.local_name(cur.tag) in self.SKIP_SUBTREE_TAGS
            ):
                return True
            cur = cur.getparent()
        return False

    def extract_items_from_document(
        self,
        doc_path: str,
        raw: bytes,
        spine_index: int,
        rel_path: str,
        is_nav: bool = False,
    ) -> list[Item]:
        items: list[Item] = []
        root = self.parse_xhtml_or_html(raw)

        elem_list = [e for e in root.iter() if isinstance(e.tag, str)]
        path_map = self.build_elem_path_map(root)

        in_skipped_map: dict[int, bool] = {}
        for elem in elem_list:
            parent = elem.getparent()
            parent_in_skip = False
            if parent is not None and isinstance(parent.tag, str):
                parent_in_skip = in_skipped_map.get(id(parent), False)
            in_skipped_map[id(elem)] = parent_in_skip or (
                self.local_name(elem.tag) in self.SKIP_SUBTREE_TAGS
            )

        has_block_in_subtree_map: dict[int, bool] = {}
        has_block_descendant_map: dict[int, bool] = {}
        for elem in reversed(elem_list):
            has_child_block_in_subtree = False
            for child in self.iter_children_elements(elem):
                if has_block_in_subtree_map[id(child)]:
                    has_child_block_in_subtree = True
                    break
            has_block_descendant_map[id(elem)] = has_child_block_in_subtree
            has_block_in_subtree_map[id(elem)] = (
                self.is_block_candidate(elem) or has_child_block_in_subtree
            )

        # 选择 block：只取“叶子 block”，避免 div/li 嵌套导致重复。
        blocks: list[etree._Element] = []
        for elem in elem_list:
            if not self.is_block_candidate(elem):
                continue
            if in_skipped_map[id(elem)]:
                continue
            if has_block_descendant_map[id(elem)]:
                continue
            blocks.append(elem)

        unit_index = 0
        for block in blocks:
            slots = self.iter_translatable_text_slots(root, block, path_map=path_map)
            # 过滤空白槽位
            slot_texts = [t for _ref, t in slots if t.strip() != ""]
            if not slot_texts:
                continue

            part_defs: list[dict[str, str]] = []
            part_texts: list[str] = []
            for ref, text in slots:
                part_defs.append({"slot": ref.slot, "path": ref.path})
                part_texts.append(self.normalize_slot_text(text))

            src = "\n".join(part_texts)
            digest = self.sha1_hex_with_null_separator(part_texts)

            item = Item.from_dict(
                {
                    "src": src,
                    "dst": src,
                    "tag": doc_path,
                    "row": spine_index * self.ROW_MULTIPLIER + unit_index,
                    "file_type": Item.FileType.EPUB,
                    "file_path": rel_path,
                    "extra_field": {
                        "epub": {
                            "mode": "slot_per_line",
                            "doc_path": doc_path,
                            "block_path": path_map[id(block)],
                            "parts": part_defs,
                            "src_digest": digest,
                            "is_nav": is_nav,
                        }
                    },
                }
            )
            items.append(item)
            unit_index += 1

        return items

    def extract_items_from_ncx(
        self, ncx_path: str, raw: bytes, rel_path: str
    ) -> list[Item]:
        # 兼容旧实现：抽取 NCX 的 <text>。
        items: list[Item] = []
        root = self.parse_ncx_xml(raw)

        unit_index = 0
        for elem in root.xpath(".//*[local-name()='text']"):
            if not isinstance(elem, etree._Element):
                continue
            text = elem.text or ""
            if text.strip() == "":
                continue

            text = self.normalize_slot_text(text)
            elem_path = self.build_elem_path(root, elem)

            item = Item.from_dict(
                {
                    "src": text,
                    "dst": text,
                    "tag": ncx_path,
                    "row": self.ROW_BASE_NCX + unit_index,
                    "file_type": Item.FileType.EPUB,
                    "file_path": rel_path,
                    "extra_field": {
                        "epub": {
                            "mode": "slot_per_line",
                            "doc_path": ncx_path,
                            "block_path": elem_path,
                            "parts": [
                                {
                                    "slot": "text",
                                    "path": elem_path,
                                }
                            ],
                            "src_digest": self.sha1_hex(text),
                            "is_ncx": True,
                        }
                    },
                }
            )
            items.append(item)
            unit_index += 1

        return items

    def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
        items: list[Item] = []
        with zipfile.ZipFile(io.BytesIO(content), "r") as zip_reader:
            opf_path = self.parse_container_opf_path(zip_reader)
            pkg = self.parse_opf(zip_reader, opf_path)

            processed_paths: set[str] = set()

            for spine_index, doc_path in enumerate(pkg.spine_paths):
                lower = doc_path.lower()
                if not lower.endswith((".xhtml", ".html", ".htm")):
                    continue
                try:
                    with zip_reader.open(doc_path) as f:
                        raw = f.read()
                except KeyError:
                    # 有些 epub 会在 href 里带奇怪的编码，MVP 先跳过
                    continue
                items.extend(
                    self.extract_items_from_document(
                        doc_path=doc_path,
                        raw=raw,
                        spine_index=spine_index,
                        rel_path=rel_path,
                        is_nav=pkg.nav_path == doc_path,
                    )
                )
                processed_paths.add(doc_path)

            # v3 nav.xhtml（目录通常不在 spine，必须显式处理）
            if pkg.nav_path and pkg.nav_path not in processed_paths:
                nav_lower = pkg.nav_path.lower()
                if nav_lower.endswith((".xhtml", ".html", ".htm")):
                    try:
                        with zip_reader.open(pkg.nav_path) as f:
                            raw = f.read()
                        items.extend(
                            self.extract_items_from_document(
                                doc_path=pkg.nav_path,
                                raw=raw,
                                spine_index=self.ROW_BASE_NAV // self.ROW_MULTIPLIER,
                                rel_path=rel_path,
                                is_nav=True,
                            )
                        )
                        processed_paths.add(pkg.nav_path)
                    except Exception as e:
                        LogManager.get().warning(
                            f"Failed to process nav document: {pkg.nav_path}", e
                        )

            # v2 ncx
            if pkg.ncx_path:
                try:
                    with zip_reader.open(pkg.ncx_path) as f:
                        raw = f.read()
                    items.extend(
                        self.extract_items_from_ncx(pkg.ncx_path, raw, rel_path)
                    )
                except Exception as e:
                    LogManager.get().warning(
                        f"Failed to process NCX document: {pkg.ncx_path}", e
                    )

        return items

    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        results: list[Item] = []
        for abs_path in abs_paths:
            rel_path = os.path.relpath(abs_path, input_path)
            with open(abs_path, "rb") as reader:
                results.extend(self.read_from_stream(reader.read(), rel_path))
        return results
