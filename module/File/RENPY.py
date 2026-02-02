import os
import re

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.File.RenPyTL.RenPyTlExtractor import RenPyTlExtractor
from module.File.RenPyTL.RenPyTlLexer import sha1_hex
from module.File.RenPyTL.RenPyTlParser import parse_document
from module.File.RenPyTL.RenPyTlWriter import RenPyTlWriter
from module.Text.TextHelper import TextHelper


class RENPY(Base):
    RE_TRANSLATE_HEADER = re.compile(
        r"^translate\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*:\s*$"
    )
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
        # 获取编码
        encoding = TextHelper.get_encoding(content=content, add_sig_to_utf8=True)
        text = content.decode(encoding)
        lines = text.splitlines()

        doc = parse_document(lines)
        extractor = RenPyTlExtractor()
        return extractor.extract(doc, rel_path)

    # 写入数据
    def write_to_path(self, items: list[Item]) -> None:
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

        dm = DataManager.get()
        output_path = dm.get_translated_path()
        writer = RenPyTlWriter()
        extractor = RenPyTlExtractor()

        for rel_path, group_items in group.items():
            original = dm.get_asset_decompressed(rel_path)
            if original is None:
                continue

            encoding = TextHelper.get_encoding(content=original, add_sig_to_utf8=True)
            text = original.decode(encoding)
            lines = text.splitlines()

            items_to_apply = self.build_items_for_writeback(
                extractor,
                rel_path,
                lines,
                group_items,
            )
            items_to_apply.sort(key=self.get_item_target_line)

            applied, skipped = writer.apply_items_to_lines(lines, items_to_apply)
            if skipped > 0:
                # 导出阶段的写回是“尽量写回但不写错行”，因此这里记录 skipped 便于排查。
                self.warning(
                    f"RENPY 导出写回跳过 {skipped} 条: {rel_path} (applied={applied})",
                    console=False,
                )

            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))

    def build_items_for_writeback(
        self,
        extractor: RenPyTlExtractor,
        rel_path: str,
        lines: list[str],
        items: list[Item],
    ) -> list[Item]:
        # 仅当该文件的所有条目都携带 AST extra_field 时才直接写回。
        # 若存在新旧格式混用（部分为 legacy extra_field=str），直接写回会导致 legacy 条目被跳过。
        if items and all(self.has_ast_extra_field(v) for v in items):
            return items

        doc = parse_document(lines)
        new_items = extractor.extract(doc, rel_path)

        ast_written_target_lines = self.transfer_ast_translations(items, new_items)
        self.transfer_legacy_translations(items, new_items, ast_written_target_lines)

        if not self.config.write_translated_name_fields_to_file:
            self.revert_name(new_items)
        else:
            self.uniform_name(new_items)

        return new_items

    def has_ast_extra_field(self, item: Item) -> bool:
        extra_raw = item.get_extra_field()
        if not isinstance(extra_raw, dict):
            return False
        renpy = extra_raw.get("renpy")
        return isinstance(renpy, dict)

    def get_item_target_line(self, item: Item) -> int:
        extra_raw = item.get_extra_field()
        extra = extra_raw if isinstance(extra_raw, dict) else {}
        renpy = extra.get("renpy", {}) if isinstance(extra.get("renpy"), dict) else {}
        pair = renpy.get("pair", {}) if isinstance(renpy.get("pair"), dict) else {}
        line = pair.get("target_line")
        return int(line) if isinstance(line, int) else 0

    def transfer_legacy_translations(
        self,
        legacy_items: list[Item],
        new_items: list[Item],
        skip_target_lines: set[int] | None = None,
    ) -> None:
        legacy_by_key: dict[tuple[str, str, str], list[Item]] = {}

        current_lang: str | None = None
        current_label: str | None = None
        for item in sorted(legacy_items, key=lambda x: x.get_row()):
            extra_raw = item.get_extra_field()
            if not isinstance(extra_raw, str):
                continue

            header = self.parse_translate_header(extra_raw)
            if header is not None:
                current_lang, current_label = header
                continue

            if current_lang is None or current_label is None:
                continue

            if item.get_src() == "":
                continue

            key = (current_lang, current_label, sha1_hex(extra_raw))
            legacy_by_key.setdefault(key, []).append(item)

        for item in new_items:
            if skip_target_lines is not None:
                target_line = self.get_item_target_line(item)
                if target_line in skip_target_lines:
                    continue

            keys = self.build_ast_keys(item)
            if not keys:
                continue

            candidates: list[Item] | None = None
            for key in keys:
                bucket = legacy_by_key.get(key)
                if bucket:
                    candidates = bucket
                    break
            if candidates is None:
                continue

            picked = self.pick_best_candidate(item, candidates)
            item.set_dst(picked.get_dst())
            if picked.get_name_dst() is not None:
                item.set_name_dst(picked.get_name_dst())

    def transfer_ast_translations(
        self,
        existing_items: list[Item],
        new_items: list[Item],
    ) -> set[int]:
        existing_by_key: dict[tuple[str, str, str], list[Item]] = {}
        for item in existing_items:
            if not self.has_ast_extra_field(item):
                continue

            keys = self.build_ast_keys(item)
            if not keys:
                continue

            # 仅使用主 key 建索引，避免同一条目被重复消耗。
            existing_by_key.setdefault(keys[0], []).append(item)

        written_target_lines: set[int] = set()
        for item in new_items:
            keys = self.build_ast_keys(item)
            if not keys:
                continue

            candidates: list[Item] | None = None
            for key in keys:
                bucket = existing_by_key.get(key)
                if bucket:
                    candidates = bucket
                    break
            if candidates is None:
                continue

            picked = self.pick_best_candidate(item, candidates)
            item.set_dst(picked.get_dst())
            if picked.get_name_dst() is not None:
                item.set_name_dst(picked.get_name_dst())

            target_line = self.get_item_target_line(item)
            if target_line > 0:
                written_target_lines.add(target_line)

        return written_target_lines

    def build_ast_keys(self, item: Item) -> list[tuple[str, str, str]]:
        extra_raw = item.get_extra_field()
        extra = extra_raw if isinstance(extra_raw, dict) else {}
        renpy = extra.get("renpy")
        if not isinstance(renpy, dict):
            return []
        block = renpy.get("block")
        digest = renpy.get("digest")
        if not isinstance(block, dict) or not isinstance(digest, dict):
            return []
        lang = block.get("lang")
        label = block.get("label")
        if not isinstance(lang, str) or not isinstance(label, str):
            return []

        primary = digest.get("template_raw_sha1")
        fallback = digest.get("template_raw_rstrip_sha1")

        keys: list[tuple[str, str, str]] = []
        if isinstance(primary, str) and primary != "":
            keys.append((lang, label, primary))
        if (
            isinstance(fallback, str)
            and fallback != ""
            and (not keys or fallback != keys[0][2])
        ):
            keys.append((lang, label, fallback))

        return keys

    def pick_best_candidate(self, item: Item, candidates: list[Item]) -> Item:
        if len(candidates) == 1:
            return candidates.pop(0)

        src = item.get_src()
        name = item.get_name_src()

        for i, cand in enumerate(candidates):
            if cand.get_src() == src and cand.get_name_src() == name:
                return candidates.pop(i)

        for i, cand in enumerate(candidates):
            if cand.get_src() == src:
                return candidates.pop(i)

        return candidates.pop(0)

    def parse_translate_header(self, line: str) -> tuple[str, str] | None:
        m = self.RE_TRANSLATE_HEADER.match(line.strip())
        if m is None:
            return None
        return m.group(1), m.group(2)

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
