from base.Base import Base
from module.Data.Core.Item import Item
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
from module.File.RenPy.RenPyStatementHelper import find_character_name_lit_index
from module.File.RenPy.RenPyStatementHelper import find_dialogue_string_group
from module.File.RenPy.RenPyStatementHelper import find_first_string_after_col
from module.File.RenPy.RenPyStatementHelper import find_matching_paren


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

        extra_field = self.build_extra_field(
            block,
            template_stmt,
            target_stmt,
            slots,
        )

        return Item.from_dict(
            {
                "src": src,
                "dst": dst,
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
        dialogue_group = self.find_dialogue_string_group(stmt, name_index)
        if not dialogue_group:
            return []

        dialogue_index = dialogue_group[-1]
        dialogue_name_index: int | None = None
        if len(dialogue_group) >= 2:
            dialogue_name_index = dialogue_group[-2]

        dialogue_value = stmt.literals[dialogue_index].value
        if looks_like_resource_path(dialogue_value):
            return []
        if not is_translatable_text(dialogue_value):
            return []

        slots: list[Slot] = []
        if name_index is None and dialogue_name_index is not None:
            name_index = dialogue_name_index

        if name_index is not None:
            name_value = stmt.literals[name_index].value
            if (not looks_like_resource_path(name_value)) and is_translatable_text(
                name_value
            ):
                slots.append(Slot(role=SlotRole.NAME, lit_index=name_index))

        slots.append(Slot(role=SlotRole.DIALOGUE, lit_index=dialogue_index))
        return slots

    def find_dialogue_string_group(
        self, stmt: StatementNode, name_index: int | None = None
    ) -> list[int]:
        return find_dialogue_string_group(stmt, name_index)

    def find_first_string_after_col(
        self, stmt: StatementNode, start_col: int
    ) -> int | None:
        return find_first_string_after_col(stmt, start_col)

    def find_character_name_lit_index(self, stmt: StatementNode) -> int | None:
        return find_character_name_lit_index(stmt)

    def find_matching_paren(self, stmt: StatementNode, open_pos: int) -> int | None:
        return find_matching_paren(stmt, open_pos)
