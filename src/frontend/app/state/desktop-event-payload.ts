import {
  is_project_stage,
  type ProjectSectionRevisions,
} from "@frontend/app/state/desktop-project-change-types";

/**
 * 事件数组字段统一去空白和空字符串，避免下游把脏 section 名当作刷新范围。
 */
export function normalize_section_array(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry !== "");
}

/**
 * section revision 只接受公开项目 section 和有限数字，非法字段会触发后续权威 query 恢复。
 */
export function normalize_section_revisions(value: unknown): ProjectSectionRevisions | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw_entries = Object.entries(value as Record<string, unknown>);
  const section_revisions: Record<string, number> = {};
  for (const [section, revision] of raw_entries) {
    if (!is_project_stage(section)) {
      continue;
    }

    const normalized_revision = Number(revision);
    if (!Number.isFinite(normalized_revision)) {
      continue;
    }

    section_revisions[section] = normalized_revision;
  }

  if (Object.keys(section_revisions).length === 0) {
    return undefined;
  }

  return section_revisions;
}
