import type { ApiJsonValue } from "../api/api-types";
import { QualityRule } from "../../base/quality";
import { Prompt } from "../../base/prompt";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

// section 集合必须和 bootstrap stage 保持一致，避免 ack 与首包 revision 口径分裂。
export const RUNTIME_SECTIONS = [
  "project",
  "files",
  "items",
  "quality",
  "prompts",
  "analysis",
  "proofreading",
  "task",
] as const;

export type RuntimeSection = (typeof RUNTIME_SECTIONS)[number];

/**
 * 统一读取项目运行态 section revision，供 bootstrap 和同步 mutation ack 共享口径。
 */
export function get_runtime_section_revision(meta: JsonRecord, section: string): number {
  if (section.startsWith("quality:")) {
    return read_revision_meta(meta[`quality_rule_revision.${section.slice("quality:".length)}`]);
  }
  if (section.startsWith("prompts:")) {
    return read_revision_meta(meta[`quality_prompt_revision.${section.slice("prompts:".length)}`]);
  }
  if (section === "quality") {
    return Math.max(
      ...QualityRule.all().map((rule) => read_revision_meta(meta[rule.revision_meta_key])),
      0,
    );
  }
  if (section === "prompts") {
    return Math.max(
      ...Prompt.all().map((prompt) => read_revision_meta(meta[prompt.revision_meta_key])),
      0,
    );
  }
  if (section === "files" || section === "items" || section === "analysis") {
    return read_revision_meta(meta[`project_runtime_revision.${section}`]);
  }
  if (section === "proofreading") {
    return read_revision_meta(meta["proofreading_revision.proofreading"]);
  }
  return 0;
}

export function build_section_revisions_from_meta(
  meta: JsonRecord,
): Record<RuntimeSection, number> {
  // completed 事件需要全量 section revision，不能只回传本次变更过的 section。
  return Object.fromEntries(
    RUNTIME_SECTIONS.map((section) => [section, get_runtime_section_revision(meta, section)]),
  ) as Record<RuntimeSection, number>;
}

export function build_project_mutation_ack_from_meta(
  meta: JsonRecord,
  updated_sections: string[],
): MutableJsonRecord {
  const section_revisions: MutableJsonRecord = {};
  for (const section of updated_sections) {
    // ack 的 sectionRevisions 只包含本次写入影响的 section，保留旧前端对局部 ack 的消费语义。
    section_revisions[section] = get_runtime_section_revision(meta, section);
  }
  const all_section_revisions = build_section_revisions_from_meta(meta);
  return {
    accepted: true,
    projectRevision: Math.max(...Object.values(all_section_revisions), 0),
    sectionRevisions: section_revisions,
  };
}

function read_revision_meta(value: ApiJsonValue | undefined): number {
  const number_value = Number(value ?? 0);
  if (!Number.isFinite(number_value) || number_value < 0) {
    // 旧项目或坏 meta 不能把 revision 读成 NaN / 负数，否则乐观锁会失去稳定基线。
    return 0;
  }
  return Math.trunc(number_value);
}
