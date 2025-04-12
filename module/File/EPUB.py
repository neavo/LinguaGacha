import os
import re
import copy
import shutil
import zipfile

from bs4 import BeautifulSoup
from lxml import etree

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.Localizer.Localizer import Localizer
from module.ExpertConfig import ExpertConfig

class EPUB(Base):

    # 显式引用以避免打包问题
    etree

    # EPUB 文件中读取的标签范围
    EPUB_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "li", "td")

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 在扩展名前插入文本
    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.target_language.lower()}{ext}"

    # 在扩展名前插入文本
    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.source_language.lower()}.{self.target_language.lower()}{ext}"

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        items = []
        for abs_path in set(abs_paths):
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, self.input_path)

            # 将原始文件复制一份
            os.makedirs(os.path.dirname(f"{self.output_path}/cache/temp/{rel_path}"), exist_ok = True)
            shutil.copy(abs_path, f"{self.output_path}/cache/temp/{rel_path}")

            # 数据处理
            with zipfile.ZipFile(abs_path, "r") as zip_reader:
                for path in zip_reader.namelist():
                    if path.lower().endswith((".htm", ".html", ".xhtml")):
                        with zip_reader.open(path) as reader:
                            bs = BeautifulSoup(reader.read().decode("utf-8-sig"), "html.parser")
                            for dom in bs.find_all(EPUB.EPUB_TAGS):
                                # 跳过空标签或嵌套标签
                                if dom.get_text().strip() == "" or dom.find(EPUB.EPUB_TAGS) != None:
                                    continue

                                # 添加数据
                                items.append(CacheItem({
                                    "src": dom.get_text(),
                                    "dst": dom.get_text(),
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.EPUB,
                                    "file_path": rel_path,
                                }))
                    elif path.lower().endswith(".ncx"):
                        with zip_reader.open(path) as reader:
                            bs = BeautifulSoup(reader.read().decode("utf-8-sig"), "lxml-xml")
                            for dom in bs.find_all("text"):
                                # 跳过空标签
                                if dom.get_text().strip() == "":
                                    continue

                                items.append(CacheItem({
                                    "src": dom.get_text(),
                                    "dst": dom.get_text(),
                                    "tag": path,
                                    "row": len(items),
                                    "file_type": CacheItem.FileType.EPUB,
                                    "file_path": rel_path,
                                }))

        return items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:

        def process_opf(zip_reader: zipfile.ZipFile, path: str) -> None:
            with zip_reader.open(path) as reader:
                zip_writer.writestr(
                    path,
                    reader.read().decode("utf-8-sig").replace("page-progression-direction=\"rtl\"", ""),
                )

        def process_css(zip_reader: zipfile.ZipFile, path: str) -> None:
            with zip_reader.open(path) as reader:
                zip_writer.writestr(
                    path,
                    re.sub(r"[^;\s]*writing-mode\s*:\s*vertical-rl;*", "", reader.read().decode("utf-8-sig")),
                )

        def process_ncx(zip_reader: zipfile.ZipFile, path: str, items: list[CacheItem]) -> None:
            with zip_reader.open(path) as reader:
                target = [item for item in items if item.get_tag() == path]
                bs = BeautifulSoup(reader.read().decode("utf-8-sig"), "lxml-xml")
                for dom in bs.find_all("text"):
                    # 跳过空标签
                    if dom.get_text().strip() == "":
                        continue

                    # 处理不同情况
                    item = target.pop(0)
                    dom_a = dom.find("a")
                    if dom_a != None:
                        dom_a.string = item.get_dst()
                    else:
                        dom.string = item.get_dst()

                # 将修改后的内容写回去
                zip_writer.writestr(path, str(bs))

        def process_html(zip_reader: zipfile.ZipFile, path: str, items: list[CacheItem], bilingual: bool) -> None:
            with zip_reader.open(path) as reader:
                target = [item for item in items if item.get_tag() == path]
                bs = BeautifulSoup(reader.read().decode("utf-8-sig"), "html.parser")

                # 判断是否是导航页
                is_nav_page = bs.find("nav", attrs = {"epub:type": "toc"}) != None

                # 移除竖排样式
                for dom in bs.find_all():
                    class_content: str = re.sub(r"[hv]rtl|[hv]ltr", "", " ".join(dom.get("class", "")))
                    if class_content == "":
                        dom.attrs.pop("class", None)
                    else:
                        dom["class"] = class_content.split(" ")
                    style_content: str = re.sub(r"[^;\s]*writing-mode\s*:\s*vertical-rl;*", "", dom.get("style", ""))
                    if style_content == "":
                        dom.attrs.pop("style", None)
                    else:
                        dom["style"] = style_content

                for dom in bs.find_all(EPUB.EPUB_TAGS):
                    # 跳过空标签或嵌套标签
                    if dom.get_text().strip() == "" or dom.find(EPUB.EPUB_TAGS) != None:
                        continue

                    # 取数据
                    item = target.pop(0)

                    # 输出双语
                    if bilingual == True:
                        if (
                            ExpertConfig.get().deduplication_in_bilingual != True
                            or (ExpertConfig.get().deduplication_in_bilingual == True and item.get_src() != item.get_dst())
                        ):
                            line_src = copy.copy(dom)
                            line_src["style"] = line_src.get("style", "").removesuffix(";") + "opacity:0.50;"
                            dom.insert_before(line_src)
                            dom.insert_before("\n")

                    # 根据不同类型的页面处理不同情况
                    if item.get_src() in str(dom):
                        dom.replace_with(BeautifulSoup(str(dom).replace(item.get_src(), item.get_dst()), "html.parser"))
                    elif is_nav_page == False:
                        dom.string = item.get_dst()
                    else:
                        pass

                # 将修改后的内容写回去
                zip_writer.writestr(path, str(bs))

        # 筛选
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.EPUB
        ]

        # 按文件路径分组
        data: dict[str, list[str]] = {}
        for item in target:
            data.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in data.items():
            # 按行号排序
            items = sorted(items, key = lambda x: x.get_row())

            # 数据处理
            abs_path = f"{self.output_path}/{rel_path}"
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            with zipfile.ZipFile(self.insert_target(abs_path), "w") as zip_writer:
                with zipfile.ZipFile(f"{self.output_path}/cache/temp/{rel_path}", "r") as zip_reader:
                    for path in zip_reader.namelist():
                        if path.lower().endswith(".css"):
                            process_css(zip_reader, path)
                        elif path.lower().endswith(".opf"):
                            process_opf(zip_reader, path)
                        elif path.lower().endswith(".ncx"):
                            process_ncx(zip_reader, path, items)
                        elif path.lower().endswith((".htm", ".html", ".xhtml")):
                            process_html(zip_reader, path, items, False)
                        else:
                            zip_writer.writestr(path, zip_reader.read(path))

        # 分别处理每个文件（双语）
        for rel_path, items in data.items():
            # 按行号排序
            items = sorted(items, key = lambda x: x.get_row())

            # 数据处理
            abs_path = f"{self.output_path}/{Localizer.get().path_bilingual}/{rel_path}"
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            with zipfile.ZipFile(self.insert_source_target(abs_path), "w") as zip_writer:
                with zipfile.ZipFile(f"{self.output_path}/cache/temp/{rel_path}", "r") as zip_reader:
                    for path in zip_reader.namelist():
                        if path.lower().endswith(".css"):
                            process_css(zip_reader, path)
                        elif path.lower().endswith(".opf"):
                            process_opf(zip_reader, path)
                        elif path.lower().endswith(".ncx"):
                            process_ncx(zip_reader, path, items)
                        elif path.lower().endswith((".htm", ".html", ".xhtml")):
                            process_html(zip_reader, path, items, True)
                        else:
                            zip_writer.writestr(path, zip_reader.read(path))