import copy
import io
import os
import re
import zipfile

from bs4 import BeautifulSoup
from bs4 import Tag
from lxml import etree

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Storage.AssetStore import AssetStore
from module.Storage.PathStore import PathStore
from module.Storage.StorageContext import StorageContext


class EPUB(Base):
    # 显式引用以避免打包问题
    etree

    # EPUB 文件中读取的标签范围
    EPUB_TAGS = (
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
        "blockquote",
    )

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

    @staticmethod
    def should_skip_dom(dom: Tag) -> bool:
        # Why: 读取与写回必须使用完全一致的过滤规则，否则条目会错位导致整页串翻。
        text = dom.get_text()
        if text.strip() == "":
            return True
        if dom.find(EPUB.EPUB_TAGS) is not None:
            return True

        # Why: EPUB 常用 <blockquote> 表示目录缩进/列表/侧栏等，但代码清单也常被包成 blockquote。
        #      代码清单一旦送去翻译会被破坏，因此需要跳过明显的“代码块”结构。
        if dom.name != "blockquote":
            return False

        tt_count = len(dom.find_all("tt"))
        br_count = len(dom.find_all("br"))
        newline_count = text.count("\n")
        code_like_count = len(dom.find_all(["pre", "code", "kbd", "samp"]))
        if tt_count >= 4 and (br_count >= 1 or newline_count >= 1):
            return True
        if tt_count >= 12:
            return True
        if code_like_count > 0 and (br_count >= 1 or newline_count >= 1):
            return True

        return False

    # 在扩展名前插入文本
    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.target_language.lower()}{ext}"

    # 在扩展名前插入文本
    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return (
            f"{root}.{self.source_language.lower()}.{self.target_language.lower()}{ext}"
        )

    # 读取
    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        items: list[Item] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, input_path)

            # 数据处理
            with open(abs_path, "rb") as reader:
                items.extend(self.read_from_stream(reader.read(), rel_path))

        return items

    # 从流读取
    def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
        items: list[Item] = []

        with zipfile.ZipFile(io.BytesIO(content), "r") as zip_reader:
            for path in zip_reader.namelist():
                if path.lower().endswith((".htm", ".html", ".xhtml")):
                    with zip_reader.open(path) as reader:
                        bs = BeautifulSoup(
                            reader.read().decode("utf-8-sig"), "html.parser"
                        )
                        for dom in bs.find_all(EPUB.EPUB_TAGS):
                            if EPUB.should_skip_dom(dom):
                                continue

                            # 添加数据
                            items.append(
                                Item.from_dict(
                                    {
                                        "src": dom.get_text(),
                                        "dst": dom.get_text(),
                                        "tag": path,
                                        "row": len(items),
                                        "file_type": Item.FileType.EPUB,
                                        "file_path": rel_path,
                                    }
                                )
                            )
                elif path.lower().endswith(".ncx"):
                    with zip_reader.open(path) as reader:
                        bs = BeautifulSoup(
                            reader.read().decode("utf-8-sig"), "lxml-xml"
                        )
                        for dom in bs.find_all("text"):
                            # 跳过空标签
                            if dom.get_text().strip() == "":
                                continue

                            items.append(
                                Item.from_dict(
                                    {
                                        "src": dom.get_text(),
                                        "dst": dom.get_text(),
                                        "tag": path,
                                        "row": len(items),
                                        "file_type": Item.FileType.EPUB,
                                        "file_path": rel_path,
                                    }
                                )
                            )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        def process_opf(zip_reader: zipfile.ZipFile, path: str) -> None:
            with zip_reader.open(path) as reader_inner:
                zip_writer.writestr(
                    path,
                    reader_inner.read()
                    .decode("utf-8-sig")
                    .replace('page-progression-direction="rtl"', ""),
                )

        def process_css(zip_reader: zipfile.ZipFile, path: str) -> None:
            with zip_reader.open(path) as reader_inner:
                zip_writer.writestr(
                    path,
                    re.sub(
                        r"[^;\s]*writing-mode\s*:\s*vertical-rl;*",
                        "",
                        reader_inner.read().decode("utf-8-sig"),
                    ),
                )

        def process_ncx(
            zip_reader: zipfile.ZipFile, path: str, tag_group: dict[str, list[Item]]
        ) -> None:
            with zip_reader.open(path) as reader_inner:
                target_items = tag_group.get(path, [])
                bs = BeautifulSoup(reader_inner.read().decode("utf-8-sig"), "lxml-xml")
                for dom in bs.find_all("text"):
                    # 跳过空标签
                    if dom.get_text().strip() == "":
                        continue

                    # 处理不同情况
                    if not target_items:
                        continue
                    item_obj = target_items.pop(0)
                    dom_a = dom.find("a")
                    if dom_a is not None:
                        dom_a.string = item_obj.get_dst()
                    else:
                        dom.string = item_obj.get_dst()

                # 将修改后的内容写回去
                zip_writer.writestr(path, str(bs))

        def fix_svg_attributes(bs: BeautifulSoup) -> None:
            """修正 SVG 标签的大小写敏感属性"""
            # 需要修正的属性映射(小写 -> 正确大小写)
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

            # 遍历所有 SVG 标签
            for svg in bs.find_all("svg"):
                # 修正 SVG 标签本身的属性
                for attr_lower, attr_correct in attr_fixes.items():
                    if attr_lower in svg.attrs:
                        svg.attrs[attr_correct] = svg.attrs.pop(attr_lower)

                # 修正 SVG 子元素的属性
                for child in svg.find_all():
                    for attr_lower, attr_correct in attr_fixes.items():
                        if attr_lower in child.attrs:
                            child.attrs[attr_correct] = child.attrs.pop(attr_lower)

        def process_html(
            zip_reader: zipfile.ZipFile,
            path: str,
            tag_group: dict[str, list[Item]],
            bilingual: bool,
        ) -> None:
            with zip_reader.open(path) as reader_inner:
                target_items = tag_group.get(path, [])
                bs = BeautifulSoup(
                    reader_inner.read().decode("utf-8-sig"), "html.parser"
                )

                # 判断是否是导航页（包括目录和地标导航）
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
                    class_content: str = re.sub(r"[hv]rtl|[hv]ltr", "", class_str)
                    if class_content.strip() == "":
                        dom.attrs.pop("class", None)
                    else:
                        dom["class"] = class_content.strip().split(" ")

                    style_content: str = re.sub(
                        r"[^;\s]*writing-mode\s*:\s*vertical-rl;*",
                        "",
                        dom.get("style", ""),
                    )
                    if style_content.strip() == "":
                        dom.attrs.pop("style", None)
                    else:
                        dom["style"] = style_content

                for dom in bs.find_all(EPUB.EPUB_TAGS):
                    if EPUB.should_skip_dom(dom):
                        continue

                    # 取数据
                    if not target_items:
                        continue
                    item_obj = target_items.pop(0)

                    # 输出双语（导航页除外，避免链接重复指向）
                    if bilingual and not is_nav_page:
                        if not self.config.deduplication_in_bilingual or (
                            self.config.deduplication_in_bilingual
                            and item_obj.get_src() != item_obj.get_dst()
                        ):
                            line_src = copy.copy(dom)
                            line_src["style"] = (
                                line_src.get("style", "").removesuffix(";")
                                + "opacity:0.50;"
                            )
                            dom.insert_before(line_src)
                            dom.insert_before("\n")

                    # 根据不同类型的页面处理不同情况
                    if item_obj.get_src() in str(dom):
                        dom.replace_with(
                            BeautifulSoup(
                                str(dom).replace(
                                    item_obj.get_src(), item_obj.get_dst()
                                ),
                                "html.parser",
                            )
                        )
                    elif not is_nav_page:
                        dom.string = item_obj.get_dst()
                    else:
                        pass

                # 修正 SVG 标签的属性大小写
                fix_svg_attributes(bs)

                # 将修改后的内容写回去
                zip_writer.writestr(path, str(bs))

        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.EPUB]

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, group_items in group.items():
            # 按行号排序
            sorted_items = sorted(group_items, key=lambda x: x.get_row())

            # 预分组
            tag_group: dict[str, list[Item]] = {}
            for item in sorted_items:
                tag_group.setdefault(item.get_tag(), []).append(item)

            # 获取输出目录
            output_path = PathStore.get_translated_path()

            # 数据处理
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            # 从工程 assets 获取原始文件内容
            db = StorageContext.get().get_db()
            if db is None:
                continue
            compressed = db.get_asset(rel_path)
            if compressed is None:
                continue
            original_content = AssetStore.decompress(compressed)
            source_zip = io.BytesIO(original_content)

            with zipfile.ZipFile(self.insert_target(abs_path), "w") as zip_writer:
                with zipfile.ZipFile(source_zip, "r") as zip_reader:
                    for path in zip_reader.namelist():
                        if path.lower().endswith(".css"):
                            process_css(zip_reader, path)
                        elif path.lower().endswith(".opf"):
                            process_opf(zip_reader, path)
                        elif path.lower().endswith(".ncx"):
                            process_ncx(zip_reader, path, tag_group)
                        elif path.lower().endswith((".htm", ".html", ".xhtml")):
                            process_html(zip_reader, path, tag_group, False)
                        else:
                            zip_writer.writestr(path, zip_reader.read(path))

        # 分别处理每个文件（双语）
        for rel_path, group_items in group.items():
            # 按行号排序
            sorted_items = sorted(group_items, key=lambda x: x.get_row())

            # 预分组
            tag_group: dict[str, list[Item]] = {}
            for item in sorted_items:
                tag_group.setdefault(item.get_tag(), []).append(item)

            # 获取输出目录
            bilingual_path = PathStore.get_bilingual_path()

            # 数据处理
            abs_path = os.path.join(bilingual_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            # 从工程 assets 获取原始文件内容
            db = StorageContext.get().get_db()
            if db is None:
                continue
            compressed = db.get_asset(rel_path)
            if compressed is None:
                continue
            original_content = AssetStore.decompress(compressed)
            source_zip = io.BytesIO(original_content)

            with zipfile.ZipFile(
                self.insert_source_target(abs_path), "w"
            ) as zip_writer:
                with zipfile.ZipFile(source_zip, "r") as zip_reader:
                    for path in zip_reader.namelist():
                        if path.lower().endswith(".css"):
                            process_css(zip_reader, path)
                        elif path.lower().endswith(".opf"):
                            process_opf(zip_reader, path)
                        elif path.lower().endswith(".ncx"):
                            process_ncx(zip_reader, path, tag_group)
                        elif path.lower().endswith((".htm", ".html", ".xhtml")):
                            process_html(zip_reader, path, tag_group, True)
                        else:
                            zip_writer.writestr(path, zip_reader.read(path))
