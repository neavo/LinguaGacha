import os
import re

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Text.TextHelper import TextHelper


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
    RE_RENPY = re.compile(r"\"(.*?)(?<!\\)\"(?!\")", flags=re.IGNORECASE)

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

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
        def process(text: str) -> str:
            return text.replace("\\n", "\n").replace('\\"', '"')

        items: list[Item] = []

        # 获取编码
        encoding = TextHelper.get_encoding(content=content, add_sig_to_utf8=True)
        text = content.decode(encoding)
        lines = [line.rstrip() for line in text.splitlines()]

        for i, line in enumerate(lines):
            results: list[str] = RENPY.RE_RENPY.findall(line)
            is_content_line = line.startswith("    # ") or line.startswith("    old ")

            # 不是内容行但找到匹配项目时，则直接跳过这一行
            if not is_content_line and len(results) > 0:
                continue
            elif is_content_line and len(results) == 1:
                src = results[0]
                dst = self.find_dst(i + 1, line, lines)
                name = None
            elif is_content_line and len(results) >= 2:
                src = results[1]
                dst = self.find_dst(i + 1, line, lines)
                name = results[0]
            else:
                src = ""
                dst = ""
                name = None

            # 添加数据
            if src == "":
                items.append(
                    Item.from_dict(
                        {
                            "src": process(src),
                            "dst": dst,
                            "name_src": name,
                            "name_dst": name,
                            "extra_field": line,
                            "row": len(items),
                            "file_type": Item.FileType.RENPY,
                            "file_path": rel_path,
                            "text_type": Item.TextType.RENPY,
                            "status": Base.ProjectStatus.EXCLUDED,
                        }
                    )
                )
            elif dst != "" and src != dst:
                items.append(
                    Item.from_dict(
                        {
                            "src": process(src),
                            "dst": dst,
                            "name_src": name,
                            "name_dst": name,
                            "extra_field": line,
                            "row": len(items),
                            "file_type": Item.FileType.RENPY,
                            "file_path": rel_path,
                            "text_type": Item.TextType.RENPY,
                            "status": Base.ProjectStatus.PROCESSED_IN_PAST,
                        }
                    )
                )
            else:
                # 此时存在两种情况：
                # 1. 源文与译文相同
                # 2. 源文不为空且译文为空
                # 在后续翻译步骤中，语言过滤等情况可能导致实际不翻译此条目
                # 而如果翻译后文件中 译文 为空，则实际游戏内文本显示也将为空
                # 为了避免这种情况，应该在添加数据时直接设置 dst 为 src 以避免出现预期以外的空译文
                items.append(
                    Item.from_dict(
                        {
                            "src": process(src),
                            "dst": process(src),
                            "name_src": name,
                            "name_dst": name,
                            "extra_field": line,
                            "row": len(items),
                            "file_type": Item.FileType.RENPY,
                            "file_path": rel_path,
                            "text_type": Item.TextType.RENPY,
                            "status": Base.ProjectStatus.NONE,
                        }
                    )
                )

        return items

    # 写入数据
    def write_to_path(self, items: list[Item]) -> None:
        def repl(m: re.Match, i: list[int], repl_list: list[str]) -> str:
            if i[0] < len(repl_list) and repl_list[i[0]] is not None:
                i[0] = i[0] + 1
                return f'"{repl_list[i[0] - 1]}"'
            else:
                i[0] = i[0] + 1
                return m.group(0)

        def process(text: str) -> str:
            return text.replace("\n", "\\n").replace('\\"', '"').replace('"', '\\"')

        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.RENPY]

        # 统一或还原姓名字段
        if not self.config.write_translated_name_fields_to_file:
            self.revert_name(target)
        else:
            self.uniform_name(target)

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, group_items in group.items():
            # 按行号排序
            sorted_items = sorted(group_items, key=lambda x: x.get_row())

            # 获取输出目录
            output_path = DataManager.get().get_translated_path()

            # 数据处理
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            result = []
            for item in sorted_items:
                dst: str = item.get_dst()
                name_dst_raw = item.get_name_dst()
                name_dst: str = (
                    name_dst_raw if isinstance(name_dst_raw, str) else ""
                )  # RenPy names are expected to be str
                line: str = item.get_extra_field()
                results: list[str] = RENPY.RE_RENPY.findall(line)

                # 添加原文
                result.append(line)

                # 添加译文
                i = [0]
                dsts: list[str] = []
                if len(results) == 1:
                    dsts = [process(dst)]
                elif len(results) >= 2:
                    dsts = [name_dst, process(dst)]

                if line.startswith("    # "):
                    if len(results) > 0:
                        line_processed = RENPY.RE_RENPY.sub(
                            lambda m: repl(m, i, dsts), line
                        )
                        result.append(f"    {line_processed.removeprefix('    # ')}")
                elif line.startswith("    old "):
                    if len(results) > 0:
                        line_processed = RENPY.RE_RENPY.sub(
                            lambda m: repl(m, i, dsts), line
                        )
                        result.append(
                            f"    new {line_processed.removeprefix('    old ')}"
                        )

            with open(abs_path, "w", encoding="utf-8") as writer:
                writer.write("\n".join(result))

    # 获取译文
    def find_dst(self, start: int, line: str, lines: list[str]) -> str:
        # 越界检查
        if start >= len(lines):
            return ""

        # 遍历剩余行寻找目标数据
        line_clean = line.removeprefix("    # ").removeprefix("    old ")
        for line_ex in lines[start:]:
            line_ex_clean = line_ex.removeprefix("    ").removeprefix("    new ")
            results: list[str] = RENPY.RE_RENPY.findall(line_ex_clean)
            if RENPY.RE_RENPY.sub("", line_clean) == RENPY.RE_RENPY.sub(
                "", line_ex_clean
            ):
                if len(results) == 1:
                    return results[0]
                elif len(results) >= 2:
                    return results[1]

        return ""

    # 还原姓名字段
    def revert_name(self, items: list[Item]) -> None:
        for item in items:
            name_src = item.get_name_src()
            if name_src is not None:
                item.set_name_dst(name_src)

    # 统一姓名字段
    def uniform_name(self, items: list[Item]) -> None:
        # 统计
        result: dict[str, dict[str, int]] = {}
        for item in items:
            name_src_raw = item.get_name_src()
            name_dst_raw = item.get_name_dst()

            # 有效性检查
            if name_src_raw is None or name_dst_raw is None:
                continue

            name_src = [name_src_raw] if isinstance(name_src_raw, str) else name_src_raw
            name_dst = [name_dst_raw] if isinstance(name_dst_raw, str) else name_dst_raw

            for src, dst in zip(name_src, name_dst):
                if src not in result:
                    result[src] = {}
                result[src][dst] = result[src].get(dst, 0) + 1

        # 获取译文
        final_names: dict[str, str] = {}
        for src, name_counts in result.items():
            final_names[src] = max(name_counts, key=lambda k: name_counts[k])

        # 赋值
        for item in items:
            name_src_raw = item.get_name_src()
            if name_src_raw is None:
                continue

            if isinstance(name_src_raw, str):
                item.set_name_dst(final_names.get(name_src_raw, name_src_raw))
            elif isinstance(name_src_raw, list):
                item.set_name_dst([final_names.get(v, v) for v in name_src_raw])
