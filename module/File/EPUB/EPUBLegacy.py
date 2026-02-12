import copy
import io
import os
import re
import zipfile

from bs4 import BeautifulSoup

from base.Base import Base
from model.Item import Item
from module.Config import Config


class EPUBLegacy(Base):
    """旧 EPUB 写回逻辑，仅用于兼容老工程。

    老工程的 Item 没有 AST 定位信息（extra_field 为空），只能依赖"抽取顺序 == 写回顺序"。
    新工程默认走 AST writer，避免顺序错位问题。

    使用场景：
    - 项目是在 AST 方案上线前创建的
    - Item 的 extra_field 中没有 epub.parts 信息

    注意事项：
    - 本模块使用 BeautifulSoup 进行 HTML 解析，会丢失部分格式信息
    - 双语输出在导航页面会被跳过，避免链接重复
    """

    EPUB_TAGS: tuple[str, ...] = (
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
    )

    def __init__(self, config: Config) -> None:
        super().__init__()
        self.config = config

    @staticmethod
    def sanitize_opf(text: str) -> str:
        return text.replace('page-progression-direction="rtl"', "")

    @staticmethod
    def sanitize_css(text: str) -> str:
        return re.sub(
            r"[^;\s]*writing-mode\s*:\s*vertical-rl;*",
            "",
            text,
        )

    @staticmethod
    def fix_svg_attributes(bs: BeautifulSoup) -> None:
        """修正 SVG 标签的大小写敏感属性。"""

        attr_fixes = {
            "viewbox": "viewBox",
            "preserveaspectratio": "preserveAspectRatio",
            "pathlength": "pathLength",
            "gradientunits": "gradientUnits",
            "gradienttransform": "gradientTransform",
            "spreadmethod": "spreadMethod",
            "maskcontentunits": "maskContentUnits",
            "maskunits": "maskUnits",
            "patterncontentunits": "patternContentUnits",
            "patternunits": "patternUnits",
            "patterntransform": "patternTransform",
        }

        for svg in bs.find_all("svg"):
            for attr_lower, attr_correct in attr_fixes.items():
                if attr_lower in svg.attrs:
                    svg.attrs[attr_correct] = svg.attrs.pop(attr_lower)

            for child in svg.find_all():
                for attr_lower, attr_correct in attr_fixes.items():
                    if attr_lower in child.attrs:
                        child.attrs[attr_correct] = child.attrs.pop(attr_lower)

    def process_ncx(
        self,
        zip_reader: zipfile.ZipFile,
        zip_writer: zipfile.ZipFile,
        path: str,
        tag_group: dict[str, list[Item]],
    ) -> None:
        with zip_reader.open(path) as reader:
            target_items = tag_group.get(path, [])
            raw = reader.read()
            try:
                bs = BeautifulSoup(raw.decode("utf-8-sig"), "lxml-xml")
            except Exception:
                # 兜底：按 xml 解析失败时仍用默认解析器
                bs = BeautifulSoup(raw.decode("utf-8-sig"), "xml")

            for dom in bs.find_all("text"):
                if dom.get_text().strip() == "":
                    continue

                if not target_items:
                    continue

                item_obj = target_items.pop(0)
                dom.string = item_obj.get_effective_dst()

            zip_writer.writestr(path, str(bs))

    def process_html(
        self,
        zip_reader: zipfile.ZipFile,
        zip_writer: zipfile.ZipFile,
        path: str,
        tag_group: dict[str, list[Item]],
        bilingual: bool,
    ) -> None:
        with zip_reader.open(path) as reader:
            target_items = tag_group.get(path, [])
            bs = BeautifulSoup(reader.read().decode("utf-8-sig"), "html.parser")

            is_nav_page = (
                bs.find("nav", attrs={"epub:type": "toc"}) is not None
                or bs.find("nav", attrs={"epub:type": "landmarks"}) is not None
            )

            # 移除竖排样式
            for dom in bs.find_all():
                classes = dom.get("class", [])
                class_str = (
                    " ".join(classes) if isinstance(classes, list) else str(classes)
                )
                class_content = re.sub(r"[hv]rtl|[hv]ltr", "", class_str)
                if class_content.strip() == "":
                    dom.attrs.pop("class", None)
                else:
                    dom["class"] = class_content.strip().split(" ")

                style_content = re.sub(
                    r"[^;\s]*writing-mode\s*:\s*vertical-rl;*",
                    "",
                    dom.get("style", ""),
                )
                if style_content.strip() == "":
                    dom.attrs.pop("style", None)
                else:
                    dom["style"] = style_content

            for dom in bs.find_all(self.EPUB_TAGS):
                if dom.get_text().strip() == "" or dom.find(self.EPUB_TAGS) is not None:
                    continue

                if not target_items:
                    continue

                item_obj = target_items.pop(0)
                effective_dst = item_obj.get_effective_dst()

                # 双语（导航页除外，避免链接重复指向）
                if bilingual and not is_nav_page:
                    if not self.config.deduplication_in_bilingual or (
                        self.config.deduplication_in_bilingual
                        and item_obj.get_src() != effective_dst
                    ):
                        line_src = copy.copy(dom)
                        line_src["style"] = (
                            str(line_src.get("style", "")).rstrip(";") + "opacity:0.50;"
                        )
                        dom.insert_before(line_src)
                        dom.insert_before("\n")

                # 替换
                if item_obj.get_src() in str(dom):
                    dom.replace_with(
                        BeautifulSoup(
                            str(dom).replace(item_obj.get_src(), effective_dst),
                            "html.parser",
                        )
                    )
                elif not is_nav_page:
                    dom.string = effective_dst

            self.fix_svg_attributes(bs)
            zip_writer.writestr(path, str(bs))

    def build_epub(
        self,
        original_epub_bytes: bytes,
        items: list[Item],
        out_path: str,
        bilingual: bool,
    ) -> None:
        target = [item for item in items if item.get_file_type() == Item.FileType.EPUB]
        if not target:
            return

        sorted_items = sorted(target, key=lambda x: x.get_row())

        tag_group: dict[str, list[Item]] = {}
        for item in sorted_items:
            tag_group.setdefault(item.get_tag(), []).append(item)

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        src_zip = io.BytesIO(original_epub_bytes)

        with zipfile.ZipFile(out_path, "w") as zip_writer:
            with zipfile.ZipFile(src_zip, "r") as zip_reader:
                for path in zip_reader.namelist():
                    lower = path.lower()

                    if lower.endswith(".css"):
                        raw = zip_reader.read(path)
                        try:
                            zip_writer.writestr(
                                path,
                                self.sanitize_css(raw.decode("utf-8-sig")),
                            )
                        except Exception:
                            zip_writer.writestr(path, raw)
                        continue

                    if lower.endswith(".opf"):
                        raw = zip_reader.read(path)
                        try:
                            zip_writer.writestr(
                                path,
                                self.sanitize_opf(raw.decode("utf-8-sig")),
                            )
                        except Exception:
                            zip_writer.writestr(path, raw)
                        continue

                    if lower.endswith(".ncx"):
                        self.process_ncx(zip_reader, zip_writer, path, tag_group)
                        continue

                    if lower.endswith((".htm", ".html", ".xhtml")):
                        self.process_html(
                            zip_reader, zip_writer, path, tag_group, bilingual
                        )
                        continue

                    zip_writer.writestr(path, zip_reader.read(path))
