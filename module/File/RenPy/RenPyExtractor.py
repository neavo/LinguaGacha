from base.Base import Base
from model.Item import Item
from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import RenPyDocument
from module.File.RenPy.RenPyAst import Slot
from module.File.RenPy.RenPyAst import SlotRole
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import TranslateBlock
from module.File.RenPy.RenPyLexer import is_translatable_text
from module.File.RenPy.RenPyLexer import looks_like_resource_path
from module.File.RenPy.RenPyLexer import sha1_hex
from module.File.RenPy.RenPyMatcher import match_template_to_target
from module.File.RenPy.RenPyMatcher import pair_old_new


class RenPyExtractor(Base):
    def extract(self, doc: RenPyDocument, rel_path: str) -> list[Item]:
        items: list[Item] = []

        for block in doc.blocks:
            if block.kind == BlockKind.PYTHON or block.kind == BlockKind.OTHER:
                continue

            if block.kind == BlockKind.STRINGS:
                mapping = pair_old_new(block)
            else:
                mapping = match_template_to_target(block)

            if not mapping:
                continue

            stmt_by_line = {s.line_no: s for s in block.statements}
            for template_line, target_line in mapping.items():
                template_stmt = stmt_by_line.get(template_line)
                target_stmt = stmt_by_line.get(target_line)
                if template_stmt is None or target_stmt is None:
                    continue

                item = self.build_item(block, template_stmt, target_stmt, rel_path)
                if item is not None:
                    items.append(item)

        # Keep stable order for UX.
        items.sort(key=lambda x: (x.get_file_path(), x.get_row()))
        return items

    def build_item(
        self,
        block: TranslateBlock,
        template_stmt: StatementNode,
        target_stmt: StatementNode,
        rel_path: str,
    ) -> Item | None:
        slots = self.select_slots(block, template_stmt)
        if not slots:
            return None

        name_slot = next((s for s in slots if s.role == SlotRole.NAME), None)
        dialogue_slot = next(
            (s for s in slots if s.role in {SlotRole.DIALOGUE, SlotRole.STRING}),
            None,
        )

        if dialogue_slot is None:
            return None

        src = self.get_literal_value(template_stmt, dialogue_slot.lit_index)
        dst = self.get_literal_value(target_stmt, dialogue_slot.lit_index)

        name_src: str | None = None
        name_dst: str | None = None
        if name_slot is not None:
            name_src = self.get_literal_value(template_stmt, name_slot.lit_index)
            name_dst = self.get_literal_value(target_stmt, name_slot.lit_index)

        if src == "":
            return None

        status = self.get_status(src, dst)
        if status == Base.ProjectStatus.NONE and dst == "":
            dst = src

        extra_field = self.build_extra_field(
            block,
            template_stmt,
            target_stmt,
            slots,
        )

        return Item.from_dict(
            {
                "src": src,
                "dst": dst if dst != "" else src,
                "name_src": name_src,
                "name_dst": name_dst,
                "extra_field": extra_field,
                "row": template_stmt.line_no,
                "file_type": Item.FileType.RENPY,
                "file_path": rel_path,
                "text_type": Item.TextType.RENPY,
                "status": status,
            }
        )

    def get_status(self, src: str, dst: str) -> Base.ProjectStatus:
        if src == "":
            return Base.ProjectStatus.EXCLUDED
        if dst != "" and src != dst:
            return Base.ProjectStatus.PROCESSED_IN_PAST
        return Base.ProjectStatus.NONE

    def build_extra_field(
        self,
        block: TranslateBlock,
        template_stmt: StatementNode,
        target_stmt: StatementNode,
        slots: list[Slot],
    ) -> dict:
        return {
            "renpy": {
                "v": 1,
                "block": {
                    "lang": block.lang,
                    "label": block.label,
                    "kind": block.kind,
                    "header_line": block.header_line_no,
                },
                "pair": {
                    "template_line": template_stmt.line_no,
                    "target_line": target_stmt.line_no,
                },
                "slots": [{"role": s.role, "lit_index": s.lit_index} for s in slots],
                "digest": {
                    "template_raw_sha1": sha1_hex(template_stmt.raw_line),
                    "template_raw_rstrip_sha1": sha1_hex(
                        template_stmt.raw_line.rstrip()
                    ),
                    "target_skeleton_sha1": sha1_hex(target_stmt.strict_key),
                    "target_string_count": target_stmt.string_count,
                },
            }
        }

    def get_literal_value(self, stmt: StatementNode, lit_index: int) -> str:
        if lit_index < 0 or lit_index >= len(stmt.literals):
            return ""
        return stmt.literals[lit_index].value

    def select_slots(
        self, block: TranslateBlock, template_stmt: StatementNode
    ) -> list[Slot]:
        if block.kind == BlockKind.STRINGS:
            return self.select_slots_for_strings(template_stmt)
        if block.kind == BlockKind.LABEL:
            return self.select_slots_for_label(template_stmt)
        return []

    def select_slots_for_strings(self, stmt: StatementNode) -> list[Slot]:
        code = stmt.code.strip()
        if not code.startswith("old "):
            return []

        if not stmt.literals:
            return []

        value = stmt.literals[0].value
        if looks_like_resource_path(value):
            return []
        if not is_translatable_text(value):
            return []
        return [Slot(role=SlotRole.STRING, lit_index=0)]

    def select_slots_for_label(self, stmt: StatementNode) -> list[Slot]:
        if not stmt.literals:
            return []

        name_index = self.find_character_name_lit_index(stmt)
        tail_group = self.find_tail_string_group(stmt)
        if not tail_group:
            return []

        dialogue_index = tail_group[-1]
        tail_name_index: int | None = None
        if len(tail_group) >= 2:
            tail_name_index = tail_group[-2]

        dialogue_value = stmt.literals[dialogue_index].value
        if looks_like_resource_path(dialogue_value):
            return []
        if not is_translatable_text(dialogue_value):
            return []

        slots: list[Slot] = []
        if name_index is None and tail_name_index is not None:
            name_index = tail_name_index

        if name_index is not None:
            name_value = stmt.literals[name_index].value
            if (not looks_like_resource_path(name_value)) and is_translatable_text(
                name_value
            ):
                slots.append(Slot(role=SlotRole.NAME, lit_index=name_index))

        slots.append(Slot(role=SlotRole.DIALOGUE, lit_index=dialogue_index))
        return slots

    def find_tail_string_group(self, stmt: StatementNode) -> list[int]:
        if not stmt.literals:
            return []

        indices = [len(stmt.literals) - 1]
        for idx in range(len(stmt.literals) - 2, -1, -1):
            prev_lit = stmt.literals[idx]
            next_lit = stmt.literals[idx + 1]
            between = stmt.code[prev_lit.end_col : next_lit.start_col]
            if between.strip() == "":
                indices.append(idx)
                continue
            break

        indices.reverse()
        return indices

    def find_character_name_lit_index(self, stmt: StatementNode) -> int | None:
        code = stmt.code.lstrip()
        if not code.startswith("Character("):
            return None

        open_pos = stmt.code.find("(")
        if open_pos < 0:
            return None

        close_pos = self.find_matching_paren(stmt, open_pos)
        if close_pos is None:
            return None

        for i, lit in enumerate(stmt.literals):
            if open_pos < lit.start_col < close_pos:
                return i

        return None

    def find_matching_paren(self, stmt: StatementNode, open_pos: int) -> int | None:
        ranges = [(lit.start_col, lit.end_col) for lit in stmt.literals]
        range_index = 0
        depth = 0
        i = open_pos
        while i < len(stmt.code):
            if range_index < len(ranges) and i == ranges[range_index][0]:
                i = ranges[range_index][1]
                range_index += 1
                continue

            ch = stmt.code[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return i
            i += 1

        return None
