import type { GlossaryEntry } from "../../domain/quality";
import type { ItemTextPart } from "../item-text";
import {
  compile_literal_patterns,
  type LiteralMatcher,
  type TextRange,
} from "../text/literal-matcher";
import { ensure_quality_rule_entry_ids } from "./quality-rule-entry-id";

export type { GlossaryEntry } from "../../domain/quality";

export type ResolvedGlossaryEntry = GlossaryEntry & { entry_id: string };
export type GlossarySourceField = "src" | "name_src";
export type GlossaryTargetField = "dst" | "name_dst";

export type GlossarySourceMatch = {
  entry: ResolvedGlossaryEntry; // 命中的规范术语及稳定身份
  fields: Array<{
    source_field: GlossarySourceField; // 实际命中的原始源文字段
    target_field: GlossaryTargetField; // 必须检查的对应译文字段
    ranges: TextRange[]; // 原始源文 UTF-16 范围
  }>;
};

export type GlossaryApplication = {
  entry_id: string; // 页面筛选和校对告警共用的规则身份
  src: string; // 展示与定位用术语源文
  dst: string; // 目标字段中要求出现的译文
  case_sensitive: boolean; // 回显命中规则的大小写策略
  fields: Array<{
    source_field: GlossarySourceField; // 触发检查的源文字段
    target_field: GlossaryTargetField; // 被检查的译文字段
    applied: boolean; // 目标字段是否包含 dst
  }>;
};

export type CompiledGlossary = {
  readonly entries: readonly ResolvedGlossaryEntry[]; // 保持输入顺序的规范术语
  readonly matcher: LiteralMatcher; // 以 entry_id 输出命中的共享字面量匹配器
};

/** 为旧规则补稳定身份，并丢弃无法参与匹配的空源文。 */
function resolve_glossary_entries(entries: readonly GlossaryEntry[]): ResolvedGlossaryEntry[] {
  return ensure_quality_rule_entry_ids(entries.map((entry) => ({ ...entry }))).filter(
    (entry) => entry.src.trim() !== "",
  );
}

/** 编译术语源文，entry_id 是跨页面、统计与校对链路共用的命中身份。 */
export function compile_glossary(entries: readonly GlossaryEntry[]): CompiledGlossary {
  const resolved_entries = resolve_glossary_entries(entries);
  return {
    entries: resolved_entries,
    matcher: compile_literal_patterns(
      resolved_entries.map((entry) => ({
        key: entry.entry_id,
        text: entry.src,
        case_sensitive: entry.case_sensitive,
      })),
    ),
  };
}

/** 只在原始源文字段查找术语，并保留到对应译文字段的映射。 */
export function match_glossary_source(
  compiled: CompiledGlossary,
  source_parts: readonly ItemTextPart[],
): GlossarySourceMatch[] {
  const fields_by_entry_id = new Map<string, GlossarySourceMatch["fields"]>();
  for (const part of source_parts) {
    if (part.field !== "src" && part.field !== "name_src") continue;
    const target_field = part.field === "src" ? "dst" : "name_dst";
    for (const match of compiled.matcher.match(part.text)) {
      const fields = fields_by_entry_id.get(match.key) ?? [];
      fields.push({ source_field: part.field, target_field, ranges: match.ranges });
      fields_by_entry_id.set(match.key, fields);
    }
  }
  return compiled.entries.flatMap((entry) => {
    const fields = fields_by_entry_id.get(entry.entry_id);
    return fields === undefined ? [] : [{ entry, fields }];
  });
}

/** 按源文字段逐一确认目标译文字段是否包含术语译文。 */
export function evaluate_glossary_applications(
  source_matches: readonly GlossarySourceMatch[],
  translation_parts: readonly ItemTextPart[],
): GlossaryApplication[] {
  const translation_by_field = new Map(translation_parts.map((part) => [part.field, part.text]));
  return source_matches.flatMap(({ entry, fields }) => {
    if (entry.dst.trim() === "") return [];
    return [
      {
        entry_id: entry.entry_id,
        src: entry.src,
        dst: entry.dst,
        case_sensitive: entry.case_sensitive,
        fields: fields.map(({ source_field, target_field }) => ({
          source_field,
          target_field,
          applied: (translation_by_field.get(target_field) ?? "").includes(entry.dst),
        })),
      },
    ];
  });
}

/** 将逐字段应用结果收敛为页面使用的四态。 */
export function resolve_glossary_application_state(
  applications: readonly GlossaryApplication[],
): "none" | "applied" | "partial" | "missing" {
  const fields = applications.flatMap((application) => application.fields);
  if (fields.length === 0) return "none";
  const applied_count = fields.filter((field) => field.applied).length;
  if (applied_count === fields.length) return "applied";
  return applied_count === 0 ? "missing" : "partial";
}

/** 生成供提示词与诊断信息复用的稳定单行术语表示。 */
export function format_glossary_entry(entry: ResolvedGlossaryEntry): string {
  return entry.info === ""
    ? `${entry.src} -> ${entry.dst}`
    : `${entry.src} -> ${entry.dst} #${entry.info}`;
}
