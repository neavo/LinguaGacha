import { PythonSession, PythonSyntaxError } from "../renpy/python-syntax";
import { type Item, create_item } from "../../../domain/item";
import type { JsonValue } from "../../../domain/json";
import { is_translatable_text, looks_like_resource_reference, sha1_hex } from "./lexer";
import { find_dialogue, match_template_to_target, pair_old_new } from "./matcher";
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
  public async extract(document: RenpyDocument, rel_path: string): Promise<Item[]> {
    using session = await PythonSession.create();
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
        const item = await this.build_item(block, template_stmt, target_stmt, rel_path, session);
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
  private async build_item(
    block: RenpyTranslateBlock,
    template_stmt: RenpyStatementNode,
    target_stmt: RenpyStatementNode,
    rel_path: string,
    session: PythonSession,
  ): Promise<Item | null> {
    const name = block.kind === "LABEL" ? await this.read_name(template_stmt, session) : undefined;
    const slots =
      block.kind === "STRINGS"
        ? this.select_slots_for_strings(template_stmt)
        : this.select_slots_for_label(template_stmt, name?.slot);
    const text_slot = slots.find((slot) => slot.role === "DIALOGUE" || slot.role === "STRING");
    if (text_slot === undefined) {
      return null;
    }

    const src = template_stmt.literals[text_slot.lit_index]?.value ?? "";
    if (src === "") {
      return null;
    }
    const dst = target_stmt.literals[text_slot.lit_index]?.value ?? "";
    const name_src = name?.value ?? null;
    const target_name = name ? ((await this.read_name(target_stmt, session))?.value ?? "") : "";
    const name_dst = target_name === "" || target_name === name_src ? null : target_name;

    return create_item({
      src,
      dst,
      name_src,
      name_dst,
      row: template_stmt.line_no,
      file_type: "RENPY_RPY",
      file_path: rel_path,

      // 源文件已保存的正文或姓名译文变化表示接受整条结果，同名可能是有意保留。
      status: (dst !== "" && src !== dst) || name_dst !== null ? "PROCESSED" : "NONE",
      extra_field: this.build_extra_field(block, template_stmt, target_stmt, slots),
    });
  }

  /**
   * strings 块只翻译 old 的第一个字符串，new 行仅作为写回目标。
   */
  private select_slots_for_strings(stmt: RenpyStatementNode): RenpySlot[] {
    if (!stmt.code.trim().startsWith("old ") || stmt.literals.length === 0) {
      return [];
    }
    const value = stmt.literals[0]?.value ?? "";
    if (looks_like_resource_reference(value) || !is_translatable_text(value)) {
      return [];
    }
    return [{ role: "STRING", lit_index: 0 }];
  }

  /** 姓名使用 Python 解码，正文继续使用 Ren’Py 文本解码。 */
  private async read_name(
    stmt: RenpyStatementNode,
    session: PythonSession,
  ): Promise<{ value: string; slot: RenpySlot } | undefined> {
    const dialogue = find_dialogue(stmt);
    if (!dialogue?.who_end) return undefined;
    const input = { source: stmt.code.slice(0, dialogue.who_end).trimEnd(), mode: "eval" as const };
    try {
      const { name } = (await session.analyze(input)).speaker;
      if (!name?.value) return undefined;
      const first = stmt.literals.findIndex((literal) => literal.start_col === name.start);
      const last = stmt.literals.findIndex((literal) => literal.end_col === name.end);
      if (first < 0 || last < first) return undefined;
      return {
        value: name.value,
        slot: { role: "NAME", lit_index: first, ...(last > first ? { end_lit_index: last } : {}) },
      };
    } catch (error) {
      // 未支持的 who 表达式只失去姓名，正文仍有独立语法边界。
      if (!(error instanceof PythonSyntaxError)) throw error;
      return undefined;
    }
  }

  /** label 块按顶层正文边界选槽，姓名位置来自共享表达式规则。 */
  private select_slots_for_label(stmt: RenpyStatementNode, name?: RenpySlot): RenpySlot[] {
    const dialogue = find_dialogue(stmt);
    if (!dialogue) return [];
    const value = stmt.literals[dialogue.index]!.value;
    if (looks_like_resource_reference(value) || !is_translatable_text(value)) return [];
    return [...(name ? [name] : []), { role: "DIALOGUE", lit_index: dialogue.index }];
  }

  /**
   * extra_field 保存块、配对、槽位和摘要，写回器不再猜测目标字符串位置。
   */
  private build_extra_field(
    block: RenpyTranslateBlock,
    template_stmt: RenpyStatementNode,
    target_stmt: RenpyStatementNode,
    slots: RenpySlot[],
  ): JsonValue {
    return {
      renpy_rpy: {
        v: RENPY_EXTRA_VERSION,
        block: {
          lang: block.lang,
          label: block.label,
          kind: block.kind,
        },
        pair: {
          template_line: template_stmt.line_no,
          target_line: target_stmt.line_no,
        },
        slots: slots.map((slot) => ({ ...slot })),
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
