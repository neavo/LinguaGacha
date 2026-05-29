import type { ApiJsonValue } from "../../../api/api-types";
import { Item } from "../../../../domain/item";
import { is_translatable_text, looks_like_resource_path, sha1_hex } from "./lexer";
import {
  find_character_name_lit_index,
  find_dialogue_string_group,
  match_template_to_target,
  pair_old_new,
} from "./matcher";
import {
  RENPY_EXTRA_VERSION,
  type RenpyDocument,
  type RenpySlot,
  type RenpyStatementNode,
  type RenpyTranslateBlock,
} from "./types";

/**
 * RenPy 抽取器将已配对的 AST 语句变成项目 Item，正常写回元数据只在这里生成。
 */
export class RenpyExtractor {
  /**
   * 遍历 translate 块并保持按文件路径、行号排序的用户可见条目顺序。
   */
  public extract(document: RenpyDocument, rel_path: string): Item[] {
    const items: Item[] = [];
    for (const block of document.blocks) {
      if (block.kind === "PYTHON" || block.kind === "OTHER") {
        continue;
      }
      const mapping =
        block.kind === "STRINGS" ? pair_old_new(block) : match_template_to_target(block);
      if (mapping.size === 0) {
        continue;
      }
      const statement_by_line = new Map(
        block.statements.map((statement) => [statement.line_no, statement]),
      );
      for (const [template_line, target_line] of mapping) {
        const template_stmt = statement_by_line.get(template_line);
        const target_stmt = statement_by_line.get(target_line);
        if (template_stmt === undefined || target_stmt === undefined) {
          continue;
        }
        const item = this.build_item(block, template_stmt, target_stmt, rel_path);
        if (item !== null) {
          items.push(item);
        }
      }
    }
    return items.sort((left, right) =>
      left.file_path === right.file_path
        ? left.row - right.row
        : left.file_path.localeCompare(right.file_path),
    );
  }

  /**
   * 从模板槽位和目标槽位构造单条 Item，src 为空时直接丢弃。
   */
  public build_item(
    block: RenpyTranslateBlock,
    template_stmt: RenpyStatementNode,
    target_stmt: RenpyStatementNode,
    rel_path: string,
  ): Item | null {
    const slots = this.select_slots(block, template_stmt);
    if (slots.length === 0) {
      return null;
    }
    const name_slot = slots.find((slot) => slot.role === "NAME");
    const text_slot = slots.find((slot) => slot.role === "DIALOGUE" || slot.role === "STRING");
    if (text_slot === undefined) {
      return null;
    }

    const src = this.get_literal_value(template_stmt, text_slot.lit_index);
    if (src === "") {
      return null;
    }
    const dst = this.get_literal_value(target_stmt, text_slot.lit_index);
    const name_src =
      name_slot === undefined ? null : this.get_literal_value(template_stmt, name_slot.lit_index);
    const name_dst =
      name_slot === undefined ? null : this.get_literal_value(target_stmt, name_slot.lit_index);

    return Item.from_json({
      src,
      dst,
      name_src,
      name_dst,
      row: template_stmt.line_no,
      file_type: "RENPY",
      file_path: rel_path,
      text_type: "RENPY",
      status: dst !== "" && src !== dst ? "PROCESSED" : "NONE",
      extra_field: this.build_extra_field(block, template_stmt, target_stmt, slots),
    });
  }

  /**
   * 槽位选择按块类型分发，strings 和 label 不共享推断规则。
   */
  public select_slots(block: RenpyTranslateBlock, template_stmt: RenpyStatementNode): RenpySlot[] {
    if (block.kind === "STRINGS") {
      return this.select_slots_for_strings(template_stmt);
    }
    if (block.kind === "LABEL") {
      return this.select_slots_for_label(template_stmt);
    }
    return [];
  }

  /**
   * strings 块只翻译 old 的第一个字符串，new 行仅作为写回目标。
   */
  public select_slots_for_strings(stmt: RenpyStatementNode): RenpySlot[] {
    if (!stmt.code.trim().startsWith("old ") || stmt.literals.length === 0) {
      return [];
    }
    const value = stmt.literals[0]?.value ?? "";
    if (looks_like_resource_path(value) || !is_translatable_text(value)) {
      return [];
    }
    return [{ role: "STRING", lit_index: 0 }];
  }

  /**
   * label 块从 Character(...) 或连续字符串中识别姓名与对白，尾随参数字符串不入槽。
   */
  public select_slots_for_label(stmt: RenpyStatementNode): RenpySlot[] {
    if (stmt.literals.length === 0) {
      return [];
    }
    let name_index = find_character_name_lit_index(stmt);
    const dialogue_group = find_dialogue_string_group(stmt, name_index);
    if (dialogue_group.length === 0) {
      return [];
    }
    const dialogue_index = dialogue_group.at(-1) ?? 0;
    if (name_index === null && dialogue_group.length >= 2) {
      name_index = dialogue_group.at(-2) ?? null;
    }

    const dialogue_value = stmt.literals[dialogue_index]?.value ?? "";
    if (looks_like_resource_path(dialogue_value) || !is_translatable_text(dialogue_value)) {
      return [];
    }

    const slots: RenpySlot[] = [];
    if (name_index !== null) {
      const name_value = stmt.literals[name_index]?.value ?? "";
      if (!looks_like_resource_path(name_value) && is_translatable_text(name_value)) {
        slots.push({ role: "NAME", lit_index: name_index });
      }
    }
    slots.push({ role: "DIALOGUE", lit_index: dialogue_index });
    return slots;
  }

  /**
   * 字面量越界时返回空串，调用方据此丢弃无法安全表达的条目。
   */
  public get_literal_value(stmt: RenpyStatementNode, lit_index: number): string {
    return stmt.literals[lit_index]?.value ?? "";
  }

  /**
   * extra_field 保存块、配对、槽位和摘要，写回器不再猜测目标字符串位置。
   */
  public build_extra_field(
    block: RenpyTranslateBlock,
    template_stmt: RenpyStatementNode,
    target_stmt: RenpyStatementNode,
    slots: RenpySlot[],
  ): ApiJsonValue {
    return {
      renpy: {
        v: RENPY_EXTRA_VERSION,
        block: {
          lang: block.lang,
          label: block.label,
          kind: block.kind,
          header_line: block.header_line_no,
        },
        pair: {
          template_line: template_stmt.line_no,
          target_line: target_stmt.line_no,
        },
        slots: slots.map((slot) => ({ role: slot.role, lit_index: slot.lit_index })),
        digest: {
          template_raw_sha1: sha1_hex(template_stmt.raw_line),
          template_raw_rstrip_sha1: sha1_hex(template_stmt.raw_line.trimEnd()),
          target_skeleton_sha1: sha1_hex(target_stmt.strict_key),
          target_string_count: target_stmt.string_count,
        },
      },
    };
  }
}
