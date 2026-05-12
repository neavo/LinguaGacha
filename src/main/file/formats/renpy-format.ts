import path from "node:path";
import { createHash } from "node:crypto";

import type { ApiJsonValue } from "../../api/api-types";
import { TextTool } from "../../../shared/utils/text-tool";
import {
  effective_export_text,
  group_items,
  split_text_lines_for_items,
  write_text_file,
  type ExportPaths,
} from "./file-format-shared";
import { Item, read_json_record } from "../../../base/item";

const RESOURCE_EXTENSIONS = new Set([
  ".mp3",
  ".ogg",
  ".wav",
  ".flac",
  ".opus",
  ".mp4",
  ".webm",
  ".avi",
  ".mkv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]);

/**
 * RenPy 代码行中的双引号字面量位置和值，写回和骨架匹配都依赖列号
 */
interface RenpyStringLiteral {
  start_col: number;
  end_col: number;
  raw_inner: string;
  value: string;
}

/**
 * 一个 RenPy 可翻译槽位，区分角色名、对白和 strings 块文本
 */
interface RenpySlot {
  role: "DIALOGUE" | "NAME" | "STRING";
  lit_index: number;
}

/**
 * RenPy 翻译脚本格式，按旧注释模板和目标行配对规则解析
 */
export class RenPyFormat {
  /**
   * 文件流入口只负责解码，实际解析拆到 parse_text 便于 golden 和单元测试复用
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    return this.parse_text(rel_path, await TextTool.decode(content));
  }

  /**
   * 扫描 translate 块、old/new strings 和注释模板，并把匹配到的目标行绑定到 extra_field
   */
  public parse_text(rel_path: string, text: string): Item[] {
    const lines = split_text_lines_for_items(text);
    const items: Item[] = [];
    let lang = "";
    let label = "";
    let header_line = 0;
    let used_target_lines = new Set<number>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const header = line.trim().match(/^translate\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*:\s*$/u);
      if (header !== null) {
        lang = header[1] ?? "";
        label = header[2] ?? "";
        header_line = index + 1;
        used_target_lines = new Set<number>();
        continue;
      }
      const old_match = line.trim().match(/^old\s+"((?:\\.|[^"\\])*)"/u);
      if (old_match !== null) {
        const src = this.unescape_string(old_match[1] ?? "");
        if (src === "" || this.looks_like_resource_path(src) || !this.is_translatable_text(src)) {
          continue;
        }
        let target_index = -1;
        let new_match: RegExpMatchArray | null = null;
        for (
          let candidate_index = index + 1;
          candidate_index < lines.length;
          candidate_index += 1
        ) {
          const candidate = lines[candidate_index]?.trim() ?? "";
          if (!candidate.startsWith("new ")) {
            continue;
          }
          target_index = candidate_index;
          new_match = candidate.match(/^new\s+"((?:\\.|[^"\\])*)"/u);
          break;
        }
        const target_line = target_index >= 0 ? (lines[target_index] ?? "") : "";
        items.push(
          Item.from_json({
            src,
            dst: new_match ? this.unescape_string(new_match[1] ?? "") : "",
            row: index + 1,
            file_type: "RENPY",
            file_path: rel_path,
            text_type: "RENPY",
            status:
              new_match !== null &&
              new_match[1] !== undefined &&
              old_match[1] !== new_match[1] &&
              new_match[1] !== ""
                ? "PROCESSED"
                : "NONE",
            extra_field: this.build_extra_field({
              lang,
              label,
              kind: label === "strings" ? "STRINGS" : "LABEL",
              header_line,
              template_line: index + 1,
              target_line: target_index >= 0 ? target_index + 1 : 0,
              template_raw: line,
              target_code: target_line.trim(),
              slots: [{ role: "STRING", lit_index: 0 }],
            }),
          }),
        );
        continue;
      }
      const commented_dialogue = this.parse_commented_template(line);
      const target_index =
        commented_dialogue === null
          ? -1
          : this.find_matching_target_line(
              lines,
              index + 1,
              commented_dialogue.code,
              used_target_lines,
            );
      const target_code = target_index >= 0 ? (lines[target_index]?.trim() ?? "") : "";
      const target_literals = this.scan_literals(target_code);
      if (commented_dialogue !== null && target_index >= 0) {
        used_target_lines.add(target_index);
        const dialogue_slot = commented_dialogue.slots.find((slot) => slot.role === "DIALOGUE");
        const name_slot = commented_dialogue.slots.find((slot) => slot.role === "NAME");
        if (dialogue_slot === undefined) {
          continue;
        }
        const src = commented_dialogue.literals[dialogue_slot.lit_index]?.value ?? "";
        const dst = target_literals[dialogue_slot.lit_index]?.value ?? "";
        const name_src =
          name_slot === undefined
            ? null
            : (commented_dialogue.literals[name_slot.lit_index]?.value ?? null);
        const name_dst =
          name_slot === undefined
            ? null
            : (target_literals[name_slot.lit_index]?.value ?? name_src);
        items.push(
          Item.from_json({
            src,
            dst,
            name_src,
            name_dst,
            row: index + 1,
            file_type: "RENPY",
            file_path: rel_path,
            text_type: "RENPY",
            status: dst !== "" && src !== dst ? "PROCESSED" : "NONE",
            extra_field: this.build_extra_field({
              lang,
              label,
              kind: label === "strings" ? "STRINGS" : "LABEL",
              header_line,
              template_line: index + 1,
              target_line: target_index + 1,
              template_raw: line,
              target_code,
              slots: commented_dialogue.slots,
            }),
          }),
        );
      }
    }
    return items;
  }

  /**
   * 写回时按 target_line 倒序替换，避免前面行数变化影响后续定位
   */
  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "RENPY")) {
      const original = asset_reader(rel_path);
      if (original === null) {
        continue;
      }
      const lines = split_text_lines_for_items(await TextTool.decode(original));
      for (const item of group.sort((left, right) => right.row - left.row)) {
        const extra = read_json_record(item.extra_field);
        const renpy = read_json_record(extra["renpy"]);
        const pair = read_json_record(renpy["pair"]);
        const target_line =
          typeof pair["target_line"] === "number" ? Math.trunc(pair["target_line"]) : 0;
        const target_index = target_line > 0 ? target_line - 1 : Math.max(0, item.row);
        const replacement = lines[target_index]?.replace(
          /"((?:\\.|[^"\\])*)"/u,
          `"${this.escape_string(effective_export_text(item))}"`,
        );
        if (replacement !== undefined) {
          lines[target_index] = replacement;
        }
      }
      await write_text_file(path.join(paths.translated_path, rel_path), lines.join("\n"));
    }
  }

  /**
   * 注释模板行去掉 `#` 后按 RenPy 语句解析，只有含可翻译槽位才生成条目
   */
  private parse_commented_template(
    raw_line: string,
  ): { code: string; literals: RenpyStringLiteral[]; slots: RenpySlot[] } | null {
    const trimmed = raw_line.trim();
    if (!trimmed.startsWith("#")) {
      return null;
    }
    const code = trimmed.replace(/^#\s?/u, "");
    const literals = this.scan_literals(code);
    const slots = this.select_label_slots(code, literals);
    if (slots.length === 0) {
      return null;
    }
    return { code, literals, slots };
  }

  /**
   * 从模板行之后寻找语法骨架相同的目标行，遇到下一 translate 块即停止
   */
  private find_matching_target_line(
    lines: string[],
    start_index: number,
    template_code: string,
    used_target_lines: Set<number>,
  ): number {
    for (let index = start_index; index < lines.length; index += 1) {
      const candidate = lines[index]?.trim() ?? "";
      if (/^translate\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*:\s*$/u.test(candidate)) {
        return -1;
      }
      if (candidate === "" || candidate.startsWith("#") || used_target_lines.has(index)) {
        continue;
      }
      if (this.statements_equal(template_code, candidate)) {
        return index;
      }
    }
    return -1;
  }

  /**
   * 比较模板语句和目标语句是否同构，角色 token 允许在安全场景下归一化
   */
  private statements_equal(template_code: string, target_code: string): boolean {
    const template_signature = this.build_statement_signature(template_code);
    const target_signature = this.build_statement_signature(target_code);
    if (template_signature.string_count !== target_signature.string_count) {
      return false;
    }
    if (template_signature.strict_key === target_signature.strict_key) {
      return true;
    }
    if (!this.speakers_are_compatible(template_code, target_code)) {
      return false;
    }
    if (template_signature.relaxed_key === target_signature.relaxed_key) {
      return true;
    }
    if (
      template_signature.strict_key === this.drop_normalized_speaker(target_signature.relaxed_key)
    ) {
      return true;
    }
    return (
      this.drop_normalized_speaker(template_signature.relaxed_key) === target_signature.strict_key
    );
  }

  /**
   * 生成语句骨架签名，用字符串数量和去文本后的骨架避免误配目标行
   */
  private build_statement_signature(code: string): {
    string_count: number;
    strict_key: string;
    relaxed_key: string;
  } {
    const literals = this.scan_literals(code);
    const match_end_col = this.find_dialogue_match_end_col(code, literals);
    const matched_code = code.slice(0, match_end_col);
    const matched_literals = literals.filter((literal) => literal.end_col <= match_end_col);
    const strict_key = this.build_skeleton(matched_code);
    return {
      string_count: matched_literals.length,
      strict_key,
      relaxed_key: this.normalize_speaker_token(strict_key),
    };
  }

  /**
   * 只取对白相关片段参与匹配，避免后续参数里的字符串干扰语句骨架
   */
  private find_dialogue_match_end_col(code: string, literals: RenpyStringLiteral[]): number {
    if (literals.length === 0) {
      return code.length;
    }
    let dialogue_start_col = 0;
    const stripped = code.trimStart();
    if (stripped.startsWith("Character(")) {
      const open_pos = code.indexOf("(");
      const close_pos = this.find_matching_paren(code, literals, open_pos);
      if (close_pos === null) {
        return code.length;
      }
      dialogue_start_col = close_pos + 1;
    }
    const dialogue_group = this.find_dialogue_group(code, literals, dialogue_start_col);
    const dialogue_index = dialogue_group[dialogue_group.length - 1];
    return dialogue_index === undefined
      ? code.length
      : (literals[dialogue_index]?.end_col ?? code.length);
  }

  /**
   * speaker token 不兼容时禁止宽松骨架匹配，避免把不同角色对白错配
   */
  private speakers_are_compatible(template_code: string, target_code: string): boolean {
    const template_speaker = this.get_statement_speaker_token(template_code);
    const target_speaker = this.get_statement_speaker_token(target_code);
    if (template_speaker === null && target_speaker === null) {
      return true;
    }
    return template_speaker === target_speaker;
  }

  /**
   * 提取语句开头的 RenPy speaker 变量，裸字符串和 Character 调用视为无 speaker
   */
  private get_statement_speaker_token(code: string): string | null {
    const stripped = code.trimStart();
    if (stripped.startsWith('"') || stripped.startsWith("Character(")) {
      return null;
    }
    return code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\b/u)?.[1] ?? null;
  }

  /**
   * 宽松匹配时把 speaker 变量归一成占位符，减少翻译目标行角色变量差异影响
   */
  private normalize_speaker_token(code: string): string {
    const stripped = code.trimStart();
    if (stripped.startsWith('"')) {
      return code;
    }
    return code.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\b.*)$/u, "$1<SPEAKER>$3");
  }

  /**
   * 当一侧骨架已经归一化 speaker 时，去掉占位符再做兼容比较
   */
  private drop_normalized_speaker(key: string): string {
    return key.startsWith("<SPEAKER> ") ? key.slice("<SPEAKER> ".length) : key;
  }

  /**
   * 从语句字面量中选出可翻译的角色名和对白槽位
   */
  private select_label_slots(code: string, literals: RenpyStringLiteral[]): RenpySlot[] {
    if (literals.length === 0) {
      return [];
    }
    let name_index: number | null = null;
    let dialogue_start_col = 0;
    const stripped = code.trimStart();
    if (stripped.startsWith("Character(")) {
      const open_pos = code.indexOf("(");
      const close_pos = this.find_matching_paren(code, literals, open_pos);
      if (close_pos === null) {
        return [];
      }
      name_index = literals.findIndex(
        (literal) => open_pos < literal.start_col && literal.start_col < close_pos,
      );
      if (name_index < 0) {
        name_index = null;
      }
      dialogue_start_col = close_pos + 1;
    }
    const dialogue_group = this.find_dialogue_group(code, literals, dialogue_start_col);
    if (dialogue_group.length === 0) {
      return [];
    }
    const dialogue_index = dialogue_group[dialogue_group.length - 1] ?? 0;
    if (name_index === null && dialogue_group.length >= 2) {
      name_index = dialogue_group[dialogue_group.length - 2] ?? null;
    }
    const dialogue_value = literals[dialogue_index]?.value ?? "";
    if (
      this.looks_like_resource_path(dialogue_value) ||
      !this.is_translatable_text(dialogue_value)
    ) {
      return [];
    }
    const slots: RenpySlot[] = [];
    if (name_index !== null) {
      const name_value = literals[name_index]?.value ?? "";
      if (!this.looks_like_resource_path(name_value) && this.is_translatable_text(name_value)) {
        slots.push({ role: "NAME", lit_index: name_index });
      }
    }
    slots.push({ role: "DIALOGUE", lit_index: dialogue_index });
    return slots;
  }

  /**
   * 连续字符串字面量视为同一对白组，用于 `"名" "对白"` 这种 RenPy 写法
   */
  private find_dialogue_group(
    code: string,
    literals: RenpyStringLiteral[],
    start_col: number,
  ): number[] {
    const start_index = literals.findIndex((literal) => literal.start_col >= start_col);
    if (start_index < 0) {
      return [];
    }
    const result = [start_index];
    for (let index = start_index + 1; index < literals.length; index += 1) {
      const previous = literals[index - 1];
      const current = literals[index];
      if (previous === undefined || current === undefined) {
        break;
      }
      if (code.slice(previous.end_col, current.start_col).trim() !== "") {
        break;
      }
      result.push(index);
    }
    return result;
  }

  /**
   * 在跳过字符串字面量的前提下匹配括号，避免 Character(")") 误关括号
   */
  private find_matching_paren(
    code: string,
    literals: RenpyStringLiteral[],
    open_pos: number,
  ): number | null {
    if (open_pos < 0) {
      return null;
    }
    let literal_index = 0;
    let depth = 0;
    let code_index = open_pos;
    while (code_index < code.length) {
      const literal = literals[literal_index];
      if (literal !== undefined && code_index === literal.start_col) {
        code_index = literal.end_col;
        literal_index += 1;
        continue;
      }
      const char = code[code_index];
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          return code_index;
        }
      }
      code_index += 1;
    }
    return null;
  }

  /**
   * 扫描双引号字面量并保留原始转义内容，供解析和写回复用
   */
  private scan_literals(code: string): RenpyStringLiteral[] {
    const literals: RenpyStringLiteral[] = [];
    let index = 0;
    while (index < code.length) {
      if (code[index] !== '"') {
        index += 1;
        continue;
      }
      const start_col = index;
      index += 1;
      let raw_inner = "";
      while (index < code.length) {
        const char = code[index];
        if (char === "\\" && index + 1 < code.length) {
          raw_inner += `${code[index]}${code[index + 1]}`;
          index += 2;
          continue;
        }
        if (char === '"') {
          const end_col = index + 1;
          literals.push({
            start_col,
            end_col,
            raw_inner,
            value: this.unescape_string(raw_inner),
          });
          index = end_col;
          break;
        }
        raw_inner += char;
        index += 1;
      }
    }
    return literals;
  }

  /**
   * 资源路径字面量不进入翻译，避免图片、音频和字体文件名被误处理
   */
  private looks_like_resource_path(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed === "") {
      return false;
    }
    return RESOURCE_EXTENSIONS.has(path.extname(path.basename(trimmed)).toLowerCase());
  }

  /**
   * 排除空文本、纯变量占位和纯样式标记，保留含 `{#...}` 的可见文本
   */
  private is_translatable_text(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed === "") {
      return false;
    }
    if (/^\[[^\]]+\]$/u.test(trimmed)) {
      return false;
    }
    const cleaned = text.replace(/\{[^{}]*\}/gu, "").trim();
    return cleaned !== "" || trimmed.includes("{#");
  }

  /**
   * extra_field 保存 RenPy 定位、槽位和摘要，写回和未来迁移都依赖这份结构
   */
  private build_extra_field(payload: {
    lang: string;
    label: string;
    kind: "LABEL" | "STRINGS";
    header_line: number;
    template_line: number;
    target_line: number;
    template_raw: string;
    target_code: string;
    slots: RenpySlot[];
  }): ApiJsonValue {
    return {
      renpy: {
        v: 1,
        block: {
          lang: payload.lang,
          label: payload.label,
          kind: payload.kind,
          header_line: payload.header_line,
        },
        pair: {
          template_line: payload.template_line,
          target_line: payload.target_line,
        },
        slots: payload.slots.map((slot) => ({ ...slot })),
        digest: {
          template_raw_sha1: this.sha1_hex(payload.template_raw),
          template_raw_rstrip_sha1: this.sha1_hex(payload.template_raw.trimEnd()),
          target_skeleton_sha1: this.sha1_hex(this.build_skeleton(payload.target_code)),
          target_string_count: this.count_strings(payload.target_code),
        },
      },
    };
  }

  /**
   * 字符串内容替换为占位符后的骨架用于跨语言目标行配对
   */
  private build_skeleton(code: string): string {
    return code
      .replace(/"((?:\\.|[^"\\])*)"/gu, '"{}"')
      .replace(/\s+/gu, " ")
      .trim();
  }

  /**
   * 目标行字符串数量是防误配的快速校验
   */
  private count_strings(code: string): number {
    return [...code.matchAll(/"((?:\\.|[^"\\])*)"/gu)].length;
  }

  /**
   * RenPy 翻译文件只需要处理旧实现覆盖的基础转义
   */
  private unescape_string(value: string): string {
    return value.replace(/\\"/gu, '"').replace(/\\n/gu, "\n");
  }

  /**
   * 写回时反向恢复双引号、反斜杠和换行转义
   */
  private escape_string(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
  }

  /**
   * 摘要使用 SHA1 仅用于稳定定位与诊断，不参与安全校验
   */
  private sha1_hex(text: string): string {
    return createHash("sha1").update(text, "utf-8").digest("hex");
  }
}
