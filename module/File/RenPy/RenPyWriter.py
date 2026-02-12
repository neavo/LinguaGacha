from base.Base import Base
from model.Item import Item
from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import escape_renpy_string
from module.File.RenPy.RenPyLexer import scan_double_quoted_literals
from module.File.RenPy.RenPyLexer import sha1_hex
from module.File.RenPy.RenPyLexer import split_indent
from module.File.RenPy.RenPyLexer import strip_comment_prefix


class RenPyWriter(Base):
    def apply_items_to_lines(
        self, lines: list[str], items: list[Item]
    ) -> tuple[int, int]:
        applied = 0
        skipped = 0

        for item in items:
            ok = self.apply_item(lines, item)
            if ok:
                applied += 1
            else:
                skipped += 1

        return applied, skipped

    def apply_item(self, lines: list[str], item: Item) -> bool:
        extra_raw = item.get_extra_field()
        extra: dict = extra_raw if isinstance(extra_raw, dict) else {}
        renpy: dict = extra.get("renpy", {})
        if not isinstance(renpy, dict):
            return False

        pair = renpy.get("pair", {})
        digest = renpy.get("digest", {})
        slots = renpy.get("slots", [])
        block = renpy.get("block", {})
        if not isinstance(pair, dict) or not isinstance(digest, dict):
            return False
        if not isinstance(slots, list) or not isinstance(block, dict):
            return False

        template_line = pair.get("template_line")
        target_line = pair.get("target_line")
        if not isinstance(template_line, int) or not isinstance(target_line, int):
            return False
        if template_line <= 0 or target_line <= 0:
            return False
        if template_line > len(lines) or target_line > len(lines):
            return False

        template_raw_sha1 = digest.get("template_raw_sha1")
        target_skeleton_sha1 = digest.get("target_skeleton_sha1")
        target_string_count = digest.get("target_string_count")
        if not isinstance(template_raw_sha1, str) or not isinstance(
            target_skeleton_sha1, str
        ):
            return False
        if not isinstance(target_string_count, int):
            return False

        template_raw = lines[template_line - 1]
        if sha1_hex(template_raw) != template_raw_sha1:
            return False

        target_raw = lines[target_line - 1]
        target_indent, target_rest = split_indent(target_raw)
        target_literals = scan_double_quoted_literals(target_rest)
        target_skeleton = build_skeleton(target_rest, target_literals)
        if sha1_hex(target_skeleton) != target_skeleton_sha1:
            return False
        if len(target_literals) != target_string_count:
            return False

        kind = block.get("kind")
        kind_str = str(kind) if kind is not None else ""

        replacement_by_index = self.build_replacements(item, slots)
        if not replacement_by_index:
            return False

        if kind_str == "STRINGS":
            base_code = target_rest
        else:
            _, template_rest = split_indent(template_raw)
            is_comment, template_code = strip_comment_prefix(template_rest)
            if not is_comment:
                return False
            base_code = template_code

        new_code = self.replace_literals_by_index(base_code, replacement_by_index)
        lines[target_line - 1] = f"{target_indent}{new_code}"
        return True

    def build_replacements(self, item: Item, slots: list) -> dict[int, str]:
        result: dict[int, str] = {}
        for s in slots:
            if not isinstance(s, dict):
                continue
            role = s.get("role")
            idx = s.get("lit_index")
            if not isinstance(idx, int):
                continue

            role_str = str(role) if role is not None else ""
            if role_str == "NAME":
                name_dst_raw = item.get_name_dst()
                if isinstance(name_dst_raw, str) and name_dst_raw != "":
                    result[idx] = name_dst_raw
            elif role_str in {"DIALOGUE", "STRING"}:
                result[idx] = item.get_effective_dst()

        return result

    def replace_literals_by_index(self, code: str, replacements: dict[int, str]) -> str:
        literals = scan_double_quoted_literals(code)
        if not literals:
            return code

        parts: list[str] = []
        pos = 0
        for i, lit in enumerate(literals):
            parts.append(code[pos : lit.start_col])
            if i in replacements:
                inner = escape_renpy_string(replacements[i])
                parts.append(f'"{inner}"')
            else:
                parts.append(code[lit.start_col : lit.end_col])
            pos = lit.end_col
        parts.append(code[pos:])

        return "".join(parts)
