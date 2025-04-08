import os
import re

from base.Base import Base
from module.Cache.CacheItem import CacheItem

class RENPY(Base):

    # # game/script8.rpy:16878
    # translate chinese arabialogoff_e5798d9a:
    #
    #     # "lo" "And you...?{w=2.3}{nw}" with dissolve
    #     # "lo" "" with dissolve
    #
    # # game/script/1-home/1-Perso_Home/elice.rpy:281
    # translate schinese elice_ask_home_f01e3240_5:
    #
    #     # e ".{w=0.5}.{w=0.5}.{w=0.5}{nw}"
    #     e ""
    #
    # # game/script8.rpy:33
    # translate chinese update08_a626b58f:
    #
    #     # "*Snorts* Fucking hell, I hate with this dumpster of a place." with dis06
    #     "" with dis06
    #
    # translate chinese strings:
    #
    #     # game/script8.rpy:307
    #     old "Accompany her to the inn"
    #     new ""
    #
    #     # game/script8.rpy:2173
    #     old "{sc=3}{size=44}Jump off the ship.{/sc}"
    #     new ""
    #
    # # game/routes/endings/laura/normal/Harry/l_normal_11_h.rpy:3
    # translate schinese l_normal_11_h_f9190bc9:
    #
    #     # nvl clear
    #     # n "After a wonderful night, the next day, to our displeasure, we were faced with the continuation of the commotion that I had accidentally engendered the morning prior."
    #     n ""

    # 匹配 RenPy 文本的规则
    RE_RENPY = re.compile(r"\"(.*?)(?<!\\)\"(?!\")", flags = re.IGNORECASE)

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        items: list[CacheItem] = []
        for abs_path in set(abs_paths):
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, self.input_path)

            # 数据处理
            with open(abs_path, "r", encoding = "utf-8-sig") as reader:
                lines = [line.rstrip() for line in reader.readlines()]

            for i, line in enumerate(lines):
                results: list[str] = RENPY.RE_RENPY.findall(line)
                is_content_line = line.startswith("    # ") or line.startswith("    old ")

                # 不是内容行但找到匹配项目时，则直接跳过这一行
                if is_content_line == False and len(results) > 0:
                    continue
                elif is_content_line == True and len(results) == 1:
                    src = results[0].replace("\\n", "\n").replace("\\\"", "\"")
                    dst = self.find_dst(i + 1, lines)
                    name = None
                elif is_content_line == True and len(results) >= 2:
                    src = results[1].replace("\\n", "\n").replace("\\\"", "\"")
                    dst = self.find_dst(i + 1, lines)
                    name = results[0]
                else:
                    src = ""
                    dst = ""
                    name = None

                # 添加数据
                if src == "":
                    items.append(
                        CacheItem({
                            "src": src,
                            "dst": dst,
                            "name_src": name,
                            "name_dst": name,
                            "extra_field": line,
                            "row": len(items),
                            "file_type": CacheItem.FileType.RENPY,
                            "file_path": rel_path,
                            "text_type": CacheItem.TextType.RENPY,
                            "status": Base.TranslationStatus.EXCLUDED,
                        })
                    )
                elif dst != "" and src != dst:
                    items.append(
                        CacheItem({
                            "src": src,
                            "dst": dst,
                            "name_src": name,
                            "name_dst": name,
                            "extra_field": line,
                            "row": len(items),
                            "file_type": CacheItem.FileType.RENPY,
                            "file_path": rel_path,
                            "text_type": CacheItem.TextType.RENPY,
                            "status": Base.TranslationStatus.TRANSLATED_IN_PAST,
                        })
                    )
                else:
                    items.append(
                        CacheItem({
                            "src": src,
                            "dst": dst,
                            "name_src": name,
                            "name_dst": name,
                            "extra_field": line,
                            "row": len(items),
                            "file_type": CacheItem.FileType.RENPY,
                            "file_path": rel_path,
                            "text_type": CacheItem.TextType.RENPY,
                            "status": Base.TranslationStatus.UNTRANSLATED,
                        })
                    )

        return items

    # 写入数据
    def write_to_path(self, items: list[CacheItem]) -> None:

        def repl(m: re.Match, i: list[int], repl: list[str]) -> str:
            if i[0] < len(repl) and repl[i[0]] is not None:
                i[0] = i[0] + 1
                return f"\"{repl[i[0] - 1]}\""
            else:
                i[0] = i[0] + 1
                return m.group(0)

        def process(text: str) -> str:
            return text.replace("\n", "\\n").replace("\\\"", "\"").replace("\"", "\\\"")

        # 筛选
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.RENPY
        ]

        # 统一姓名
        self.uniform_name(target)

        # 按文件路径分组
        data: dict[str, list[str]] = {}
        for item in target:
            data.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in data.items():
            # 按行号排序
            items = sorted(items, key = lambda x: x.get_row())

            # 数据处理
            abs_path = os.path.join(self.output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)

            result = []
            for item in items:
                dst: str = item.get_dst()
                name_dst: str = item.get_name_dst()
                line: str = item.get_extra_field()
                results: list[str] = RENPY.RE_RENPY.findall(line)

                # 添加原文
                result.append(line)

                # 添加译文
                i = [0]
                if len(results) == 1:
                    dsts: list[str] = [process(dst)]
                elif len(results) >= 2:
                    dsts: list[str] = [name_dst, process(dst)]
                if line.startswith("    # "):
                    if len(results) > 0:
                        line = RENPY.RE_RENPY.sub(lambda m: repl(m, i, dsts), line)
                        result.append(f"    {line.removeprefix("    # ")}")
                elif line.startswith("    old "):
                    if len(results) > 0:
                        line = RENPY.RE_RENPY.sub(lambda m: repl(m, i, dsts), line)
                        result.append(f"    new {line.removeprefix("    old ")}")

            with open(abs_path, "w", encoding = "utf-8") as writer:
                writer.write("\n".join(result))

    # 获取译文
    def find_dst(self, start: int, lines: list[str]) -> str:
        # 越界检查
        if start >= len(lines):
            return ""

        # 遍历剩余行寻找目标数据
        for line in lines[start:]:
            results: list[str] = RENPY.RE_RENPY.findall(line)
            is_content_line = line.startswith("    # ") or line.startswith("    old ")

            if is_content_line == False and len(results) == 1:
                return results[0]
            elif is_content_line == False and len(results) >= 2:
                return results[1]

        return ""

    # 统一姓名
    def uniform_name(self, items: list[CacheItem]) -> list[CacheItem]:
        # 统计
        result: dict[str, dict] = {}
        for item in items:
            name_src = item.get_name_src()
            name_dst = item.get_name_dst()

            # 有效性检查
            if name_src is None or name_dst is None:
                continue

            if isinstance(name_src, str):
                name_src = [name_src]
            if isinstance(name_dst, str):
                name_dst = [name_dst]
            for src, dst in zip(name_src, name_dst):
                if src not in result:
                    result[src] = {}
                if dst not in result.get(src):
                    result[src][dst] = 1
                else:
                    result[src][dst] = result.get(src).get(dst) + 1

        # 获取译文
        for src, item in result.items():
            result[src] = max(item, key = item.get)

        # 赋值
        for item in items:
            name_src = item.get_name_src()
            name_dst = item.get_name_dst()

            # 有效性检查
            if name_src is None or name_dst is None:
                continue

            if isinstance(name_src, str):
                item.set_name_dst(result.get(name_src))
            elif isinstance(name_src, list):
                item.set_name_dst([result.get(v) for v in name_src])