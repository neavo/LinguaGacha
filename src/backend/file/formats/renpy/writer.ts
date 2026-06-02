import { Item, read_json_record } from "../../../../domain/item";
import { read_item_name_text, resolve_export_item_name } from "../../../../shared/item-name";
import { effective_export_text, type FileFormatServiceConfig } from "../file-format-shared";
import {
  build_skeleton,
  escape_renpy_string,
  scan_double_quoted_literals,
  sha1_hex,
  split_indent,
  strip_comment_prefix,
} from "./lexer";
import type { RenpyBlockKind, RenpySlot, RenpySlotRole } from "./types";

/**
 * WriterExtra 是弱类型 JSON extra_field 在写回边界收窄后的内部结构。
 */
interface WriterExtra {
  block_kind: RenpyBlockKind;
  template_line: number;
  target_line: number;
  slots: RenpySlot[];
  template_raw_sha1: string;
  target_skeleton_sha1: string;
  target_string_count: number;
}

/**
 * RenPy 写回器只消费规范 AST extra_field，历史形状必须先由兼容层重建。
 */
export class RenpyWriter {
  public constructor(
    private readonly config: FileFormatServiceConfig = {
      source_language: "JA",
      target_language: "ZH",
    },
  ) {}

  /**
   * 批量写回返回成功与跳过计数，调用方可决定是否记录诊断。
   */
  public apply_items_to_lines(
    lines: string[],
    items: Item[],
  ): { applied: number; skipped: number } {
    let applied = 0;
    let skipped = 0;
    for (const item of items) {
      if (this.apply_item(lines, item)) {
        applied += 1;
      } else {
        skipped += 1;
      }
    }
    return { applied, skipped };
  }

  /**
   * 单条写回先校验模板摘要、目标骨架和字符串数量，校验失败只跳过不猜测替换。
   */
  public apply_item(lines: string[], raw_item: Item): boolean {
    const item = Item.from_json(raw_item);
    const extra = this.read_writer_extra(item);
    if (extra === null || extra.template_line <= 0 || extra.target_line <= 0) {
      return false;
    }
    const template_raw = lines[extra.template_line - 1];
    const target_raw = lines[extra.target_line - 1];
    if (template_raw === undefined || target_raw === undefined) {
      return false;
    }
    if (sha1_hex(template_raw) !== extra.template_raw_sha1) {
      return false;
    }

    const [target_indent, target_rest] = split_indent(target_raw);
    const target_literals = scan_double_quoted_literals(target_rest);
    const target_skeleton = build_skeleton(target_rest, target_literals);
    if (sha1_hex(target_skeleton) !== extra.target_skeleton_sha1) {
      return false;
    }
    if (target_literals.length !== extra.target_string_count) {
      return false;
    }

    const replacements = this.build_replacements(item, extra.slots);
    if (replacements.size === 0) {
      return false;
    }

    const base_code = this.resolve_base_code(template_raw, target_rest, extra.block_kind);
    if (base_code === null) {
      return false;
    }
    lines[extra.target_line - 1] = `${target_indent}${this.replace_literals_by_index(
      base_code,
      replacements,
    )}`;
    return true;
  }

  /**
   * NAME 槽按导出配置解析业务姓名文本，正文槽使用统一有效译文回退策略。
   */
  public build_replacements(item: Item, slots: RenpySlot[]): Map<number, string> {
    const result = new Map<number, string>();
    for (const slot of slots) {
      if (!Number.isInteger(slot.lit_index) || slot.lit_index < 0) {
        continue;
      }
      if (slot.role === "NAME") {
        const name = resolve_export_item_name({
          name_src: item.name_src,
          name_dst: item.name_dst,
          write_translated_name_fields_to_file: this.config.write_translated_name_fields_to_file,
        });
        const name_text = read_item_name_text(name);
        if (name_text !== "") {
          result.set(slot.lit_index, name_text);
        }
        continue;
      }
      if (slot.role === "DIALOGUE" || slot.role === "STRING") {
        result.set(slot.lit_index, effective_export_text(item));
      }
    }
    return result;
  }

  /**
   * 按字面量序号替换，未命中的字符串保持原样，尾随函数参数因此不会被正文覆盖。
   */
  public replace_literals_by_index(code: string, replacements: Map<number, string>): string {
    const literals = scan_double_quoted_literals(code);
    if (literals.length === 0) {
      return code;
    }

    const parts: string[] = [];
    let cursor = 0;
    literals.forEach((literal, index) => {
      parts.push(code.slice(cursor, literal.start_col));
      const replacement = replacements.get(index);
      if (replacement === undefined) {
        parts.push(code.slice(literal.start_col, literal.end_col));
      } else {
        parts.push(`"${escape_renpy_string(replacement)}"`);
      }
      cursor = literal.end_col;
    });
    parts.push(code.slice(cursor));
    return parts.join("");
  }

  /**
   * LABEL 用模板代码恢复尾随结构；STRINGS 在当前 new 行上替换，保留目标行上下文。
   */
  private resolve_base_code(
    template_raw: string,
    target_rest: string,
    block_kind: RenpyBlockKind,
  ): string | null {
    if (block_kind === "STRINGS") {
      return target_rest;
    }
    const [, template_rest] = split_indent(template_raw);
    const comment = strip_comment_prefix(template_rest);
    return comment.is_comment ? comment.content : null;
  }

  /**
   * 弱类型 extra_field 在写回边界一次性窄化，防止局部调用点散落 JSON 读取。
   */
  private read_writer_extra(item: Item): WriterExtra | null {
    const extra = read_json_record(item.extra_field);
    const renpy = read_json_record(extra["renpy"]);
    const pair = read_json_record(renpy["pair"]);
    const digest = read_json_record(renpy["digest"]);
    const block = read_json_record(renpy["block"]);
    const raw_slots = renpy["slots"];
    if (!Array.isArray(raw_slots)) {
      return null;
    }

    const slots = raw_slots.flatMap((raw_slot): RenpySlot[] => {
      const slot = read_json_record(raw_slot);
      const role = this.normalize_slot_role(slot["role"]);
      const lit_index = typeof slot["lit_index"] === "number" ? Math.trunc(slot["lit_index"]) : NaN;
      return role === null || !Number.isInteger(lit_index) ? [] : [{ role, lit_index }];
    });
    const block_kind = this.normalize_block_kind(block["kind"]);
    const template_line =
      typeof pair["template_line"] === "number" ? Math.trunc(pair["template_line"]) : NaN;
    const target_line =
      typeof pair["target_line"] === "number" ? Math.trunc(pair["target_line"]) : NaN;
    const template_raw_sha1 = digest["template_raw_sha1"];
    const target_skeleton_sha1 = digest["target_skeleton_sha1"];
    const target_string_count =
      typeof digest["target_string_count"] === "number"
        ? Math.trunc(digest["target_string_count"])
        : NaN;
    if (
      block_kind === null ||
      !Number.isInteger(template_line) ||
      !Number.isInteger(target_line) ||
      typeof template_raw_sha1 !== "string" ||
      typeof target_skeleton_sha1 !== "string" ||
      !Number.isInteger(target_string_count)
    ) {
      return null;
    }
    return {
      block_kind,
      template_line,
      target_line,
      slots,
      template_raw_sha1,
      target_skeleton_sha1,
      target_string_count,
    };
  }

  /**
   * block.kind 只接受当前写回器知道的块类型，未知值不进入写回。
   */
  private normalize_block_kind(value: unknown): RenpyBlockKind | null {
    return value === "LABEL" || value === "STRINGS" || value === "PYTHON" || value === "OTHER"
      ? value
      : null;
  }

  /**
   * slot.role 必须先收窄，避免历史或损坏 JSON 生成无效替换。
   */
  private normalize_slot_role(value: unknown): RenpySlotRole | null {
    return value === "DIALOGUE" || value === "NAME" || value === "STRING" ? value : null;
  }
}
